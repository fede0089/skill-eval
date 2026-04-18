#!/usr/bin/env node
import { Command } from 'commander';
import { triggerCommand } from './commands/trigger.js';
import { functionalCommand } from './commands/functional.js';
import { Logger } from './utils/logger.js';
import { AppError } from './core/errors.js';
import { createReporter } from './reporters/index.js';
import { DEFAULT_AGENT } from './runners/registry.js';
import { DEFAULT_TIMEOUT_MS } from './types/index.js';
import type { ReportFormat } from './types/index.js';

import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

export const program = new Command();

const errorHandler = (err: unknown) => {
  if (err instanceof AppError) {
    Logger.error(err.message);
  } else if (err instanceof Error) {
    Logger.error(`An unexpected error occurred: ${err.message}`);
    Logger.trace(err);
  } else {
    Logger.error(`An unknown error occurred: ${String(err)}`);
  }
  process.exit(1);
};

program
  .name('skill-eval')
  .description('CLI to evaluate agent skills triggering and functionality')
  .version('1.0.0')
  .option('-v, --debug', 'Enable debug logging', false);

program.on('option:debug', () => {
  process.env.DEBUG = 'true';
});

program
  .command('trigger [agent]')
  .description('Evaluate triggering of an agent skill')
  .requiredOption('--workspace <path>', 'Path to the workspace/repo to evaluate against')
  .requiredOption('--skill <path>', 'Path to the skill directory')
  .option('--concurrency <number>', 'Number of concurrent tasks')
  .option('--trials <number>', 'Number of trials per task for pass@k calculation')
  .option('--report <format>', 'Report format: html or json')
  .option('--timeout <seconds>', 'Agent timeout in seconds', String(DEFAULT_TIMEOUT_MS / 1000))
  .option('--eval-id <id>', 'Run only the eval with this ID (numeric)')
  .action((agent, options) => {
    const workspace = path.resolve(options.workspace);
    const selectedAgent = agent || DEFAULT_AGENT;
    const concurrency = parseInt(options.concurrency, 10) || 5;
    const numTrials = options.trials !== undefined ? (parseInt(options.trials, 10) || 3) : 3;
    const timeoutMs = parseInt(options.timeout, 10) * 1000 || DEFAULT_TIMEOUT_MS;
    const reporter = createReporter((options.report || 'html') as ReportFormat);
    const evalId = options.evalId !== undefined ? parseInt(options.evalId, 10) : undefined;
    Logger.debug(`[CLI] numTrials=${numTrials} (--trials raw value: ${JSON.stringify(options.trials)})`);
    triggerCommand(selectedAgent, workspace, options.skill, concurrency, undefined, numTrials, reporter, timeoutMs, evalId).catch(errorHandler);
  });

program
  .command('functional [agent]')
  .description('Evaluate functional correctness of an agent skill based on assertions')
  .requiredOption('--workspace <path>', 'Path to the workspace/repo to evaluate against')
  .requiredOption('--skill <path>', 'Path to the skill directory')
  .option('--concurrency <number>', 'Number of concurrent tasks')
  .option('--trials <number>', 'Number of trials per task for pass@k calculation')
  .option('--report <format>', 'Report format: html or json')
  .option('--timeout <seconds>', 'Agent timeout in seconds', String(DEFAULT_TIMEOUT_MS / 1000))
  .option('--eval-id <id>', 'Run only the eval with this ID (numeric)')
  .action((agent, options) => {
    const workspace = path.resolve(options.workspace);
    const selectedAgent = agent || DEFAULT_AGENT;
    const concurrency = parseInt(options.concurrency, 10) || 5;
    const numTrials = options.trials !== undefined ? (parseInt(options.trials, 10) || 3) : 3;
    const timeoutMs = parseInt(options.timeout, 10) * 1000 || DEFAULT_TIMEOUT_MS;
    const reporter = createReporter((options.report || 'html') as ReportFormat);
    const evalId = options.evalId !== undefined ? parseInt(options.evalId, 10) : undefined;
    Logger.debug(`[CLI] numTrials=${numTrials} (--trials raw value: ${JSON.stringify(options.trials)})`);
    functionalCommand(selectedAgent, workspace, options.skill, concurrency, undefined, numTrials, reporter, timeoutMs, evalId).catch(errorHandler);
  });


const isMain = process.argv[1] && (() => {
  try {
    return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isMain) {
  program.parse(process.argv);
}
