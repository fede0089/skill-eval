import fs from 'fs';
import path from 'path';
import type { AssertionResult, EvalSuiteReport, EvalTrial, TaskResult } from '../types/index.js';
import { Logger } from '../utils/logger.js';
import type { Reporter } from './reporter.js';
import { formatTokens } from '../utils/table-renderer.js';

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
  return report.metrics.withoutSkillScore !== undefined;
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

function renderCard(label: string, value: string, colorClass: string): string {
  return `<div class="card"><div class="card-value ${colorClass}">${escapeHtml(value)}</div><div class="card-label">${escapeHtml(label)}</div></div>`;
}

function renderMetricsCards(report: EvalSuiteReport): string {
  const { metrics } = report;
  const numTrials = metrics.numTrials ?? 1;
  const cards: string[] = [];

  if (isFunctional(report)) {
    const bk = metrics.withoutSkillPassAtK ?? 0;
    const tk = metrics.passAtK ?? 0;
    const upliftRaw = parseInt(metrics.skillUplift ?? '0', 10);
    const upliftClass = upliftRaw > 0 ? 'green' : upliftRaw < 0 ? 'red' : 'amber';
    cards.push(renderCard('Without Skill Success Rate', formatPercent(bk), passColorClass(bk)));
    cards.push(renderCard('With Skill Success Rate', formatPercent(tk), passColorClass(tk)));
    cards.push(renderCard('Skill Uplift', escapeHtml(metrics.skillUplift ?? '0%'), upliftClass));

    const wo = metrics.tokenStats?.withoutSkill;
    const wi = metrics.tokenStats?.withSkill;
    if (wo) cards.push(renderCard('Tokens (w/o skill)', formatTokens(wo.avgTotal) + ' avg', ''));
    if (wi) cards.push(renderCard('Tokens (w/ skill)', formatTokens(wi.avgTotal) + ' avg', ''));
    if (wo && wi && wo.avgTotal > 0) {
      const delta = wi.avgTotal - wo.avgTotal;
      const deltaSign = delta >= 0 ? '+' : '';
      const deltaPct = Math.round((delta / wo.avgTotal) * 100);
      const deltaClass = delta > 0 ? 'amber' : delta < 0 ? 'green' : '';
      cards.push(renderCard('Token Delta', `${deltaSign}${deltaPct}%`, deltaClass));
    }
  } else {
    const k = metrics.passAtK ?? 0;
    cards.push(renderCard('Success Rate', formatPercent(k), passColorClass(k)));
    cards.push(renderCard('Tasks passed', `${metrics.passedCount}/${metrics.totalCount}`, passColorClass(metrics.passedCount / Math.max(metrics.totalCount, 1))));

    const wi = metrics.tokenStats?.withSkill;
    if (wi) cards.push(renderCard('Avg Tokens', formatTokens(wi.avgTotal), ''));
  }

  return `<div class="cards">${cards.join('')}</div>`;
}

// ---------------------------------------------------------------------------
// Trial details
// ---------------------------------------------------------------------------

function renderAssertions(assertions: AssertionResult[]): string {
  if (assertions.length === 0) return '<p class="muted">No assertions recorded.</p>';
  return assertions.map(a => {
    const icon = a.passed ? '✓' : '✗';
    const cls = a.passed ? 'assert-pass' : 'assert-fail';
    const grader = a.graderType ? `<span class="badge">${escapeHtml(a.graderType)}</span>` : '';
    return `<div class="assertion ${cls}">
  <span class="assert-icon">${icon}</span>
  <div class="assert-body">
    <div class="assert-text">${escapeHtml(a.assertion)}${grader}</div>
    ${a.reason ? `<div class="assert-reason">${escapeHtml(a.reason)}</div>` : ''}
  </div>
</div>`;
  }).join('');
}

function renderTrial(trial: EvalTrial, prefix: string): string {
  const cls = trial.isError ? 'trial-error' : trial.trialPassed ? 'trial-pass' : 'trial-fail';
  const badge = trial.isError
    ? '<span class="pill amber">! ERROR</span>'
    : trial.trialPassed
      ? '<span class="pill green">✓ PASS</span>'
      : '<span class="pill red">✗ NOT PASSED</span>';
  return `<div class="trial ${cls}">
  <div class="trial-header">${escapeHtml(prefix)} Trial ${trial.id} ${badge}</div>
  <div class="trial-assertions">${renderAssertions(trial.assertionResults)}</div>
</div>`;
}

