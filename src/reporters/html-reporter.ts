import fs from 'fs';
import path from 'path';
import type { AssertionResult, EvalSuiteReport, EvalTrial, TaskResult } from '../types/index.js';
import { Logger } from '../utils/logger.js';
import type { Reporter } from './reporter.js';
import { formatTokens, formatDuration } from '../utils/table-renderer.js';
import { computeAssertionPassRate } from '../core/statistics.js';

export class HtmlReporter implements Reporter {
  generate(report: EvalSuiteReport, runDir: string): void {
    const htmlPath = path.join(runDir, 'report.html');
    fs.writeFileSync(htmlPath, generateHtml(report), 'utf-8');
    Logger.write(`\n   Report: file://${htmlPath}\n`);
  }
}

// ---------------------------------------------------------------------------
// HTML generation (module-private)
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatPercent(val: number): string {
  return `${Math.round(val * 100)}%`;
}

function passColorClass(val: number): string {
  if (val >= 0.8) return 'green';
  if (val >= 0.5) return 'amber';
  return 'red';
}

function isFunctional(report: EvalSuiteReport): boolean {
  return report.metrics.assertionPassRate['baseline'] !== undefined;
}

// ---------------------------------------------------------------------------
// Metrics Grid
// ---------------------------------------------------------------------------

function renderDeltaCell(base: number, target: number, format: (n: number) => string, cellClass: string): string {
  if (base <= 0) return `<span class="metric-val muted">—</span>`;
  const delta = target - base;
  const sign = delta >= 0 ? '+' : '';
  const pct = Math.round((delta / base) * 100);
  const cls = delta > 0 ? 'amber' : delta < 0 ? 'green' : '';
  return `<span class="${cellClass} ${cls}">${sign}${pct}%</span>`;
}

function renderMetricsGrid(report: EvalSuiteReport): string {
  const { metrics, results } = report;
  const functional = isFunctional(report);
  const skillVersions = results.length > 0 ? Object.keys(results[0].skillTrials) : ['local'];
  const allVersions = functional ? ['baseline', ...skillVersions] : skillVersions;

  const headerCells = allVersions.map(v => `<th>${v}</th>`).join('');
  
  const successRows = `<tr>
    <td>Success Rate</td>
    ${allVersions.map(v => {
      const val = metrics.assertionPassRate[v] ?? metrics.passAtK[v] ?? 0;
      return `<td><span class="metric-val ${passColorClass(val)}">${formatPercent(val)}</span></td>`;
    }).join('')}
  </tr>`;

  const tokenRows = `<tr>
    <td>Tokens (avg)</td>
    ${allVersions.map(v => {
      const stats = metrics.tokenStats?.[v];
      return `<td>${stats ? `<span class="metric-val">${formatTokens(stats.avgTotal)}</span><div class="metric-sub">avg total</div>` : '<span class="metric-val muted">—</span>'}</td>`;
    }).join('')}
  </tr>`;

  const timeRows = `<tr>
    <td>Time (avg)</td>
    ${allVersions.map(v => {
      const stats = metrics.durationStats?.[v];
      return `<td>${stats ? `<span class="metric-val">${formatDuration(stats.avgMs)}</span>` : '<span class="metric-val muted">—</span>'}</td>`;
    }).join('')}
  </tr>`;

  return `<div class="metrics-grid">
  <table>
    <thead>
      <tr><th></th>${headerCells}</tr>
    </thead>
    <tbody>
      ${successRows}
      ${tokenRows}
      ${timeRows}
    </tbody>
  </table>
</div>`;
}

// ---------------------------------------------------------------------------
// Trial details
// ---------------------------------------------------------------------------

function renderAssertions(assertions: AssertionResult[]): string {
  if (assertions.length === 0) return '<p class="muted">No assertions recorded.</p>';
  return assertions.map(a => {
    const icon = a.passed ? '✓' : '✗';
    const cls = a.passed ? 'assert-pass' : 'assert-fail';
    return `<div class="assertion ${cls}">
  <span class="assert-icon">${icon}</span>
  <div class="assert-body">
    <div class="assert-text">${escapeHtml(a.assertion)}</div>
    ${a.reason ? `<div class="assert-reason">${escapeHtml(a.reason)}</div>` : ''}
  </div>
</div>`;
  }).join('');
}

