import fs from 'fs';
import path from 'path';
import type { EvalSuiteReport, EvalTrial, ReportFrozenEvals, TaskResult } from '../types/index.js';
import { Logger } from '../utils/logger.js';
import type { Reporter } from './reporter.js';
import { detectAnomalies, type Anomaly } from '../core/anomalies.js';
import { hasFunctionalBaseline } from '../utils/table-renderer.js';

export class HtmlReporter implements Reporter {
  generate(report: EvalSuiteReport, runDir: string): void {
    const htmlPath = path.join(runDir, 'report.html');
    fs.writeFileSync(htmlPath, generateHtml(report), 'utf-8');
    Logger.write(`\n   Report: file://${htmlPath}\n`);
  }
}

// ---------------------------------------------------------------------------
// Run data
//
// The page receives every trial and renders all figures itself, so the rates,
// averages and per-expectation cells have exactly one implementation. Metrics
// already on the report are not embedded: they would be a second source of
// truth that silently drifts once a reviewer excludes a trial.
// ---------------------------------------------------------------------------

interface RunTrial {
  id: number;
  passed: boolean;
  isError: boolean;
  /** Per-assertion outcome in this trial's own order: 1 passed, 0 failed. */
  results: number[];
  reasons: string[];
  tokens?: { totalTokens: number };
  durationMs?: number;
  output: string;
  outputLen: number;
  toolCalls: number;
  stopStatus?: string;
  logFile?: string;
  anomalies: Anomaly[];
}

interface RunTask {
  taskId: number;
  prompt: string;
  shouldTrigger?: boolean;
  /** Canonical expectation order, taken from the first variant that recorded any. */
  assertions: string[];
  variants: Record<string, RunTrial[]>;
}

export interface RunData {
  runId: string;
  command: string;
  skill: string;
  executorAgent: string;
  /** Absent when no agent fulfils the judge role, as in a trigger run. */
  judgeAgent?: string;
  /** Absent when the run froze no evals. */
  frozenEvals?: ReportFrozenEvals;
  timestamp: string;
  tasks: RunTask[];
}

function toRunTrial(trial: EvalTrial, cohort: EvalTrial[]): RunTrial {
  return {
    id: trial.id,
    passed: trial.trialPassed,
    isError: trial.isError === true,
    results: trial.assertionResults.map(r => (r.passed ? 1 : 0)),
    reasons: trial.assertionResults.map(r => r.reason),
    tokens: trial.tokenStats ? { totalTokens: trial.tokenStats.totalTokens } : undefined,
    durationMs: trial.durationMs,
    output: trial.summary?.output ?? '',
    outputLen: trial.summary?.outputLen ?? 0,
    toolCalls: trial.summary?.toolCalls ?? 0,
    stopStatus: trial.summary?.stopStatus,
    logFile: trial.summary?.logFile,
    anomalies: detectAnomalies(trial, cohort),
  };
}

/** Variant order, baseline first so the comparison reads left to right. */
function variantsOf(result: TaskResult, functional: boolean): string[] {
  const skillVersions = Object.keys(result.skillTrials);
  return functional && (result.baselineTrials?.length ?? 0) > 0
    ? ['baseline', ...skillVersions]
    : skillVersions;
}

function trialsFor(result: TaskResult, variant: string): EvalTrial[] {
  return variant === 'baseline' ? result.baselineTrials : result.skillTrials[variant] ?? [];
}

export function buildRunData(report: EvalSuiteReport): RunData {
  const functional = isFunctional(report);

  return {
    // Matches the run directory name, so a reviewer's exclusions stay tied to
    // this run and not to any other report opened from the same browser.
    runId: report.timestamp.replace(/[:.]/g, '-'),
    command: report.command ?? (functional ? 'functional' : 'trigger'),
    skill: report.skill_name,
    executorAgent: report.executorAgent,
    judgeAgent: report.judgeAgent,
    frozenEvals: report.frozenEvals,
    timestamp: report.timestamp,
    tasks: report.results.map(result => {
      const variants = variantsOf(result, functional);

      let assertions: string[] = [];
      for (const v of variants) {
        const trials = trialsFor(result, v);
        if (trials.length > 0 && trials[0].assertionResults.length > 0) {
          assertions = trials[0].assertionResults.map(r => r.assertion);
          break;
        }
      }

      const byVariant: Record<string, RunTrial[]> = {};
      for (const v of variants) {
        const trials = trialsFor(result, v);
        byVariant[v] = trials.map(t => toRunTrial(t, trials));
      }

      return {
        taskId: result.taskId,
        prompt: result.prompt,
        shouldTrigger: result.shouldTrigger,
        assertions,
        variants: byVariant,
      };
    }),
  };
}

function isFunctional(report: EvalSuiteReport): boolean {
  return report.command === 'functional' || hasFunctionalBaseline(report);
}

/**
 * Serialises the run for embedding in a script tag. Agent output is arbitrary
 * text and routinely contains markup, so every "<" is escaped: an unescaped
 * "</script>" in a transcript would end the tag and break the page.
 */
