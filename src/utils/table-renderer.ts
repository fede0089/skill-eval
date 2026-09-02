import chalk from 'chalk';
import * as path from 'path';
import * as os from 'os';
import { AggregatedTokenStats, EvalSuiteReport, EvalTrial, ProposalRecord, ProposalVerdict, SessionBalance } from '../types/index.js';
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
  executorAgent: string;
  /** Omitted when no agent fulfils the judge role, as in a trigger run. */
  judgeAgent?: string;
  tasks: number;
  trials: number;
  maxAgents: number;
  timeoutMs?: number;
  runDir: string;
  evalId?: number;
  evalFile?: string;
}

const BOX_INNER = 56; // visible chars between │ and │ (one space padding each side)

/** Shortens a path under the user's home to its '~' form for display. */
function collapseHome(target: string): string {
  const home = os.homedir();
  return target === home || target.startsWith(home + path.sep)
    ? '~' + target.slice(home.length)
    : target;
}

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
  const { command, skillName, executorAgent, judgeAgent, tasks, trials, maxAgents, timeoutMs, runDir, evalId, evalFile } = config;

  let timeoutStr = 'None';
  if (timeoutMs && timeoutMs > 0) {
    const timeoutSec = timeoutMs / 1000;
    timeoutStr = timeoutSec % 60 === 0 ? `${timeoutSec / 60}m` : `${timeoutSec}s`;
  }

  // The run directory lives outside the workspace, so an absolute path is the only
  // useful form; truncating from the left keeps the run's own timestamp visible.
  const maxOutputLen = BOX_INNER - 13; // 11 label + 2 spaces
  const outputStr = collapseHome(runDir);
  const outputLine = outputStr.length > maxOutputLen
    ? '…' + outputStr.slice(outputStr.length - (maxOutputLen - 1))
    : outputStr;

  const titleLabel = 'skill-eval';
  const dashes = '─'.repeat(BOX_INNER - titleLabel.length);
  const top = chalk.gray('┌─ ') + chalk.bold(titleLabel) + ' ' + chalk.gray(dashes + '┐');
  const bottom = chalk.gray('└' + '─'.repeat(BOX_INNER + 2) + '┘');

  const filterParts: string[] = [];
  if (evalFile !== undefined) filterParts.push(evalFile);
  if (evalId !== undefined) filterParts.push(`eval #${evalId}`);
  const commandPart = [command, ...filterParts].join('  ·  ');
  const title = chalk.bold.cyan(skillName) + chalk.gray(`  ·  ${commandPart}`);
  const runLine = `${tasks} task${tasks !== 1 ? 's' : ''}  ·  ${trials} trial${trials !== 1 ? 's' : ''}  ·  agents ${maxAgents}`;

  process.stdout.write('\n');
  process.stdout.write(top + '\n');
  process.stdout.write(boxLine(title) + '\n');
  process.stdout.write(boxLine() + '\n');
  process.stdout.write(boxLabel('executor', executorAgent) + '\n');
  if (judgeAgent) process.stdout.write(boxLabel('judge', judgeAgent) + '\n');
  process.stdout.write(boxLabel('run', runLine) + '\n');
  process.stdout.write(boxLabel('timeout', timeoutStr) + '\n');
  process.stdout.write(boxLabel('output', outputLine) + '\n');
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

  // Only surface the polarity column when the suite actually contains negative evals.
  const hasNegativeEvals = results.some(r => r.shouldTrigger === false);

  const header = ['ID', 'Prompt'];
  if (hasNegativeEvals) header.push('Expect');
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
    if (hasNegativeEvals) {
      row.push(result.shouldTrigger === false ? chalk.cyan('no-trigger') : chalk.dim('trigger'));
    }

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

export interface EvolveHeaderConfig {
  skillName: string;
  executorAgent: string;
  judgeAgent: string;
  /** Absent while the session has no optimizer to invoke. */
  optimizerAgent?: string;
  evals: number;
  trials: number;
  maxAgents: number;
  /** Ceiling of optimizer invocations. Absent when the session runs none. */
  proposals?: number;
  timeoutMs?: number;
  sessionDir: string;
}

/**
 * Renders the compact summary of an evolution session before anything runs, in
 * the same box the evaluation commands use: the author sees what is about to be
 * measured, with which agents, and where the session writes.
 */
