import chalk from 'chalk';
import * as path from 'path';
import { EvalSuiteReport } from '../types/index.js';
import { Logger } from './logger.js';
import { computePassAtK } from '../core/statistics.js';

export interface RunHeaderConfig {
  command: 'trigger' | 'functional';
  skillName: string;
  agent: string;
  workspace: string;
  tasks: number;
  trials: number;
  concurrency: number;
  timeoutMs: number;
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
  const { command, skillName, agent, workspace, tasks, trials, concurrency, timeoutMs, runDir, evalId } = config;

  const timeoutSec = timeoutMs / 1000;
  const timeoutStr = timeoutSec % 60 === 0 ? `${timeoutSec / 60}m` : `${timeoutSec}s`;

  const relRunDir = path.relative(workspace, runDir);
  const maxOutputLen = BOX_INNER - 13; // 11 label + 2 spaces
  const outputStr = relRunDir.length > maxOutputLen ? relRunDir.slice(0, maxOutputLen - 1) + '…' : relRunDir;

  const titleLabel = 'skill-eval';
  const dashes = '─'.repeat(BOX_INNER - titleLabel.length);
  const top = chalk.gray('┌─ ') + chalk.bold(titleLabel) + ' ' + chalk.gray(dashes + '┐');
  const bottom = chalk.gray('└' + '─'.repeat(BOX_INNER + 2) + '┘');

  const commandPart = evalId !== undefined ? `${command}  ·  eval #${evalId}` : command;
  const title = chalk.bold.cyan(skillName) + chalk.gray(`  ·  ${commandPart}`);
  const runLine = `${tasks} task${tasks !== 1 ? 's' : ''}  ·  ${trials} trial${trials !== 1 ? 's' : ''}  ·  concurrency ${concurrency}`;

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
    ? [['ID', 'Prompt', 'Trials', 'pass@1']]
    : [['ID', 'Prompt', 'Status']];

  for (const result of results) {
    const promptSnippet = result.prompt.substring(0, 40) + (result.prompt.length > 40 ? '...' : '');
    if (numTrials > 1) {
      const errorCount = result.trials.filter(t => t.isError).length;
      const passedCount = result.trials.filter(t => t.trialPassed).length;
      const trialsBase = `${passedCount}/${result.trials.length}`;
      const trialsStr = errorCount > 0 ? `${trialsBase} (${errorCount}!)` : trialsBase;
      const trials = result.score === 1.0 ? chalk.green(trialsStr) : errorCount > 0 ? chalk.yellow(trialsStr) : chalk.red(trialsStr);
      const p1 = `${Math.round(computePassAtK(result.trials, 1) * 100)}%`;
      tableData.push([result.taskId.toString(), promptSnippet, trials, p1]);
    } else {
      const trial = result.trials[0];
      const status = trial?.isError
        ? chalk.yellow('(!) ERROR')
        : result.score === 1.0
          ? chalk.green('✓ PASSED')
          : chalk.red('✗ FAILED');
      tableData.push([result.taskId.toString(), promptSnippet, status]);
    }
  }

  Logger.table(tableData);

  const percentage = Math.round((metrics.passAtK || 0) * 100);
  Logger.write(`\n   Trigger Success Rate:   ${percentage}%`);
}

/**
 * Renders a functional evaluation summary table and rate lines to the terminal.
 */
export function renderFunctionalTable(report: EvalSuiteReport): void {
  const { results, metrics } = report;
  const numTrials = metrics.numTrials || 1;

  const tableData = numTrials > 1
    ? [['ID', 'Prompt', 'W/o p@1', 'W/ p@1']]
    : [['ID', 'Prompt', 'W/o Skill', 'W/ Skill']];

  for (const result of results) {
    const promptSnippet = result.prompt.substring(0, 40) + (result.prompt.length > 40 ? '...' : '');
    const withoutSkillTrials = result.withoutSkillTrials || [];
    const withSkillTrials = result.trials;

    if (numTrials > 1) {
      const bErrorCount = withoutSkillTrials.filter(t => t.isError).length;
      const tErrorCount = withSkillTrials.filter(t => t.isError).length;
      const bp1 = `${Math.round(computePassAtK(withoutSkillTrials, 1) * 100)}%`;
      const tp1 = `${Math.round(computePassAtK(withSkillTrials, 1) * 100)}%`;
      const bColor = withoutSkillTrials.every(t => t.trialPassed) ? chalk.green : bErrorCount > 0 ? chalk.yellow : chalk.red;
      const tColor = withSkillTrials.every(t => t.trialPassed) ? chalk.green : tErrorCount > 0 ? chalk.yellow : chalk.red;
      tableData.push([result.taskId.toString(), promptSnippet, bColor(bp1), tColor(tp1)]);
    } else {
      const withoutTrial = withoutSkillTrials[0];
      const withTrial = withSkillTrials[0];
      const withoutSkillStatus = withoutTrial?.isError
        ? chalk.yellow('(!) ERROR')
        : withoutTrial?.trialPassed ? chalk.green('✓ PASSED') : chalk.red('✗ FAILED');
      const withSkillStatus = withTrial?.isError
        ? chalk.yellow('(!) ERROR')
        : withTrial?.trialPassed ? chalk.green('✓ PASSED') : chalk.red('✗ FAILED');
      tableData.push([result.taskId.toString(), promptSnippet, withoutSkillStatus, withSkillStatus]);
    }
  }

  Logger.table(tableData);

  const withoutSkillPercentage = Math.round((metrics.withoutSkillPassAtK || 0) * 100);
  const withSkillPercentage = Math.round((metrics.passAtK || 0) * 100);

  Logger.write(`\n   Without Skill Rate:   ${withoutSkillPercentage}%`);
  Logger.write(`\n   With Skill Rate:      ${withSkillPercentage}%`);
}