function renderTrial(trial: EvalTrial): string {
  const passedCount = trial.assertionResults.filter(r => r.passed).length;
  const totalCount = trial.assertionResults.length;
  const isPartial = !trial.trialPassed && !trial.isError && passedCount > 0;
  const cls = trial.isError ? 'trial-error' : trial.trialPassed ? 'trial-pass' : isPartial ? 'trial-partial' : 'trial-fail';
  const badge = trial.isError
    ? '<span class="pill amber">! ERROR</span>'
    : trial.trialPassed
      ? '<span class="pill green">✓ PASS</span>'
      : isPartial
        ? `<span class="pill amber">~ PARTIAL ${passedCount}/${totalCount}</span>`
        : '<span class="pill red">✗ NOT PASSED</span>';
  return `<div class="trial ${cls}">
  <div class="trial-header">Trial ${trial.id} ${badge}</div>
  <div class="trial-assertions">${renderAssertions(trial.assertionResults)}</div>
</div>`;
}

function avgTrialTokens(trials: EvalTrial[]): number | null {
  const withStats = trials.filter(t => t.tokenStats != null);
  if (withStats.length === 0) return null;
  return Math.round(withStats.reduce((s, t) => s + t.tokenStats!.totalTokens, 0) / withStats.length);
}

function avgTrialDuration(trials: EvalTrial[]): number | null {
  const withDuration = trials.filter(t => t.durationMs != null);
  if (withDuration.length === 0) return null;
  return Math.round(withDuration.reduce((s, t) => s + t.durationMs!, 0) / withDuration.length);
}

function renderTaskMiniGrid(result: TaskResult, isFunctionalEval: boolean): string {
  const skillVersions = Object.keys(result.skillTrials);
  const allVersions = isFunctionalEval ? ['baseline', ...skillVersions] : skillVersions;

  const headerCells = allVersions.map(v => `<th>${v}</th>`).join('');

  const successRows = `<tr>
    <td>Success Rate</td>
    ${allVersions.map(v => {
      const trials = v === 'baseline' ? result.baselineTrials : result.skillTrials[v];
      const rate = trials.length ? Math.round(computeAssertionPassRate(trials) * 100) : 0;
      return `<td><span class="metric-val-sm ${passColorClass(rate / 100)}">${rate}%</span></td>`;
    }).join('')}
  </tr>`;

  const tokenRows = `<tr>
    <td>Tokens (avg)</td>
    ${allVersions.map(v => {
      const trials = v === 'baseline' ? result.baselineTrials : result.skillTrials[v];
      const tokens = avgTrialTokens(trials);
      return `<td>${tokens != null ? `<span class="metric-val-sm">${formatTokens(tokens)}</span>` : '<span class="metric-val-sm muted">—</span>'}</td>`;
    }).join('')}
  </tr>`;

  const timeRows = `<tr>
    <td>Time (avg)</td>
    ${allVersions.map(v => {
      const trials = v === 'baseline' ? result.baselineTrials : result.skillTrials[v];
      const ms = avgTrialDuration(trials);
      return `<td>${ms != null ? `<span class="metric-val-sm">${formatDuration(ms)}</span>` : '<span class="metric-val-sm muted">—</span>'}</td>`;
    }).join('')}
  </tr>`;

  return `<div class="metrics-grid-sm">
  <table>
    <thead>
      <tr><th></th>${headerCells}</tr>
    </thead>
    <tbody>
      ${successRows}
      ${tokenRows}
      ${timeRows}
    </tbody>
  </table>
</div>`;
}

function renderTaskDetails(result: TaskResult, isFunctionalEval: boolean): string {
  const sections: string[] = [];

  sections.push(renderTaskMiniGrid(result, isFunctionalEval));

  if (isFunctionalEval && result.baselineTrials && result.baselineTrials.length > 0) {
    sections.push('<div class="trial-group-label">Baseline</div>');
    sections.push(...result.baselineTrials.map(t => renderTrial(t)));
  }

  for (const version of Object.keys(result.skillTrials)) {
    sections.push(`<div class="trial-group-label">${version}</div>`);
    sections.push(...result.skillTrials[version].map(t => renderTrial(t)));
  }

  return `<div class="task-details" id="details-${result.taskId}">${sections.join('')}</div>`;
}