function serializeRunData(data: RunData): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export function generateHtml(report: EvalSuiteReport): string {
  const data = buildRunData(report);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Skill Eval — ${escapeHtml(report.skill_name)}</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --ground: #f8fafc;
  --surface: #ffffff;
  --surface-sunk: #f8fafc;
  --ink: #1e293b;
  --ink-soft: #334155;
  --muted: #64748b;
  --muted-light: #94a3b8;
  --border: #e2e8f0;
  --border-soft: #f1f5f9;
  --green: #16a34a;
  --green-soft: #86efac;
  --amber: #d97706;
  --amber-bg: #fffbeb;
  --amber-border: #fcd34d;
  --amber-soft: #fcd34d;
  --red: #dc2626;
  --red-soft: #fca5a5;
  --blue: #3b82f6;
  --blue-bg: #e0f2fe;
  --blue-ink: #0369a1;
  --sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

body {
  font-family: var(--sans);
  background: var(--ground);
  color: var(--ink);
  font-size: 14px;
  line-height: 1.5;
}

.container { max-width: 1000px; margin: 0 auto; padding: 20px 16px 64px; }

/* ── Header ─────────────────────────────────────────────────── */
.header { background: var(--ink); color: #f1f5f9; padding: 24px 28px; border-radius: 10px; margin-bottom: 20px; }
.header h1 { font-size: 22px; font-weight: 700; margin-bottom: 8px; letter-spacing: -0.01em; }
.header-meta { display: flex; gap: 24px; flex-wrap: wrap; font-size: 13px; color: var(--muted-light); }
.header-meta span b { color: #e2e8f0; font-weight: 600; }
.status-bar { height: 4px; border-radius: 2px; margin-top: 16px; background: var(--red); transition: background 0.2s; }
.status-bar.green { background: #22c55e; }
.status-bar.amber { background: #f59e0b; }
.status-bar.red { background: #ef4444; }

/* ── Exclusion bar ──────────────────────────────────────────── */
.excl-bar {
  display: none; align-items: center; gap: 14px; flex-wrap: wrap;
  background: var(--surface); border: 1px solid var(--border);
  border-left: 3px solid var(--muted); border-radius: 8px;
  padding: 12px 16px; margin-bottom: 20px;
}
.excl-bar.active { display: flex; }
.excl-bar.warn { border-left-color: var(--amber); background: var(--amber-bg); border-color: var(--amber-border); }
.excl-bar .excl-icon { font-size: 15px; color: var(--muted); }
.excl-bar.warn .excl-icon { color: var(--amber); }
.excl-headline { font-size: 13px; font-weight: 600; color: var(--ink-soft); font-variant-numeric: tabular-nums; }
.excl-split { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
.excl-warn-msg { flex-basis: 100%; font-size: 12px; color: #92400e; line-height: 1.5; }
.excl-warn-msg:empty { display: none; }
.excl-actions { margin-left: auto; display: flex; gap: 8px; }

.btn {
  font-family: inherit; font-size: 11px; font-weight: 600; letter-spacing: 0.02em;
  padding: 5px 11px; border-radius: 5px; border: 1px solid var(--border);
  background: var(--surface); color: var(--muted); cursor: pointer; white-space: nowrap;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.btn:hover { background: var(--border-soft); color: var(--ink-soft); }
.btn:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
.btn.primary { background: var(--ink); border-color: var(--ink); color: #f1f5f9; }
.btn.primary:hover { background: #0f172a; color: #fff; }
.btn.danger { color: var(--red); border-color: #fecaca; }
.btn.danger:hover { background: #fef2f2; color: #b91c1c; }

/* ── Metrics grid ───────────────────────────────────────────── */
.metrics-grid { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; margin-bottom: 20px; }
.metrics-grid table { width: 100%; border-collapse: collapse; }
.metrics-grid thead th {
  background: var(--surface-sunk); font-size: 11px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.06em; color: var(--muted); padding: 10px 24px; text-align: right;
  border-bottom: 2px solid var(--border); white-space: nowrap;
}
.metrics-grid thead th:first-child { text-align: left; min-width: 120px; }
.metrics-grid tbody td { padding: 14px 24px; border-bottom: 1px solid var(--border-soft); text-align: right; vertical-align: middle; }
.metrics-grid tbody tr:last-child td { border-bottom: none; }
.metrics-grid tbody td:first-child {
  text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.06em; color: var(--muted); white-space: nowrap;
}
.metric-val { font-size: 24px; font-weight: 700; line-height: 1; display: block; font-variant-numeric: tabular-nums; }
.metric-sub { font-size: 11px; color: var(--muted-light); margin-top: 5px; font-variant-numeric: tabular-nums; }
.metric-sub s { text-decoration-color: #cbd5e1; }
.metric-sub .lowconf { color: var(--amber); font-weight: 600; }

.green { color: var(--green); }
.amber { color: var(--amber); }
.red { color: var(--red); }
.muted { color: var(--muted-light); }

/* ── Section + task table ───────────────────────────────────── */
.section { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 20px; overflow: hidden; }
.section-title {
  font-weight: 600; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--muted); padding: 12px 16px; border-bottom: 1px solid var(--border-soft);
}
.table-wrap { overflow-x: auto; }
.task-table { width: 100%; border-collapse: collapse; }
.task-table > thead th {
  background: var(--surface-sunk); font-size: 11px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.05em; color: var(--muted); padding: 10px 12px; text-align: left;
  border-bottom: 1px solid var(--border);
}
.task-table > tbody > tr > td { padding: 10px 12px; border-bottom: 1px solid var(--border-soft); vertical-align: top; }
.task-table > tbody > tr:last-child > td { border-bottom: none; }
.prompt-cell { max-width: 560px; word-break: break-word; color: var(--ink-soft); }

.details-btn {
  background: none; border: 1px solid var(--border); border-radius: 4px; cursor: pointer;
  padding: 2px 8px; font-size: 11px; color: var(--muted); font-family: inherit; transition: background 0.15s;
}
.details-btn:hover { background: var(--border-soft); }
.details-btn.open { color: var(--blue); border-color: var(--blue); }
.details-btn:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
.details-row > td { padding: 0 !important; background: var(--surface-sunk); }
.task-details { display: none; padding: 16px; }
.task-details.visible { display: block; }

/* ── Subsections: Summary / Trials / Expectations ───────────── */
.subsection + .subsection { margin-top: 20px; }
.subsection-title {
  display: flex; align-items: center; gap: 10px; margin-bottom: 9px;
  font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted);
}
.subsection-title::after { content: ''; flex: 1; height: 1px; background: var(--border); }
.subsection-title .st-count {
  font-size: 11.5px; font-weight: 500; text-transform: none; letter-spacing: 0;
  color: var(--muted-light); font-variant-numeric: tabular-nums;
}
.subsection-title .st-count .flagged { color: var(--amber); font-weight: 600; }

/* ── Trials table ───────────────────────────────────────────── */
.panel { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.trials-table { width: 100%; border-collapse: collapse; }

.trials-table thead th {
  background: var(--border-soft); font-size: 10px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.06em; color: #475569; padding: 8px 12px; text-align: left;
  border-bottom: 1px solid var(--border); white-space: nowrap;
}
.trials-table th.num, .trials-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
.trials-table th.act, .trials-table td.act { text-align: right; }

.variant-row > td {
  background: var(--surface-sunk); padding: 7px 12px;
  border-bottom: 1px solid var(--border); border-top: 1px solid var(--border);
}
.trials-table tbody tr.variant-row:first-child > td { border-top: none; }
.variant-row .variant-name {
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--blue-ink); background: var(--blue-bg); padding: 2px 8px; border-radius: 4px;
}
.variant-row .variant-meta { font-size: 11.5px; color: var(--muted); margin-left: 9px; font-variant-numeric: tabular-nums; }
.variant-row .variant-meta .off { color: var(--ink-soft); font-weight: 600; }

.trial-row > td { padding: 9px 12px; border-bottom: 1px solid var(--border-soft); vertical-align: middle; }
.trial-row { cursor: pointer; transition: background 0.12s; }
.trial-row:hover > td { background: #fbfcfd; }
.trial-row.open > td { background: var(--blue-bg); }

.tr-toggle {
  background: none; border: none; cursor: pointer; font-size: 9px; color: var(--muted-light);
  font-family: inherit; padding: 2px 4px; line-height: 1;
}
.tr-toggle:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; border-radius: 3px; }
.trial-row.open .tr-toggle { color: var(--blue); }

.tr-name { font-size: 12.5px; font-weight: 600; color: var(--ink-soft); white-space: nowrap; }
.tr-score .frac { font-size: 13px; font-weight: 700; line-height: 1.15; display: block; font-variant-numeric: tabular-nums; }
.tr-score .bar { display: block; width: 62px; height: 3px; background: var(--border); border-radius: 2px; margin-top: 4px; overflow: hidden; }
.tr-score .bar i { display: block; height: 100%; border-radius: 2px; }
.tr-score .bar i.green { background: var(--green); }
.tr-score .bar i.amber { background: var(--amber-soft); }
.tr-score .bar i.red { background: var(--red-soft); }

.tr-flags { line-height: 1.9; }
.flag-chip {
  display: inline-block; font-size: 10.5px; font-weight: 600; white-space: nowrap;
  color: #92400e; background: var(--amber-bg); border: 1px solid var(--amber-border);
  border-radius: 4px; padding: 1px 7px; margin-right: 5px;
}
.tr-flags .clean { font-size: 11.5px; color: var(--muted-light); }
.excl-note { font-size: 11.5px; color: var(--muted-light); font-style: italic; }
.tr-num { font-size: 12px; color: var(--muted); white-space: nowrap; }

/* Excluded state: absence, not failure — desaturate, don't recolor. */
.trial-row.excluded > td {
  background: repeating-linear-gradient(135deg, #fbfcfd, #fbfcfd 6px, var(--surface-sunk) 6px, var(--surface-sunk) 12px);
}
.trial-row.excluded:hover > td { background: repeating-linear-gradient(135deg, #f8fafc, #f8fafc 6px, var(--border-soft) 6px, var(--border-soft) 12px); }
.trial-row.excluded .tr-name,
.trial-row.excluded .tr-num { color: var(--muted-light); }
.trial-row.excluded .tr-score .frac { color: var(--muted-light); text-decoration: line-through; text-decoration-thickness: 1.5px; }
.trial-row.excluded .tr-score .bar i { background: #cbd5e1; }
.trial-row.excluded .flag-chip { color: var(--muted); background: var(--border-soft); border-color: var(--border); }
.excl-chip {
  display: inline-block; font-size: 10.5px; font-weight: 700; white-space: nowrap;
  color: #475569; background: #e2e8f0; border-radius: 4px; padding: 1px 7px; margin-right: 5px;
}

/* ── Trial detail row ───────────────────────────────────────── */
.trial-detail > td { padding: 0; background: var(--surface-sunk); border-bottom: 1px solid var(--border); }
.trial-detail-inner { padding: 13px 16px 15px; border-left: 3px solid var(--blue); }

.anomaly-row { display: flex; gap: 9px; align-items: baseline; padding: 5px 0; }
.anomaly-row + .anomaly-row { border-top: 1px dashed var(--border); }
.anomaly-why { font-size: 12px; color: var(--muted); line-height: 1.5; }
.no-anomaly { font-size: 12px; color: var(--muted-light); }

.td-label {
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em;
  color: var(--muted); margin: 14px 0 6px;
}
.output-box {
  font-family: var(--mono); font-size: 11.5px; line-height: 1.6; color: var(--ink-soft);
  background: var(--surface); border: 1px solid var(--border); border-radius: 5px;
  padding: 10px 12px; max-height: 230px; overflow: auto; white-space: pre-wrap; word-break: break-word;
}
.output-box.degenerate { color: var(--red); background: #fef2f2; border-color: #fecaca; }
.output-trunc { font-size: 10.5px; color: var(--muted-light); margin-top: 5px; }
.td-stats { font-size: 11.5px; color: var(--muted); margin-top: 12px; font-variant-numeric: tabular-nums; }
.td-stats b { color: var(--ink-soft); font-weight: 600; }
.td-log { font-size: 11.5px; color: var(--muted); margin-top: 5px; }
.td-log a { color: var(--blue); font-family: var(--mono); font-size: 11px; }

.reason-bar {
  display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
  margin-top: 13px; padding-top: 12px; border-top: 1px solid var(--border);
  font-size: 11.5px; color: var(--muted);
}
select, input[type="text"] {
  font-family: inherit; font-size: 11.5px; color: var(--ink-soft); background: var(--surface);
  border: 1px solid var(--border); border-radius: 5px; padding: 4px 7px;
}
select:focus-visible, input:focus-visible { outline: 2px solid var(--blue); outline-offset: 1px; }
input[type="text"] { width: 190px; }

/* ── Expectations table ─────────────────────────────────────── */
.expectations-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.expectations-table thead th {
  background: var(--border-soft); font-size: 10px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.06em; color: #475569; padding: 9px 14px; text-align: left;
  border-bottom: 1px solid var(--border);
}
.expectations-table thead th.variant-col { width: 106px; text-align: center; }
.expectations-table tbody td { padding: 10px 14px; border-bottom: 1px solid var(--border-soft); vertical-align: middle; font-size: 12.5px; }
.expectations-table tbody tr.exp-row:last-of-type > td { border-bottom: none; }
.exp-text { color: var(--ink); line-height: 1.5; word-break: break-word; }
.exp-text code { font-family: var(--mono); font-size: 11px; background: var(--border-soft); padding: 1px 4px; border-radius: 3px; }

.pass-cell { text-align: center; border-left: 1px solid var(--border-soft); cursor: pointer; user-select: none; transition: background 0.12s; }
.pass-cell:hover { background: var(--border-soft); }
.pass-cell.open { background: var(--blue-bg); }
.pass-cell .rate { display: block; font-size: 13px; font-weight: 700; line-height: 1.15; font-variant-numeric: tabular-nums; }
.pass-cell .frac { display: block; font-size: 10px; font-weight: 600; color: var(--muted-light); margin-top: 2px; font-variant-numeric: tabular-nums; }
.pass-cell.green .rate { color: var(--green); }
.pass-cell.amber .rate { color: var(--amber); }
.pass-cell.red .rate { color: var(--red); }

.exp-detail-row > td { padding: 0; background: var(--surface-sunk); border-bottom: 1px solid var(--border-soft); }
.exp-detail-inner { padding: 12px 14px 14px; border-left: 3px solid var(--blue); }
.exp-detail-header { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin-bottom: 8px; }
.exp-trial-line { display: flex; gap: 8px; padding: 6px 0; border-top: 1px dashed var(--border); }
.exp-trial-line:first-of-type { border-top: none; }
.exp-trial-line.is-excluded { opacity: 0.5; }
.exp-trial-icon { flex-shrink: 0; font-size: 13px; font-weight: 700; line-height: 1.45; width: 16px; }
.exp-trial-icon.pass { color: var(--green); }
.exp-trial-icon.fail { color: var(--red); }
.exp-trial-icon.off { color: var(--muted-light); }
.exp-trial-body { flex: 1; min-width: 0; font-size: 12px; color: var(--ink-soft); line-height: 1.5; }
.exp-trial-body .trial-label { font-weight: 700; color: #475569; margin-right: 4px; }
.exp-trial-body .trial-reason { color: var(--muted); }
.exp-trial-line.is-excluded .trial-reason { text-decoration: line-through; text-decoration-color: #cbd5e1; }

/* ── Mini metrics (Summary subsection) ──────────────────────── */
.metrics-grid-sm table { width: 100%; border-collapse: collapse; }
.metrics-grid-sm thead th {
  background: var(--border-soft); font-size: 10px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.06em; color: #475569; padding: 8px 14px; text-align: right;
  border-bottom: 1px solid var(--border); white-space: nowrap;
}
.metrics-grid-sm thead th:first-child { text-align: left; }
.metrics-grid-sm tbody td { padding: 9px 14px; border-bottom: 1px solid var(--border-soft); text-align: right; }
.metrics-grid-sm tbody tr:last-child td { border-bottom: none; }
.metrics-grid-sm tbody td:first-child {
  text-align: left; font-size: 10px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.06em; color: var(--muted-light); white-space: nowrap;
}
.metric-val-sm { font-size: 15px; font-weight: 700; line-height: 1.15; display: block; font-variant-numeric: tabular-nums; }
.metric-sub-sm { font-size: 10px; color: var(--muted-light); margin-top: 3px; font-variant-numeric: tabular-nums; }

/* ── Toast ──────────────────────────────────────────────────── */
.toast {
  position: fixed; bottom: 20px; left: 50%; transform: translate(-50%, 12px);
  background: var(--ink); color: #f1f5f9; font-size: 12.5px; padding: 10px 16px;
  border-radius: 6px; opacity: 0; pointer-events: none; transition: opacity 0.2s, transform 0.2s;
  max-width: min(540px, calc(100vw - 32px)); text-align: center; line-height: 1.5;
}
.toast.visible { opacity: 1; transform: translate(-50%, 0); }

@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>
</head>
<body>

<div class="container">

  <div class="header">
    <h1 id="hdr-skill">—</h1>
    <div class="header-meta">
      <span><b>Executor</b> <span id="hdr-executor">—</span></span>
      <span id="hdr-judge-wrap" hidden><b>Judge</b> <span id="hdr-judge">—</span></span>
      <span id="hdr-evals-wrap" hidden><b>Evals</b> <span id="hdr-evals">—</span></span>
      <span><b>Type</b> <span id="hdr-type">—</span></span>
      <span><b>Date</b> <span id="hdr-date">—</span></span>
    </div>
    <div class="status-bar" id="hdr-status"></div>
  </div>

  <div class="excl-bar" id="excl-bar">
    <span class="excl-icon" aria-hidden="true">⊘</span>
    <span class="excl-headline" id="excl-headline"></span>
    <span class="excl-split" id="excl-split"></span>
    <span class="excl-actions">
      <button class="btn" id="btn-reset" type="button">Clear</button>
      <button class="btn primary" id="btn-download" type="button">Download reviewed copy</button>
    </span>
    <span class="excl-warn-msg" id="excl-warn"></span>
  </div>

  <div class="metrics-grid" id="metrics-grid"></div>

  <div class="section">
    <div class="section-title">Eval results</div>
    <div class="table-wrap">
      <table class="task-table">
        <thead><tr><th style="width:44px">#</th><th>Prompt</th><th style="width:80px">Details</th></tr></thead>
        <tbody id="task-tbody"></tbody>
      </table>
    </div>
  </div>

</div>

<div class="toast" id="toast" role="status" aria-live="polite"></div>


<div class="toast" id="toast" role="status" aria-live="polite"></div>

<script id="run-data" type="application/json">${serializeRunData(data)}</script>
<script>
(function () {
  'use strict';

  var RUN = JSON.parse(document.getElementById('run-data').textContent);

  /* ── Exclusion state ────────────────────────────────────────
     key = "<taskId>:<variant>:<trialId>" → { reason, note, at }
     In the real reporter this same shape is what gets baked into
     the downloaded copy. Here it also round-trips to localStorage. */
  var STORE_KEY = 'skill-eval:excl:' + RUN.runId;
  var excluded = {};

  var REASONS = [
    ['degenerate-output', 'Degenerate output'],
    ['zero-assertions', 'Zero assertions'],
    ['premature-stop', 'Premature stop'],
    ['resource-outlier', 'Resource outlier'],
    ['environment', 'Environment problem'],
    ['infrastructure', 'Infrastructure'],
    ['other', 'Other']
  ];
  function reasonLabel(id) {
    for (var i = 0; i < REASONS.length; i++) if (REASONS[i][0] === id) return REASONS[i][1];
    return id;
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) { excluded = JSON.parse(raw) || {}; return; }
    } catch (e) { /* file:// or blocked storage — fall through to the baked state */ }

    // Opened elsewhere: a reviewed copy carries the exclusions it was saved with.
    var baked = document.getElementById('excl-data');
    if (!baked) return;
    try { excluded = JSON.parse(decodeURIComponent(baked.textContent)) || {}; }
    catch (e) { /* corrupt payload — start clean rather than fail to render */ }
  }
  function saveState() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(excluded)); }
    catch (e) { /* non-fatal: the download is the durable path */ }
  }

  function key(taskId, variant, trialId) { return taskId + ':' + variant + ':' + trialId; }
  function isExcluded(taskId, variant, trial) { return !!excluded[key(taskId, variant, trial.id)]; }

  /* ── Aggregation ────────────────────────────────────────────
     One implementation, used for the initial render and every
     recompute. A trial leaves the denominator when it is excluded
     or when it is an infrastructure error. */
  function counted(taskId, variant, trials) {
    return trials.filter(function (t) { return !t.isError && !isExcluded(taskId, variant, t); });
  }

  function rateOf(trials) {
    var total = 0, passed = 0;
    trials.forEach(function (t) {
      total += t.results.length;
      passed += t.results.reduce(function (s, v) { return s + v; }, 0);
    });
    return total ? passed / total : 0;
  }

  function taskRate(taskId, variant, trials) {
    var live = counted(taskId, variant, trials);
    return { rate: rateOf(live), n: live.length, of: trials.length };
  }

  function avgOver(trials, field) {
    var vals = [];
    trials.forEach(function (t) {
      if (field === 'tokens' && t.tokens) vals.push(t.tokens.totalTokens);
      if (field === 'duration' && t.durationMs != null) vals.push(t.durationMs);
    });
    if (!vals.length) return null;
    return Math.round(vals.reduce(function (s, v) { return s + v; }, 0) / vals.length);
  }

  /* Suite level: average of per-task rates, matching aggregateAssertionPassRate. */
  function suiteRate(variant, useExclusions) {
    var sum = 0, n = 0, live = 0, all = 0;
    RUN.tasks.forEach(function (task) {
      var trials = task.variants[variant];
      if (!trials) return;
      var relevant = trials.filter(function (t) {
        return !t.isError && (!useExclusions || !isExcluded(task.taskId, variant, t));
      });
      sum += rateOf(relevant);
      n += 1;
      live += relevant.length;
      all += trials.length;
    });
    return { rate: n ? sum / n : 0, n: live, of: all };
  }

  function suiteAvg(variant, field) {
    var live = [];
    RUN.tasks.forEach(function (task) {
      counted(task.taskId, variant, task.variants[variant] || []).forEach(function (t) { live.push(t); });
    });
    return avgOver(live, field);
  }

  /* Anomalies are computed by core/anomalies.ts and embedded per trial;
     the page only renders them. */
  function anomaliesOf(trial) { return trial.anomalies || []; }

  function score(trial) { return trial.results.reduce(function (s, v) { return s + v; }, 0); }

  /* ── Formatting ─────────────────────────────────────────────── */
  function fmtPct(v) { return Math.round(v * 100) + '%'; }
  function fmtTokens(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return Math.round(n / 1000) + 'K';
    return String(n);
  }
  function fmtDuration(ms) {
    if (ms < 1000) return ms + 'ms';
    var s = Math.round(ms / 1000);
    if (s < 60) return s + 's';
    var m = Math.floor(s / 60), rem = s % 60;
    return rem > 0 ? m + 'm ' + rem + 's' : m + 'm';
  }
  function colorClass(v) { return v >= 0.8 ? 'green' : v >= 0.5 ? 'amber' : 'red'; }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  /* Backticks in assertions are the skill's own symbol names — render them as code. */
  function escTicks(s) {
    return esc(s).replace(/\`([^\`]+)\`/g, function (_, inner) { return '<code>' + inner + '</code>'; });
  }
  function cssId(s) { return String(s).replace(/[^a-zA-Z0-9_-]+/g, '-'); }

  function variantsOf(task) {
    var names = Object.keys(task.variants);
    names.sort(function (a, b) { return a === 'baseline' ? -1 : b === 'baseline' ? 1 : 0; });
    return names;
  }
  var ALL_VARIANTS = variantsOf(RUN.tasks[0]);
  var TRIAL_COLS = 7;

  /* What is open, so a recompute never collapses what is being read.
     One trial at a time per task keeps the page from turning into a wall. */
  var openTrial = {};   /* taskId → "variant:trialId" */
  var openExp = {};     /* detailId → bool */

  /* ── Render: header + suite metrics ─────────────────────────── */
  function renderHeader() {
    document.getElementById('hdr-skill').textContent = RUN.skill;
    document.getElementById('hdr-executor').textContent = RUN.executorAgent;
    /* A run nobody judged says so by leaving the role out, not by naming an agent. */
    document.getElementById('hdr-judge').textContent = RUN.judgeAgent || '';
    document.getElementById('hdr-judge-wrap').hidden = !RUN.judgeAgent;
    /* Which evals produced these numbers. Frozen at the start of the run and shared
       by every variant, so they are what a later comparison has to reuse. */
    var frozen = RUN.frozenEvals;
    var frozenWrap = document.getElementById('hdr-evals-wrap');
    document.getElementById('hdr-evals').textContent = frozen
      ? (frozen.evalFiles.length ? frozen.evalFiles.join(', ') : frozen.frozen + '/')
      : '';
    frozenWrap.title = frozen ? 'Frozen from ' + frozen.source + ' into ' + frozen.frozen + '/' : '';
    frozenWrap.hidden = !frozen;
    document.getElementById('hdr-type').textContent = RUN.command === 'functional' ? 'Functional' : 'Trigger';
    document.getElementById('hdr-date').textContent = new Date(RUN.timestamp).toLocaleString();
  }

  function renderSuiteMetrics() {
    var head = ALL_VARIANTS.map(function (v) { return '<th>' + esc(v) + '</th>'; }).join('');

    var successCells = ALL_VARIANTS.map(function (v) {
      var adj = suiteRate(v, true), raw = suiteRate(v, false);
      var sub = adj.n !== raw.n
        ? '<div class="metric-sub">raw <s>' + fmtPct(raw.rate) + '</s> · n=' + adj.n + '/' + adj.of +
          (adj.n < 3 ? ' · <span class="lowconf">low-confidence</span>' : '') + '</div>'
        : '<div class="metric-sub">n=' + adj.n + '/' + adj.of + '</div>';
      return '<td><span class="metric-val ' + colorClass(adj.rate) + '">' + fmtPct(adj.rate) + '</span>' + sub + '</td>';
    }).join('');

    var tokenCells = ALL_VARIANTS.map(function (v) {
      var t = suiteAvg(v, 'tokens');
      return '<td>' + (t != null
        ? '<span class="metric-val">' + fmtTokens(t) + '</span><div class="metric-sub">avg total</div>'
        : '<span class="metric-val muted">—</span>') + '</td>';
    }).join('');

    var timeCells = ALL_VARIANTS.map(function (v) {
      var d = suiteAvg(v, 'duration');
      return '<td>' + (d != null
        ? '<span class="metric-val">' + fmtDuration(d) + '</span>'
        : '<span class="metric-val muted">—</span>') + '</td>';
    }).join('');

    document.getElementById('metrics-grid').innerHTML =
      '<table><thead><tr><th></th>' + head + '</tr></thead><tbody>' +
      '<tr><td>Success Rate</td>' + successCells + '</tr>' +
      '<tr><td>Tokens (avg)</td>' + tokenCells + '</tr>' +
      '<tr><td>Time (avg)</td>' + timeCells + '</tr>' +
      '</tbody></table>';

    var target = ALL_VARIANTS.indexOf('local') >= 0 ? 'local' : ALL_VARIANTS[ALL_VARIANTS.length - 1];
    document.getElementById('hdr-status').className = 'status-bar ' + colorClass(suiteRate(target, true).rate);
  }

  /* ── Render: exclusion bar ──────────────────────────────────── */
  function renderExclusionBar() {
    var perVariant = {}, total = 0, all = 0;
    ALL_VARIANTS.forEach(function (v) { perVariant[v] = 0; });
    RUN.tasks.forEach(function (task) {
      ALL_VARIANTS.forEach(function (v) {
        (task.variants[v] || []).forEach(function (t) {
          all += 1;
          if (isExcluded(task.taskId, v, t)) { perVariant[v] += 1; total += 1; }
        });
      });
    });

    var bar = document.getElementById('excl-bar');
    if (!total) { bar.classList.remove('active', 'warn'); return; }
    bar.classList.add('active');

    document.getElementById('excl-headline').textContent =
      total + ' of ' + all + ' trials excluded (' + Math.round((total / all) * 100) + '%)';
    document.getElementById('excl-split').textContent =
      ALL_VARIANTS.map(function (v) { return perVariant[v] + ' ' + v; }).join(' · ');

    /* Asymmetric exclusions are the p-hacking failure mode: warn loudly. */
    var counts = ALL_VARIANTS.map(function (v) { return perVariant[v]; });
    var lopsided = ALL_VARIANTS.length > 1 && Math.max.apply(null, counts) !== Math.min.apply(null, counts);
    bar.classList.toggle('warn', lopsided);
    document.getElementById('excl-warn').textContent = lopsided
      ? 'Exclusions are not balanced across variants. Check that you applied the same criterion to each — ' +
        'excluding more from one than another moves the delta you are measuring.'
      : '';
  }

  /* ── Render: task rows ──────────────────────────────────────── */
  function renderTasks() {
    var tbody = document.getElementById('task-tbody');
    tbody.innerHTML = RUN.tasks.map(function (task) {
      return '<tr>' +
        '<td>' + task.taskId + '</td>' +
        '<td class="prompt-cell">' + esc(task.prompt) + '</td>' +
        '<td><button class="details-btn" type="button" data-task="' + task.taskId + '" aria-expanded="false">▶</button></td>' +
        '</tr>' +
        '<tr class="details-row"><td colspan="3">' +
        '<div class="task-details" id="details-' + task.taskId + '"></div></td></tr>';
    }).join('');

    tbody.querySelectorAll('.details-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var panel = document.getElementById('details-' + btn.getAttribute('data-task'));
        var open = panel.classList.toggle('visible');
        btn.classList.toggle('open', open);
        btn.textContent = open ? '▼' : '▶';
        btn.setAttribute('aria-expanded', String(open));
      });
    });
  }

  /* ── Subsection: Summary ────────────────────────────────────── */
  function renderSummary(task) {
    var head = ALL_VARIANTS.map(function (v) { return '<th>' + esc(v) + '</th>'; }).join('');

    var successCells = ALL_VARIANTS.map(function (v) {
      var trials = task.variants[v] || [];
      if (!trials.length) return '<td><span class="metric-val-sm muted">—</span></td>';
      var adj = taskRate(task.taskId, v, trials);
      var rawLive = trials.filter(function (t) { return !t.isError; });
      var sub = adj.n !== rawLive.length
        ? '<div class="metric-sub-sm">raw <s>' + fmtPct(rateOf(rawLive)) + '</s> · n=' + adj.n + '/' + adj.of + '</div>'
        : '<div class="metric-sub-sm">n=' + adj.n + '/' + adj.of + '</div>';
      return '<td><span class="metric-val-sm ' + colorClass(adj.rate) + '">' + fmtPct(adj.rate) + '</span>' + sub + '</td>';
    }).join('');

    function avgCells(field, fmt) {
      return ALL_VARIANTS.map(function (v) {
        var val = avgOver(counted(task.taskId, v, task.variants[v] || []), field);
        return '<td><span class="metric-val-sm' + (val == null ? ' muted' : '') + '">' +
          (val == null ? '—' : fmt(val)) + '</span></td>';
      }).join('');
    }

    return '<div class="subsection"><div class="subsection-title">Summary</div>' +
      '<div class="panel metrics-grid-sm"><table><thead><tr><th></th>' + head + '</tr></thead><tbody>' +
      '<tr><td>Success Rate</td>' + successCells + '</tr>' +
      '<tr><td>Tokens (avg)</td>' + avgCells('tokens', fmtTokens) + '</tr>' +
      '<tr><td>Time (avg)</td>' + avgCells('duration', fmtDuration) + '</tr>' +
      '</tbody></table></div></div>';
  }

  /* ── Subsection: Trials ─────────────────────────────────────── */
  function renderTrials(task) {
    var totalTrials = 0, totalFlagged = 0, totalExcluded = 0;
    var body = '';

    ALL_VARIANTS.forEach(function (variant) {
      var trials = task.variants[variant] || [];
      if (!trials.length) return;

      var flagged = 0, off = 0;
      trials.forEach(function (t) {
        if (anomaliesOf(t).length) flagged += 1;
        if (isExcluded(task.taskId, variant, t)) off += 1;
      });
      totalTrials += trials.length; totalFlagged += flagged; totalExcluded += off;

      var meta = trials.length + ' trials';
      if (flagged) meta += ' · ' + flagged + ' flagged';
      if (off) meta += ' · <span class="off">' + off + ' excluded</span>';

      body += '<tr class="variant-row"><td colspan="' + TRIAL_COLS + '">' +
        '<span class="variant-name">' + esc(variant) + '</span>' +
        '<span class="variant-meta">' + meta + '</span></td></tr>';

      trials.forEach(function (t) {
        body += renderTrialRow(task, variant, t, trials);
      });
    });

    var count = totalTrials + ' trials';
    if (totalFlagged) count += ' · <span class="flagged">' + totalFlagged + ' flagged</span>';
    if (totalExcluded) count += ' · ' + totalExcluded + ' excluded';

    return '<div class="subsection">' +
      '<div class="subsection-title">Trials <span class="st-count">' + count + '</span></div>' +
      '<div class="panel"><table class="trials-table">' +
      '<thead><tr>' +
        '<th style="width:30px"></th>' +
        '<th style="width:78px">Trial</th>' +
        '<th style="width:86px">Assertions</th>' +
        '<th>Anomalies</th>' +
        '<th class="num" style="width:74px">Tokens</th>' +
        '<th class="num" style="width:70px">Time</th>' +
        '<th class="act" style="width:104px">Status</th>' +
      '</tr></thead><tbody>' + body + '</tbody></table></div></div>';
  }

  function renderTrialRow(task, variant, trial, cohort) {
    var flags = anomaliesOf(trial);
    var k = key(task.taskId, variant, trial.id);
    var state = excluded[k];
    var isOpen = openTrial[task.taskId] === variant + ':' + trial.id;
    var sc = score(trial), tot = trial.results.length;
    var rate = tot ? sc / tot : 0;

    /* Once excluded, the reason replaces the flags — the anomalies stay in the detail row. */
    var flagCells = state
      ? '<span class="excl-chip">' + esc(reasonLabel(state.reason)) + '</span>' +
        (state.note ? '<span class="excl-note">' + esc(state.note) + '</span>' : '')
      : (flags.length
          ? flags.map(function (f) { return '<span class="flag-chip">⚠ ' + esc(f.tag) + '</span>'; }).join('')
          : '<span class="clean">—</span>');

    var row = '<tr class="trial-row' + (state ? ' excluded' : '') + (isOpen ? ' open' : '') + '" ' +
      'data-task="' + task.taskId + '" data-variant="' + esc(variant) + '" data-trial="' + trial.id + '">' +
      '<td><button class="tr-toggle" type="button" aria-expanded="' + isOpen + '" ' +
        'aria-label="Show detail for trial ' + trial.id + '">' + (isOpen ? '▼' : '▶') + '</button></td>' +
      '<td class="tr-name">Trial ' + trial.id + '</td>' +
      '<td class="tr-score">' +
        '<span class="frac ' + (state ? '' : colorClass(rate)) + '">' + sc + '/' + tot + '</span>' +
        '<span class="bar"><i class="' + colorClass(rate) + '" style="width:' + Math.round(rate * 1000) / 10 + '%"></i></span>' +
      '</td>' +
      '<td class="tr-flags">' + flagCells + '</td>' +
      '<td class="num tr-num">' + (trial.tokens ? fmtTokens(trial.tokens.totalTokens) : '—') + '</td>' +
      '<td class="num tr-num">' + (trial.durationMs != null ? fmtDuration(trial.durationMs) : '—') + '</td>' +
      '<td class="act"><button class="btn ' + (state ? '' : 'danger') + '" type="button" ' +
        'data-act="' + (state ? 'include' : 'exclude') + '">' +
        (state ? 'Re-include' : '⊘ Exclude') + '</button></td>' +
      '</tr>';

    return row + (isOpen ? renderTrialDetail(task, variant, trial, flags, state) : '');
  }

  function renderTrialDetail(task, variant, trial, flags, state) {
    var anomalyHtml = flags.length
      ? flags.map(function (f) {
          return '<div class="anomaly-row"><span class="flag-chip">' + esc(f.tag) + '</span>' +
            '<span class="anomaly-why">' + esc(f.reason) + '</span></div>';
        }).join('')
      : '<div class="no-anomaly">No anomalies detected — this reads as a legitimate attempt.</div>';

    var degenerate = flags.some(function (f) { return f.tag === 'degenerate-output'; });
    var truncated = trial.outputLen > trial.output.length;

    /* The reason controls only exist once there is something to justify. */
    var reasonBar = state
      ? '<div class="reason-bar"><span>Reason</span>' +
          '<select data-role="reason">' +
            REASONS.map(function (r) {
              return '<option value="' + r[0] + '"' + (r[0] === state.reason ? ' selected' : '') + '>' +
                r[1] + '</option>';
            }).join('') +
          '</select>' +
          '<input type="text" data-role="note" placeholder="Note (optional)" value="' +
            esc(state.note || '') + '">' +
        '</div>'
      : '';

    return '<tr class="trial-detail"><td colspan="' + TRIAL_COLS + '"><div class="trial-detail-inner">' +
      anomalyHtml +
      '<div class="td-label">Final agent output</div>' +
      '<div class="output-box' + (degenerate ? ' degenerate' : '') + '">' +
        esc(trial.output || '(empty)') + '</div>' +
      (truncated ? '<div class="output-trunc">Truncated to ' + trial.output.length + ' of ' +
        trial.outputLen + ' characters.</div>' : '') +
      '<div class="td-stats"><b>' + trial.toolCalls + '</b> tool calls · stop: <b>' +
        esc(trial.stopStatus || '—') + '</b> · <b>' +
        (trial.tokens ? fmtTokens(trial.tokens.totalTokens) : '—') + '</b> tokens · <b>' +
        (trial.durationMs != null ? fmtDuration(trial.durationMs) : '—') + '</b></div>' +
      (trial.logFile
        ? '<div class="td-log">Full transcript: <a href="' + esc(trial.logFile) + '">' +
          esc(trial.logFile) + '</a></div>'
        : '') +
      reasonBar +
      '</div></td></tr>';
  }

  /* ── Subsection: Expectations ───────────────────────────────── */
  function renderExpectations(task) {
    var totalCols = 1 + ALL_VARIANTS.length;
    var head = ALL_VARIANTS.map(function (v) { return '<th class="variant-col">' + esc(v) + '</th>'; }).join('');

    var rows = task.assertions.map(function (assertion, idx) {
      var cells = '', details = '';
      ALL_VARIANTS.forEach(function (v) {
        var trials = task.variants[v] || [];
        var live = counted(task.taskId, v, trials);
        var passed = live.filter(function (t) { return t.results[idx] === 1; }).length;
        var rate = live.length ? passed / live.length : 0;
        var detailId = 'exp-' + task.taskId + '-' + idx + '-' + cssId(v);

        cells += '<td class="pass-cell ' + colorClass(rate) + (openExp[detailId] ? ' open' : '') +
          '" data-detail="' + detailId + '">' +
          '<span class="rate">' + fmtPct(rate) + '</span>' +
          '<span class="frac">' + passed + ' / ' + live.length + '</span></td>';

        if (openExp[detailId]) {
          var lines = trials.map(function (t) {
            var off = isExcluded(task.taskId, v, t);
            var ok = t.results[idx] === 1;
            return '<div class="exp-trial-line' + (off ? ' is-excluded' : '') + '">' +
              '<div class="exp-trial-icon ' + (off ? 'off' : ok ? 'pass' : 'fail') + '">' +
                (off ? '⊘' : ok ? '✓' : '✗') + '</div>' +
              '<div class="exp-trial-body"><span class="trial-label">Trial ' + t.id + '</span>' +
              '<span class="trial-reason">' + esc(t.reasons[idx] || '') + '</span></div></div>';
          }).join('');
          details += '<tr class="exp-detail-row"><td colspan="' + totalCols + '">' +
            '<div class="exp-detail-inner"><div class="exp-detail-header">Judge per trial · ' + esc(v) + '</div>' +
            lines + '</div></td></tr>';
        }
      });
      return '<tr class="exp-row"><td class="exp-text">' + escTicks(assertion) + '</td>' + cells + '</tr>' + details;
    }).join('');

    return '<div class="subsection">' +
      '<div class="subsection-title">Expectations <span class="st-count">' +
        task.assertions.length + ' expectations</span></div>' +
      '<div class="panel"><table class="expectations-table">' +
      '<thead><tr><th class="exp-col">Expectation</th>' + head + '</tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div></div>';
  }

  /* ── Wiring ─────────────────────────────────────────────────── */
  function renderTaskDetails(task) {
    var host = document.getElementById('details-' + task.taskId);
    if (!host) return;
    host.innerHTML = renderSummary(task) + renderTrials(task) + renderExpectations(task);
    wire(task, host);
  }

  function wire(task, host) {
    host.querySelectorAll('.trial-row').forEach(function (row) {
      var variant = row.getAttribute('data-variant');
      var trialId = parseInt(row.getAttribute('data-trial'), 10);
      var k = key(task.taskId, variant, trialId);

      row.addEventListener('click', function (ev) {
        if (ev.target.closest('[data-act]')) return;
        var slot = variant + ':' + trialId;
        openTrial[task.taskId] = openTrial[task.taskId] === slot ? null : slot;
        render();
      });

      var actBtn = row.querySelector('[data-act]');
      if (!actBtn) return;
      actBtn.addEventListener('click', function () {
        if (actBtn.getAttribute('data-act') === 'include') {
          delete excluded[k];
          toast('Trial ' + trialId + " of '" + variant + "' re-included");
        } else {
          /* Pre-fill the reason from the strongest signal; refine it in the detail row. */
          var trial = task.variants[variant].filter(function (t) { return t.id === trialId; })[0];
          var flags = anomaliesOf(trial);
          excluded[k] = {
            reason: flags.length ? flags[0].tag : 'other',
            note: '',
            at: new Date().toISOString()
          };
          openTrial[task.taskId] = variant + ':' + trialId;
          toast('Trial ' + trialId + " of '" + variant + "' excluded — " + reasonLabel(excluded[k].reason));
        }
        saveState();
        render();
      });
    });

    /* Reason + note live inside the open detail row; persist as they change. */
    host.querySelectorAll('.trial-detail [data-role]').forEach(function (input) {
      var row = input.closest('.trial-detail').previousElementSibling;
      var k = key(task.taskId, row.getAttribute('data-variant'), parseInt(row.getAttribute('data-trial'), 10));
      input.addEventListener('change', function () {
        if (!excluded[k]) return;
        if (input.getAttribute('data-role') === 'reason') excluded[k].reason = input.value;
        else excluded[k].note = input.value.trim();
        saveState();
        render();
      });
    });

    host.querySelectorAll('.pass-cell').forEach(function (cell) {
      cell.addEventListener('click', function () {
        var id = cell.getAttribute('data-detail');
        openExp[id] = !openExp[id];
        render();
      });
    });
  }

  function render() {
    renderSuiteMetrics();
    renderExclusionBar();
    RUN.tasks.forEach(renderTaskDetails);
  }

  var toastTimer;
  function toast(msg) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('visible'); }, 2600);
  }

  document.getElementById('btn-reset').addEventListener('click', function () {
    excluded = {};
    saveState();
    render();
    toast('Exclusions cleared');
  });

  /* Saves a copy of this page with the current exclusions baked in — the
     durable, shareable artifact. URI-encoded so a reviewer's note can contain
     any character without breaking out of the script tag. */
  document.getElementById('btn-download').addEventListener('click', function () {
    var baked = document.getElementById('excl-data');
    if (!baked) {
      baked = document.createElement('script');
      baked.id = 'excl-data';
      baked.type = 'application/json';
      document.body.appendChild(baked);
    }
    baked.textContent = encodeURIComponent(JSON.stringify(excluded));

    var link = document.createElement('a');
    var url = URL.createObjectURL(
      new Blob(['<!DOCTYPE html>\\n' + document.documentElement.outerHTML], { type: 'text/html' })
    );
    link.href = url;
    link.download = 'report-reviewed.html';
    link.click();
    URL.revokeObjectURL(url);
    toast('Saved report-reviewed.html with ' + Object.keys(excluded).length + ' exclusion(s)');
  });

  loadState();
  renderHeader();
  renderTasks();
  render();
}());
</script>
</body>
</html>`;
}
