import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { EvalSuiteReport } from '../types/index.js';
import { Logger } from '../utils/logger.js';
import { AppError } from '../core/errors.js';
import { renderTriggerTable, renderFunctionalTable } from '../utils/table-renderer.js';
import type { Reporter } from '../core/reporters/index.js';
import { JsonReporter } from '../core/reporters/index.js';

export async function showCommand(workspace: string, reporter: Reporter = new JsonReporter()): Promise<void> {
  const runsDir = path.resolve(workspace, '.project-skill-evals', 'runs');

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

