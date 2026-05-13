import chalk from 'chalk';
import * as path from 'path';
import { AggregatedTokenStats, EvalSuiteReport, EvalTrial } from '../types/index.js';
import { Logger } from './logger.js';
import { computePassAtK } from '../core/statistics.js';

/**
 * Returns a color-coded assertion pass rate string for a set of trials.
 * Only non-error trials contribute assertions to the rate.
 * Color thresholds: ≥80% green, ≥50% yellow, <50% red.
 */
function formatAssertionRate(trials: EvalTrial[]): string {
  if (trials.length === 0) return chalk.gray('—');
  const allError = trials.every(t => t.isError);
  const someError = trials.some(t => t.isError);
  const relevant = trials.filter(t => !t.isError);
  const total = relevant.reduce((s, t) => s + t.assertionResults.length, 0);
  const passed = relevant.reduce((s, t) => s + t.assertionResults.filter(r => r.passed).length, 0);
  const pct = total > 0 ? Math.round((passed / total) * 100) : 0;
  if (allError) return chalk.yellow('Error');
  if (someError) return chalk.yellow(`${pct}%*`);
  if (pct >= 80) return chalk.green(`${pct}%`);
  if (pct >= 50) return chalk.yellow(`${pct}%`);
  return chalk.red(`${pct}%`);
}

/**
 * Formats a duration in milliseconds for human-readable display.
 * e.g. 45000 → "45s", 90000 → "1m 30s"
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

/**
 * Formats a token count for human-readable display.
 * Numbers >= 1M are shown as "1.2M", >= 1K as "119K", else as-is.
 */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return `${n}`;
}

export function hasFunctionalBaseline(report: EvalSuiteReport): boolean {
  if (report.results.some(result => (result.baselineTrials?.length ?? 0) > 0)) {
    return true;
  }
  return report.metrics.passAtK['baseline'] !== undefined || report.metrics.assertionPassRate['baseline'] !== undefined;
}

function formatTokenStatsLine(stats: AggregatedTokenStats): string {
  const total  = formatTokens(stats.avgTotal);
  const input  = formatTokens(stats.avgInput);
  const output = formatTokens(stats.avgOutput);
  const cached = formatTokens(stats.avgCached);
  return `${total} total  (${input} input + ${output} output,  ${cached} cached)`;
}

/**
 * Returns a color-coded pass@1 string for a set of trials:
 * - All errored  → yellow "Error"
 * - Some errored → yellow "X%*"  (unreliable, partial measurement)
 * - None errored → green  "X%"   (reliable measurement)
 */
function formatPassAt1(trials: EvalTrial[]): string {
  const allError = trials.length > 0 && trials.every(t => t.isError);
  const someError = trials.some(t => t.isError);
  const p1 = Math.round(computePassAtK(trials, 1) * 100);
  if (allError) return chalk.yellow('Error');
  if (someError) return chalk.yellow(`${p1}%*`);
  return chalk.green(`${p1}%`);
}

export interface RunHeaderConfig {
  command: 'trigger' | 'functional';
  skillName: string;
  agent: string;
  workspace: string;
  tasks: number;
  trials: number;
  maxAgents: number;
  timeoutMs?: number;
  runDir: string;
  evalId?: number;
}

const BOX_INNER = 56; // visible chars between │ and │ (one space padding each side)

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function boxLine(content = ''): string {
  const visible = stripAnsi(content).length;
  const pad = Math.max(0, BOX_INNER - visible);
  return chalk.gray('│') + ' ' + content + ' '.repeat(pad) + ' ' + chalk.gray('│');
}

function boxLabel(key: string, value: string): string {
  const keyPart = chalk.gray(key.padEnd(11));
  return boxLine(keyPart + ' ' + chalk.white(value));
}

/**
 * Renders a styled run-config header before the evaluation UI starts.
 * Always shown regardless of debug mode.
 */
export function renderRunHeader(config: RunHeaderConfig): void {
  const { command, skillName, agent, workspace, tasks, trials, maxAgents, timeoutMs, runDir, evalId } = config;

  let timeoutStr = 'None';
  if (timeoutMs && timeoutMs > 0) {
    const timeoutSec = timeoutMs / 1000;
    timeoutStr = timeoutSec % 60 === 0 ? `${timeoutSec / 60}m` : `${timeoutSec}s`;
  }

  const relRunDir = path.relative(workspace, runDir);
  const maxOutputLen = BOX_INNER - 13; // 11 label + 2 spaces
  const outputStr = relRunDir.length > maxOutputLen ? relRunDir.slice(0, maxOutputLen - 1) + '…' : relRunDir;

  const titleLabel = 'skill-eval';
  const dashes = '─'.repeat(BOX_INNER - titleLabel.length);
  const top = chalk.gray('┌─ ') + chalk.bold(titleLabel) + ' ' + chalk.gray(dashes + '┐');
  const bottom = chalk.gray('└' + '─'.repeat(BOX_INNER + 2) + '┘');

  const commandPart = evalId !== undefined ? `${command}  ·  eval #${evalId}` : command;
  const title = chalk.bold.cyan(skillName) + chalk.gray(`  ·  ${commandPart}`);
  const runLine = `${tasks} task${tasks !== 1 ? 's' : ''}  ·  ${trials} trial${trials !== 1 ? 's' : ''}  ·  agents ${maxAgents}`;

  process.stdout.write('\n');
  process.stdout.write(top + '\n');
  process.stdout.write(boxLine(title) + '\n');
  process.stdout.write(boxLine() + '\n');
  process.stdout.write(boxLabel('agent', agent) + '\n');
  process.stdout.write(boxLabel('run', runLine) + '\n');
  process.stdout.write(boxLabel('timeout', timeoutStr) + '\n');
  process.stdout.write(boxLabel('output', outputStr) + '\n');
  process.stdout.write(bottom + '\n\n');
}