export function renderEvolveHeader(config: EvolveHeaderConfig): void {
  const { skillName, executorAgent, judgeAgent, optimizerAgent, evals, trials, maxAgents, proposals, timeoutMs, sessionDir } = config;

  let timeoutStr = 'None';
  if (timeoutMs && timeoutMs > 0) {
    const timeoutSec = timeoutMs / 1000;
    timeoutStr = timeoutSec % 60 === 0 ? `${timeoutSec / 60}m` : `${timeoutSec}s`;
  }

  const maxOutputLen = BOX_INNER - 13;
  const sessionStr = collapseHome(sessionDir);
  const sessionLine = sessionStr.length > maxOutputLen
    ? '…' + sessionStr.slice(sessionStr.length - (maxOutputLen - 1))
    : sessionStr;

  const titleLabel = 'skill-eval';
  const dashes = '─'.repeat(BOX_INNER - titleLabel.length);
  const top = chalk.gray('┌─ ') + chalk.bold(titleLabel) + ' ' + chalk.gray(dashes + '┐');
  const bottom = chalk.gray('└' + '─'.repeat(BOX_INNER + 2) + '┘');

  const title = chalk.bold.cyan(skillName) + chalk.gray('  ·  evolve');
  const runLine = `${evals} eval${evals !== 1 ? 's' : ''}  ·  ${trials} trial${trials !== 1 ? 's' : ''}  ·  agents ${maxAgents}`;

  process.stdout.write('\n');
  process.stdout.write(top + '\n');
  process.stdout.write(boxLine(title) + '\n');
  process.stdout.write(boxLine() + '\n');
  process.stdout.write(boxLabel('executor', executorAgent) + '\n');
  process.stdout.write(boxLabel('judge', judgeAgent) + '\n');
  if (optimizerAgent) process.stdout.write(boxLabel('optimizer', optimizerAgent) + '\n');
  process.stdout.write(boxLabel('run', runLine) + '\n');
  if (proposals !== undefined) process.stdout.write(boxLabel('proposals', String(proposals)) + '\n');
  process.stdout.write(boxLabel('timeout', timeoutStr) + '\n');
  process.stdout.write(boxLabel('session', sessionLine) + '\n');
  process.stdout.write(bottom + '\n\n');
}

/** Formats an effectiveness as a percentage with one decimal. */
function formatEffectiveness(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

const VERDICT_REASONS: Record<ProposalVerdict, string> = {
  'accepted': 'the aggregate improved and the prediction held',
  'not-better': 'the aggregate did not improve — equal is not better',
  'unattributable': 'the aggregate improved but a declared expectation did not',
  'total-regression': 'an expectation the incumbent always passed now always fails'
};

/**
 * Renders what the session did with one proposal: what was predicted, what the
 * comparison measured, and the decision with its reason. Rejections are shown in
 * as much detail as acceptances — a session is evidence of what did not work too.
 */
export function renderProposalOutcome(record: ProposalRecord): void {
  const origin = record.origin === 'working-tree' ? 'working tree' : 'optimizer';
  Logger.write(`\n${chalk.bold(`Proposal ${record.number}/${record.total}`)}${chalk.gray(`  ·  ${origin}`)}\n`);

  if (record.hypothesis) {
    Logger.write(`   ${chalk.gray('hypothesis'.padEnd(13))}${record.hypothesis}\n`);
  }

  const decision = record.decision;

  for (const [index, prediction] of record.predictions.entries()) {
    const label = index === 0 ? 'predicted' : '';
    const outcome = decision?.predictionsMet.find(o =>
      o.prediction.evalId === prediction.evalId && o.prediction.expectation === prediction.expectation);
    const rates = outcome
      ? `  ${formatEffectiveness(outcome.incumbentRate)} → ${formatEffectiveness(outcome.candidateRate)} ${outcome.improved ? chalk.green('✓') : chalk.red('✗')}`
      : '';
    Logger.write(`   ${chalk.gray(label.padEnd(13))}eval #${prediction.evalId} · ${prediction.expectation}${rates}\n`);
  }

  if (!decision) {
    Logger.write(`   ${chalk.yellow('INVALID')}  ${record.invalidReason ?? 'the attempt overstepped its scope'}\n`);
    return;
  }

  Logger.write(
    `   ${chalk.gray('effectiveness'.padEnd(13))}` +
    `${formatEffectiveness(decision.incumbentEffectiveness)} → ${formatEffectiveness(decision.candidateEffectiveness)}\n`
  );

  if (decision.verdict === 'accepted') {
    Logger.write(`   ${chalk.green('ACCEPTED')}  committed ${record.sha ?? ''}\n`);
  } else {
    Logger.write(`   ${chalk.red('REJECTED')}  ${VERDICT_REASONS[decision.verdict]}\n`);
  }
}

/**
 * Renders the balance of the session: how many proposals there were, how they
 * ended, which version it started and ended on, and — only when something was
 * accepted — the end-to-end effectiveness measured fresh between the two.
 */
export function renderSessionBalance(balance: SessionBalance): void {
  Logger.write(`\nSESSION BALANCE\n`);
  Logger.write(`──────────────────────────────────────────────────\n`);
  Logger.write(
    `   proposals ${balance.proposals}  ·  ` +
    `${chalk.green(`accepted ${balance.accepted}`)}  ·  ` +
    `${chalk.red(`rejected ${balance.rejected}`)}  ·  ` +
    `${chalk.yellow(`invalid ${balance.invalid}`)}\n`
  );
  Logger.write(`   version   ${balance.initialSha} → ${balance.finalSha}\n`);

  if (balance.endToEnd) {
    Logger.write(
      `   end-to-end ${formatEffectiveness(balance.endToEnd.initial)} → ` +
      `${formatEffectiveness(balance.endToEnd.final)}  ${chalk.gray('(measured fresh under the frozen evals)')}\n`
    );
  }
  Logger.write('\n');
}