function renderTaskDetails(result: TaskResult, isFunctionalEval: boolean): string {
  const sections: string[] = [];

  if (isFunctionalEval && result.withoutSkillTrials && result.withoutSkillTrials.length > 0) {
    sections.push('<div class="trial-group-label">Without Skill</div>');
    sections.push(...result.withoutSkillTrials.map(t => renderTrial(t, 'Without Skill')));
    sections.push('<div class="trial-group-label">With Skill</div>');
  }

  sections.push(...result.trials.map(t => renderTrial(t, 'With Skill')));

  return `<div class="task-details" id="details-${result.taskId}">${sections.join('')}</div>`;
}

// ---------------------------------------------------------------------------
// Task table
// ---------------------------------------------------------------------------

function renderTaskTable(report: EvalSuiteReport): string {
  const { results, metrics } = report;
  const numTrials = metrics.numTrials ?? 1;
  const functional = isFunctional(report);

  const headerCells = functional
    ? ['#', 'Prompt', 'Without Skill', 'With Skill', 'Details']
    : numTrials > 1
      ? ['#', 'Prompt', 'Success Rate', 'Details']
      : ['#', 'Prompt', 'Status', 'Details'];

  const headerRow = `<tr>${headerCells.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr>`;

  const rows = results.map(result => {
    const prompt = escapeHtml(result.prompt);
    const trials = result.trials;
    const bt = result.withoutSkillTrials ?? [];

    let statCells: string;
    if (functional) {
      const bp1 = bt.length ? Math.round((bt.filter(t => t.trialPassed).length / bt.length) * 100) : 0;
      const tp1 = trials.length ? Math.round((trials.filter(t => t.trialPassed).length / trials.length) * 100) : 0;
      statCells = `<td class="${passColorClass(bp1 / 100)}">${bp1}%</td><td class="${passColorClass(tp1 / 100)}">${tp1}%</td>`;
    } else if (numTrials > 1) {
      const p1 = Math.round((trials.filter(t => t.trialPassed).length / Math.max(trials.length, 1)) * 100);
      statCells = `<td class="${passColorClass(p1 / 100)}">${p1}%</td>`;
    } else {
      const trial = trials[0];
      if (trial?.isError) {
        statCells = `<td class="amber">(!) ERROR</td>`;
      } else {
        const passed = trial?.trialPassed ?? false;
        statCells = `<td class="${passed ? 'green' : 'red'}">${passed ? '✓ PASS' : '✗ FAIL'}</td>`;
      }
    }

    const detailsBtn = `<button class="details-btn" data-target="details-${result.taskId}">▶</button>`;
    const detailsRow = `<tr class="details-row"><td colspan="${headerCells.length}">${renderTaskDetails(result, functional)}</td></tr>`;

    return `<tr><td>${result.taskId}</td><td class="prompt-cell">${prompt}</td>${statCells}<td>${detailsBtn}</td></tr>${detailsRow}`;
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
  const overallScore = metrics.passAtK ?? 0;
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

/* Cards */
.cards { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 24px; }
.card { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; min-width: 120px; flex: 1; }
.card-value { font-size: 28px; font-weight: 700; line-height: 1; margin-bottom: 4px; }
.card-label { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }

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
.prompt-cell { max-width: 360px; word-break: break-word; color: #334155; }

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
.trial-pass  .trial-header { border-left: 3px solid #22c55e; }
.trial-fail  .trial-header { border-left: 3px solid #ef4444; }
.trial-error .trial-header { border-left: 3px solid #f59e0b; }
.trial-assertions { padding: 8px 12px; display: flex; flex-direction: column; gap: 6px; }

/* Pills */
.pill { display: inline-block; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 99px; letter-spacing: 0.05em; }
.pill.green { background: #dcfce7; color: #15803d; }
.pill.red   { background: #fee2e2; color: #b91c1c; }
.pill.amber { background: #fef3c7; color: #92400e; }

/* Badge */
.badge { display: inline-block; font-size: 10px; font-weight: 500; padding: 1px 6px; border-radius: 4px; background: #e2e8f0; color: #475569; margin-left: 6px; vertical-align: middle; }

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
      <span><b>Score</b> ${escapeHtml(metrics.withSkillScore)}</span>
    </div>
    <div class="status-bar ${statusClass}"></div>
  </div>

  <!-- Metric Cards -->
  ${renderMetricsCards(report)}

  <!-- Task Table -->
  <div class="section">
    <div class="section-title">Task results</div>
    ${renderTaskTable(report)}
  </div>

</div>
<script>
(function () {
  // Accordion
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