/**
 * Renders a trigger evaluation summary table and rate line to the terminal.
 * Accepts a full EvalSuiteReport so it can be called from both live commands
 * and the `show` command (which reads from disk).
 */
export function renderTriggerTable(report: EvalSuiteReport): void {
  const { results, metrics } = report;
  const numTrials = metrics.numTrials || 1;

  // Identify all skill versions present in the results
  const skillVersions = results.length > 0 ? Object.keys(results[0].skillTrials) : ['local'];

  const header = ['ID', 'Prompt'];
  if (numTrials > 1) {
    for (const version of skillVersions) {
      header.push(`${version} Trials`, `${version} Rate`);
    }
  } else {
    for (const version of skillVersions) {
      header.push(`${version} Rate`);
    }
  }

  const tableData = [header];
  let hasPartialErrors = false;

  for (const result of results) {
    const promptSnippet = result.prompt.substring(0, 40) + (result.prompt.length > 40 ? '...' : '');
    const row = [result.taskId.toString(), promptSnippet];

    for (const version of skillVersions) {
      const trials = result.skillTrials[version] || [];
      const p1Cell = formatPassAt1(trials);
      const someError = trials.some(t => t.isError);
      const allError = trials.length > 0 && trials.every(t => t.isError);
      if (someError && !allError) hasPartialErrors = true;

      if (numTrials > 1) {
        const errorCount = trials.filter(t => t.isError).length;
        const passedCount = trials.filter(t => t.trialPassed).length;
        const trialsBase = `${passedCount}/${trials.length}`;
        const trialsStr = errorCount > 0 ? `${trialsBase} (${errorCount}!)` : trialsBase;
        const trialsCell = passedCount === trials.length ? chalk.green(trialsStr) : errorCount > 0 ? chalk.yellow(trialsStr) : chalk.red(trialsStr);
        row.push(trialsCell, p1Cell);
      } else {
        row.push(p1Cell);
      }
    }
    tableData.push(row);
  }

  Logger.table(tableData);

  if (hasPartialErrors) {
    Logger.write(chalk.yellow('\n   * Some trials did not complete due to infrastructure errors. success rate is computed over the trials that ran.'));
  }

  for (const version of skillVersions) {
    const percentage = Math.round((metrics.passAtK[version] || 0) * 100);
    Logger.write(`\n   ${version} Success Rate:   ${percentage}%`);

    const tokenStats = metrics.tokenStats?.[version];
    if (tokenStats) {
      Logger.write(`\n   Avg Tokens (${version}):   ${formatTokenStatsLine(tokenStats)}`);
    }
    const durationStats = metrics.durationStats?.[version];
    if (durationStats) {
      Logger.write(`\n   Avg Time (${version}):     ${formatDuration(durationStats.avgMs)}`);
    }
  }
}

/**
 * Renders a functional evaluation summary table and rate lines to the terminal.
 */
export function renderFunctionalTable(report: EvalSuiteReport): void {
  const { results, metrics } = report;

  // Identify all versions present (baseline + skill versions)
  const skillVersions = results.length > 0 ? Object.keys(results[0].skillTrials) : ['local'];
  const hasBaseline = hasFunctionalBaseline(report);
  const allVersions = hasBaseline ? ['baseline', ...skillVersions] : skillVersions;

  const header = ['ID', 'Prompt'];
  for (const version of allVersions) {
    header.push(version);
  }

  const tableData: string[][] = [header];
  let hasPartialErrors = false;

  for (const result of results) {
    const promptSnippet = result.prompt.substring(0, 40) + (result.prompt.length > 40 ? '...' : '');
    const row = [result.taskId.toString(), promptSnippet];

    // Baseline
    const woTrials = result.baselineTrials || [];
    if (hasBaseline) {
      if (woTrials.some(t => t.isError) && !woTrials.every(t => t.isError)) hasPartialErrors = true;
      row.push(formatAssertionRate(woTrials));
    }

    // Skills
    for (const version of skillVersions) {
      const wiTrials = result.skillTrials[version] || [];
      if (wiTrials.some(t => t.isError) && !wiTrials.every(t => t.isError)) hasPartialErrors = true;
      row.push(formatAssertionRate(wiTrials));
    }
    
    tableData.push(row);
  }

  Logger.table(tableData);

  if (hasPartialErrors) {
    Logger.write(chalk.yellow('\n   * Some trials did not complete due to infrastructure errors. success rate is computed over the trials that ran.'));
  }

  for (const version of allVersions) {
    const rate = Math.round(((metrics.assertionPassRate[version] ?? metrics.passAtK[version]) || 0) * 100);
    Logger.write(`\n   ${version} Rate:   ${rate}%`);

    const stats = metrics.tokenStats?.[version];
    if (stats) {
      Logger.write(`\n   Tokens (${version}):   ${formatTokenStatsLine(stats)}`);
    }
    const dStats = metrics.durationStats?.[version];
    if (dStats) {
      Logger.write(`\n   Time (${version}):     ${formatDuration(dStats.avgMs)} avg`);
    }
  }
}