// ---------------------------------------------------------------------------
// Eval results table
// ---------------------------------------------------------------------------

function renderTaskTable(report: EvalSuiteReport): string {
  const { results } = report;
  const functional = isFunctional(report);

  const headerRow = `<tr><th>#</th><th>Prompt</th><th>Details</th></tr>`;

  const rows = results.map(result => {
    const prompt = escapeHtml(result.prompt);
    const detailsBtn = `<button class="details-btn" data-target="details-${result.taskId}">▶</button>`;
    const detailsRow = `<tr class="details-row"><td colspan="3">${renderTaskDetails(result, functional)}</td></tr>`;
    return `<tr><td>${result.taskId}</td><td class="prompt-cell">${prompt}</td><td>${detailsBtn}</td></tr>${detailsRow}`;
  }).join('');

  return `<div class="table-wrap"><table><thead>${headerRow}</thead><tbody>${rows}</tbody></table></div>`;
}

// ---------------------------------------------------------------------------
// Full document
// ---------------------------------------------------------------------------

export function generateHtml(report: EvalSuiteReport): string {
  const { skill_name, agent, timestamp, metrics } = report;
  const functional = isFunctional(report);
  const evalType = functional ? 'Functional' : 'Trigger';
  const overallScore = metrics.passAtK['local'] ?? 0;
  const statusClass = passColorClass(overallScore);
  const formattedDate = new Date(timestamp).toLocaleString();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Skill Eval — ${escapeHtml(skill_name)}</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8fafc; color: #1e293b; font-size: 14px; }
a { color: #3b82f6; }

/* Layout */
.container { max-width: 960px; margin: 0 auto; padding: 24px 16px 48px; }

/* Header */
.header { background: #1e293b; color: #f1f5f9; padding: 24px 28px; border-radius: 10px; margin-bottom: 24px; }
.header h1 { font-size: 22px; font-weight: 700; margin-bottom: 8px; }
.header-meta { display: flex; gap: 24px; flex-wrap: wrap; font-size: 13px; color: #94a3b8; }
.header-meta span b { color: #e2e8f0; }
.status-bar { height: 4px; border-radius: 2px; margin-top: 16px; }
.status-bar.green { background: #22c55e; }
.status-bar.amber { background: #f59e0b; }
.status-bar.red   { background: #ef4444; }

/* Metrics Grid */
.metrics-grid { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; margin-bottom: 24px; }
.metrics-grid table { width: 100%; border-collapse: collapse; }
.metrics-grid thead th { background: #f8fafc; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; padding: 10px 24px; text-align: right; border-bottom: 2px solid #e2e8f0; white-space: nowrap; }
.metrics-grid thead th:first-child { text-align: left; min-width: 120px; }
.metrics-grid tbody td { padding: 14px 24px; border-bottom: 1px solid #f1f5f9; text-align: right; vertical-align: middle; }
.metrics-grid tbody tr:last-child td { border-bottom: none; }
.metrics-grid tbody td:first-child { text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; white-space: nowrap; }
.metric-val { font-size: 24px; font-weight: 700; line-height: 1; display: block; }
.metric-sub { font-size: 11px; color: #94a3b8; margin-top: 3px; }

/* Metrics Grid — compact variant (inside task details) */
.metrics-grid-sm { border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden; margin-bottom: 14px; }
.metrics-grid-sm table { width: 100%; border-collapse: collapse; }
.metrics-grid-sm thead th { background: #f8fafc; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: #94a3b8; padding: 6px 14px; text-align: right; border-bottom: 1px solid #e2e8f0; white-space: nowrap; }
.metrics-grid-sm thead th:first-child { text-align: left; }
.metrics-grid-sm tbody td { padding: 8px 14px; border-bottom: 1px solid #f1f5f9; text-align: right; vertical-align: middle; }
.metrics-grid-sm tbody tr:last-child td { border-bottom: none; }
.metrics-grid-sm tbody td:first-child { text-align: left; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: #94a3b8; white-space: nowrap; }
.metric-val-sm { font-size: 15px; font-weight: 700; line-height: 1; display: block; }

/* Color utilities */
.green { color: #16a34a; }
.amber { color: #d97706; }
.red   { color: #dc2626; }

/* Section */
.section { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 20px; overflow: hidden; }
.section-title { font-weight: 600; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; padding: 12px 16px; border-bottom: 1px solid #f1f5f9; }

/* Table */
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th { background: #f8fafc; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; padding: 10px 12px; text-align: left; border-bottom: 1px solid #e2e8f0; }
td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
tr:last-child td { border-bottom: none; }
.prompt-cell { max-width: 480px; word-break: break-word; color: #334155; }

/* Details */
.details-btn { background: none; border: 1px solid #e2e8f0; border-radius: 4px; cursor: pointer; padding: 2px 8px; font-size: 11px; color: #64748b; transition: background 0.15s; }
.details-btn:hover { background: #f1f5f9; }
.details-btn.open { color: #3b82f6; border-color: #3b82f6; }
.details-row > td { padding: 0; background: #f8fafc; }
.task-details { display: none; padding: 12px 16px; }
.task-details.visible { display: block; }
.trial-group-label { font-size: 11px; font-weight: 600; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.05em; margin: 8px 0 4px; }

/* Trials */
.trial { border: 1px solid #e2e8f0; border-radius: 6px; margin-bottom: 8px; overflow: hidden; }
.trial-header { display: flex; align-items: center; gap: 8px; padding: 8px 12px; font-weight: 500; font-size: 13px; background: #f8fafc; }
.trial-pass    .trial-header { border-left: 3px solid #22c55e; }
.trial-partial .trial-header { border-left: 3px solid #f59e0b; }
.trial-fail    .trial-header { border-left: 3px solid #ef4444; }
.trial-error   .trial-header { border-left: 3px solid #f59e0b; }
.trial-assertions { padding: 8px 12px; display: flex; flex-direction: column; gap: 6px; }

/* Pills */
.pill { display: inline-block; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 99px; letter-spacing: 0.05em; }
.pill.green { background: #dcfce7; color: #15803d; }
.pill.red   { background: #fee2e2; color: #b91c1c; }
.pill.amber { background: #fef3c7; color: #92400e; }

/* Assertions */
.assertion { display: flex; gap: 8px; }
.assert-icon { flex-shrink: 0; font-size: 14px; margin-top: 1px; }
.assert-pass .assert-icon { color: #16a34a; }
.assert-fail .assert-icon { color: #dc2626; }
.assert-body { flex: 1; min-width: 0; }
.assert-text { font-size: 13px; color: #1e293b; word-break: break-word; }
.assert-reason { font-size: 12px; color: #64748b; margin-top: 2px; word-break: break-word; }
.muted { color: #94a3b8; font-size: 13px; }
</style>
</head>
<body>
<div class="container">

  <!-- Header -->
  <div class="header">
    <h1>${escapeHtml(skill_name)}</h1>
    <div class="header-meta">
      <span><b>Agent</b> ${escapeHtml(agent)}</span>
      <span><b>Type</b> ${evalType}</span>
      <span><b>Date</b> ${escapeHtml(formattedDate)}</span>
    </div>
    <div class="status-bar ${statusClass}"></div>
  </div>

  <!-- Metrics Grid -->
  ${renderMetricsGrid(report)}

  <!-- Eval Results Table -->
  <div class="section">
    <div class="section-title">Eval results</div>
    ${renderTaskTable(report)}
  </div>

</div>
<script>
(function () {
  document.querySelectorAll('.details-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const target = document.getElementById(btn.getAttribute('data-target'));
      if (!target) return;
      const isOpen = target.classList.contains('visible');
      target.classList.toggle('visible', !isOpen);
      btn.classList.toggle('open', !isOpen);
      btn.textContent = isOpen ? '▶' : '▼';
    });
  });
}());
</script>
</body>
</html>`;
}
