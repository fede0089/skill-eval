import chalk from 'chalk';
import { EvalSuiteReport } from '../types/index.js';
import { Logger } from './logger.js';
import { computePassAtK } from '../core/statistics.js';

/**
 * Renders a trigger evaluation summary table and rate line to the terminal.
 * Accepts a full EvalSuiteReport so it can be called from both live commands
 * and the `show` command (which reads from disk).
 */
export function renderTriggerTable(report: EvalSuiteReport): void {
  const { results, metrics } = report;
  const numTrials = metrics.numTrials || 1;

  const tableData = numTrials > 1
    ? [['ID', 'Prompt', 'Trials', 'pass@1', `pass@${numTrials}`]]
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
      const pn = `${Math.round(computePassAtK(result.trials, numTrials) * 100)}%`;
      tableData.push([result.taskId.toString(), promptSnippet, trials, p1, pn]);
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
  const triggerRateLine = numTrials > 1
    ? `\n   Trigger Success Rate:   pass@1: ${percentage}%   pass@${numTrials}: ${Math.round((metrics.passAtN || 0) * 100)}%`
    : `\n   Trigger Success Rate:   ${percentage}%`;
  Logger.write(triggerRateLine);
}

/**
 * Renders a functional evaluation summary table and rate lines to the terminal.
 */
export function renderFunctionalTable(report: EvalSuiteReport): void {
  const { results, metrics } = report;
  const numTrials = metrics.numTrials || 1;

  const tableData = numTrials > 1
    ? [['ID', 'Prompt', 'W/o p@1', `W/o p@${numTrials}`, 'W/ p@1', `W/ p@${numTrials}`]]
    : [['ID', 'Prompt', 'W/o Skill', 'W/ Skill']];

  for (const result of results) {
    const promptSnippet = result.prompt.substring(0, 40) + (result.prompt.length > 40 ? '...' : '');
    const withoutSkillTrials = result.withoutSkillTrials || [];
    const withSkillTrials = result.trials;

    if (numTrials > 1) {
      const bErrorCount = withoutSkillTrials.filter(t => t.isError).length;
      const tErrorCount = withSkillTrials.filter(t => t.isError).length;
      const bp1 = `${Math.round(computePassAtK(withoutSkillTrials, 1) * 100)}%`;
      const bpn = `${Math.round(computePassAtK(withoutSkillTrials, numTrials) * 100)}%`;
      const tp1 = `${Math.round(computePassAtK(withSkillTrials, 1) * 100)}%`;
      const tpn = `${Math.round(computePassAtK(withSkillTrials, numTrials) * 100)}%`;
      const bColor = withoutSkillTrials.every(t => t.trialPassed) ? chalk.green : bErrorCount > 0 ? chalk.yellow : chalk.red;
      const tColor = withSkillTrials.every(t => t.trialPassed) ? chalk.green : tErrorCount > 0 ? chalk.yellow : chalk.red;
      tableData.push([result.taskId.toString(), promptSnippet, bColor(bp1), bColor(bpn), tColor(tp1), tColor(tpn)]);
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

  const withoutSkillRateLine = numTrials > 1
    ? `\n   Without Skill Rate:   pass@1: ${withoutSkillPercentage}%   pass@${numTrials}: ${Math.round((metrics.withoutSkillPassAtN || 0) * 100)}%`
    : `\n   Without Skill Rate:   ${withoutSkillPercentage}%`;
  const withSkillRateLine = numTrials > 1
    ? `   With Skill Rate:      pass@1: ${withSkillPercentage}%   pass@${numTrials}: ${Math.round((metrics.passAtN || 0) * 100)}%`
    : `   With Skill Rate:      ${withSkillPercentage}%`;

  Logger.write(withoutSkillRateLine);
  Logger.write(`\n${withSkillRateLine}`);
}
