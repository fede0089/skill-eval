import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { EvalSuiteReport } from '../types/index.js';
import { Logger } from '../utils/logger.js';
import { computePassAtK } from '../core/statistics.js';
import { AppError } from '../core/errors.js';
import type { Reporter } from '../core/reporters/index.js';
import { JsonReporter } from '../core/reporters/index.js';

export async function showCommand(reporter: Reporter = new JsonReporter()): Promise<void> {
  const runsDir = path.resolve(process.cwd(), '.project-skill-evals', 'runs');

  if (!fs.existsSync(runsDir)) {
    throw new AppError('No evaluation runs found. Run an evaluation first.');
  }

  const runs = fs.readdirSync(runsDir)
    .filter(dir => fs.statSync(path.join(runsDir, dir)).isDirectory())
    .sort((a, b) => b.localeCompare(a)); // Sort descending to get latest

  if (runs.length === 0) {
    throw new AppError('No evaluation runs found. Run an evaluation first.');
  }

  const latestRun = runs[0];
  const summaryPath = path.join(runsDir, latestRun, 'summary.json');

  if (!fs.existsSync(summaryPath)) {
    throw new AppError(`Summary file not found for the latest run: ${latestRun}`);
  }

  const report: EvalSuiteReport = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
  const { skill_name, agent, metrics, results, timestamp } = report;
  const numTrials = metrics.numTrials || 1;
  const isFunctional = metrics.withoutSkillScore !== undefined;

  Logger.write(`\n${chalk.bold('LATEST EVALUATION RESULTS')}\n`);
  Logger.write(`Timestamp:  ${new Date(timestamp).toLocaleString()}\n`);
  Logger.write(`Skill:      ${skill_name}\n`);
  Logger.write(`Agent:      ${agent}\n`);
  Logger.write(`Type:       ${isFunctional ? 'Functional' : 'Trigger'}\n`);
  Logger.write(`──────────────────────────────────────────────────\n`);

  if (isFunctional) {
    renderFunctionalTable(report);
  } else {
    renderTriggerTable(report);
  }

  Logger.write('\n');

  const runDir = path.join(runsDir, latestRun);
  reporter.generate(report, runDir);
}

function renderTriggerTable(report: EvalSuiteReport) {
  const { results, metrics } = report;
  const numTrials = metrics.numTrials || 1;

  const tableData = numTrials > 1
    ? [['ID', 'Prompt', 'Trials', 'pass@1', `pass@${numTrials}`]]
    : [['ID', 'Prompt', 'Status']];

  for (const result of results) {
    const promptSnippet = result.prompt.substring(0, 40) + (result.prompt.length > 40 ? '...' : '');
    if (numTrials > 1) {
      const trialsStr = `${result.trials.filter(t => t.trialPassed).length}/${result.trials.length}`;
      const trials = result.score === 1.0 ? chalk.green(trialsStr) : chalk.red(trialsStr);
      const p1 = `${Math.round(computePassAtK(result.trials, 1) * 100)}%`;
      const pn = `${Math.round(computePassAtK(result.trials, numTrials) * 100)}%`;
      tableData.push([result.taskId.toString(), promptSnippet, trials, p1, pn]);
    } else {
      const statusStr = result.score === 1.0 ? 'PASS' : 'FAIL';
      const status = result.score === 1.0 ? chalk.green(statusStr) : chalk.red(statusStr);
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

function renderFunctionalTable(report: EvalSuiteReport) {
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
      const bp1 = `${Math.round(computePassAtK(withoutSkillTrials, 1) * 100)}%`;
      const bpn = `${Math.round(computePassAtK(withoutSkillTrials, numTrials) * 100)}%`;
      const tp1 = `${Math.round(computePassAtK(withSkillTrials, 1) * 100)}%`;
      const tpn = `${Math.round(computePassAtK(withSkillTrials, numTrials) * 100)}%`;
      const bColor = withoutSkillTrials.every(t => t.trialPassed) ? chalk.green : chalk.red;
      const tColor = withSkillTrials.every(t => t.trialPassed) ? chalk.green : chalk.red;
      tableData.push([result.taskId.toString(), promptSnippet, bColor(bp1), bColor(bpn), tColor(tp1), tColor(tpn)]);
    } else {
      const withoutSkillStr = (withoutSkillTrials[0]?.trialPassed) ? 'PASS' : 'FAIL';
      const withSkillStr = (withSkillTrials[0]?.trialPassed) ? 'PASS' : 'FAIL';
      const withoutSkillStatus = withoutSkillTrials.every(t => t.trialPassed) ? chalk.green(withoutSkillStr) : chalk.red(withoutSkillStr);
      const withSkillStatus = withSkillTrials.every(t => t.trialPassed) ? chalk.green(withSkillStr) : chalk.red(withSkillStr);
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
