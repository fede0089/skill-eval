import chalk from 'chalk';
import * as path from 'path';
import { AggregatedTokenStats, EvalSuiteReport, EvalTrial } from '../types/index.js';
import { Logger } from './logger.js';
import { computePassAtK } from '../core/statistics.js';

/**
 * Formats a token count for human-readable display.
 * Numbers >= 1M are shown as "1.2M", >= 1K as "119K", else as-is.
 */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return `${n}`;
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

  const tableData = numTrials > 1
    ? [['ID', 'Prompt', 'Trials', 'success rate']]
    : [['ID', 'Prompt', 'success rate']];

  let hasPartialErrors = false;

  for (const result of results) {
    const promptSnippet = result.prompt.substring(0, 40) + (result.prompt.length > 40 ? '...' : '');
    const p1Cell = formatPassAt1(result.trials);
    const someError = result.trials.some(t => t.isError);
    const allError = result.trials.length > 0 && result.trials.every(t => t.isError);
    if (someError && !allError) hasPartialErrors = true;

    if (numTrials > 1) {
      const errorCount = result.trials.filter(t => t.isError).length;
      const passedCount = result.trials.filter(t => t.trialPassed).length;
      const trialsBase = `${passedCount}/${result.trials.length}`;
      const trialsStr = errorCount > 0 ? `${trialsBase} (${errorCount}!)` : trialsBase;
      const trials = result.score === 1.0 ? chalk.green(trialsStr) : errorCount > 0 ? chalk.yellow(trialsStr) : chalk.red(trialsStr);
      tableData.push([result.taskId.toString(), promptSnippet, trials, p1Cell]);
    } else {
      tableData.push([result.taskId.toString(), promptSnippet, p1Cell]);
    }
  }

  Logger.table(tableData);

  if (hasPartialErrors) {
    Logger.write(chalk.yellow('\n   * Some trials did not complete due to infrastructure errors. success rate is computed over the trials that ran.'));
  }

  const percentage = Math.round((metrics.passAtK || 0) * 100);
  Logger.write(`\n   Trigger Success Rate:   ${percentage}%`);

  const withSkillTokenStats = metrics.tokenStats?.withSkill;
  if (withSkillTokenStats) {
    Logger.write(`\n   Avg Tokens:             ${formatTokenStatsLine(withSkillTokenStats)}`);
  }
}

/**
 * Renders a functional evaluation summary table and rate lines to the terminal.
 */
export function renderFunctionalTable(report: EvalSuiteReport): void {
  const { results, metrics } = report;

  const tableData: string[][] = [['ID', 'Prompt', 'Without Skill', 'With Skill']];

  let hasPartialErrors = false;

  for (const result of results) {
    const promptSnippet = result.prompt.substring(0, 40) + (result.prompt.length > 40 ? '...' : '');
    const withoutSkillTrials = result.withoutSkillTrials || [];
    const withSkillTrials = result.trials;

    const baselineSomeError = withoutSkillTrials.some(t => t.isError);
    const baselineAllError = withoutSkillTrials.length > 0 && withoutSkillTrials.every(t => t.isError);
    const withSkillSomeError = withSkillTrials.some(t => t.isError);
    const withSkillAllError = withSkillTrials.length > 0 && withSkillTrials.every(t => t.isError);
    if ((baselineSomeError && !baselineAllError) || (withSkillSomeError && !withSkillAllError)) hasPartialErrors = true;

    tableData.push([
      result.taskId.toString(),
      promptSnippet,
      formatPassAt1(withoutSkillTrials),
      formatPassAt1(withSkillTrials),
    ]);
  }

  Logger.table(tableData);

  if (hasPartialErrors) {
    Logger.write(chalk.yellow('\n   * Some trials did not complete due to infrastructure errors. success rate is computed over the trials that ran.'));
  }

  const withoutSkillPercentage = Math.round((metrics.withoutSkillPassAtK || 0) * 100);
  const withSkillPercentage = Math.round((metrics.passAtK || 0) * 100);

  Logger.write(`\n   Without Skill Rate:   ${withoutSkillPercentage}%`);
  Logger.write(`\n   With Skill Rate:      ${withSkillPercentage}%`);

  const baselineTokenStats = metrics.tokenStats?.withoutSkill;
  const withSkillTokenStats = metrics.tokenStats?.withSkill;
  if (baselineTokenStats || withSkillTokenStats) {
    if (baselineTokenStats) Logger.write(`\n   Tokens (w/o skill):   ${formatTokenStatsLine(baselineTokenStats)}`);
    if (withSkillTokenStats) Logger.write(`\n   Tokens (w/ skill):    ${formatTokenStatsLine(withSkillTokenStats)}`);
    if (baselineTokenStats && withSkillTokenStats && baselineTokenStats.avgTotal > 0) {
      const delta = withSkillTokenStats.avgTotal - baselineTokenStats.avgTotal;
      const deltaSign = delta >= 0 ? '+' : '';
      const deltaPct = Math.round((delta / baselineTokenStats.avgTotal) * 100);
      const deltaStr = `${deltaSign}${formatTokens(Math.abs(delta))} (${deltaSign}${deltaPct}%)`;
      Logger.write(`\n   Token Delta:          ${delta >= 0 ? chalk.yellow(deltaStr) : chalk.green(deltaStr)}`);
    }
  }
}
