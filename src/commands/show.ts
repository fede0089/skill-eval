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
  const isFunctional = metrics.baselineScore !== undefined;

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
    ? [['ID', 'Prompt', 'Base p@1', `Base p@${numTrials}`, 'Tgt p@1', `Tgt p@${numTrials}`]]
    : [['ID', 'Prompt', 'Baseline', 'Target']];

  for (const result of results) {
    const promptSnippet = result.prompt.substring(0, 40) + (result.prompt.length > 40 ? '...' : '');
    const baselineTrials = result.baselineTrials || [];
    const targetTrials = result.trials;

    if (numTrials > 1) {
      const bp1 = `${Math.round(computePassAtK(baselineTrials, 1) * 100)}%`;
      const bpn = `${Math.round(computePassAtK(baselineTrials, numTrials) * 100)}%`;
      const tp1 = `${Math.round(computePassAtK(targetTrials, 1) * 100)}%`;
      const tpn = `${Math.round(computePassAtK(targetTrials, numTrials) * 100)}%`;
      const bColor = baselineTrials.every(t => t.trialPassed) ? chalk.green : chalk.red;
      const tColor = targetTrials.every(t => t.trialPassed) ? chalk.green : chalk.red;
      tableData.push([result.taskId.toString(), promptSnippet, bColor(bp1), bColor(bpn), tColor(tp1), tColor(tpn)]);
    } else {
      const baselineStr = (baselineTrials[0]?.trialPassed) ? 'PASS' : 'FAIL';
      const targetStr = (targetTrials[0]?.trialPassed) ? 'PASS' : 'FAIL';
      const baselineStatus = baselineTrials.every(t => t.trialPassed) ? chalk.green(baselineStr) : chalk.red(baselineStr);
      const targetStatus = targetTrials.every(t => t.trialPassed) ? chalk.green(targetStr) : chalk.red(targetStr);
      tableData.push([result.taskId.toString(), promptSnippet, baselineStatus, targetStatus]);
    }
  }

  Logger.table(tableData);

  const baselinePercentage = Math.round((metrics.baselinePassAtK || 0) * 100);
  const targetPercentage = Math.round((metrics.passAtK || 0) * 100);

  const baselineRateLine = numTrials > 1
    ? `\n   Baseline Success Rate:   pass@1: ${baselinePercentage}%   pass@${numTrials}: ${Math.round((metrics.baselinePassAtN || 0) * 100)}%`
    : `\n   Baseline Success Rate:   ${baselinePercentage}%`;
  const targetRateLine = numTrials > 1
    ? `   Target Success Rate:     pass@1: ${targetPercentage}%   pass@${numTrials}: ${Math.round((metrics.passAtN || 0) * 100)}%`
    : `   Target Success Rate:     ${targetPercentage}%`;

  Logger.write(baselineRateLine);
  Logger.write(`\n${targetRateLine}`);
}
