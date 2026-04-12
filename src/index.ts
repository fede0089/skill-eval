#!/usr/bin/env node
import { Command } from 'commander';
import { triggerCommand } from './commands/trigger.js';
import { functionalCommand } from './commands/functional.js';
import { showCommand } from './commands/show.js';
import { Logger } from './utils/logger.js';
import { AppError, ConfigError } from './core/errors.js';
import { loadConfig } from './core/config.js';
import { createReporter } from './core/reporters/index.js';
import type { ReportFormat } from './types/index.js';

import * as path from 'path';
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
  .option('-v, --verbose', 'Enable verbose logging', false);

program.on('option:verbose', () => {
  process.env.DEBUG = 'true';
});

program
  .command('trigger [agent]')
  .description('Evaluate triggering of an agent skill')
  .option('--skill <path>', 'Path to the skill directory (or set in .skill-eval.json)')
  .option('--concurrency <number>', 'Number of concurrent tasks')
  .option('--trials <number>', 'Number of trials per task for pass@k calculation')
  .option('--report <format>', 'Report format: html or json')
  .action((agent, options) => {
    const config = loadConfig(process.cwd());
    const skillPath = options.skill || config.skill;
    if (!skillPath) throw new ConfigError("No skill path provided. Use --skill <path> or set 'skill' in .skill-eval.json.");
    const selectedAgent = agent || config.agent || 'gemini-cli';
    const concurrency = parseInt(options.concurrency, 10) || config.concurrency || 5;
    const numTrials = parseInt(options.trials, 10) || config.trials || 3;
    const reporter = createReporter((options.report || config.report || 'html') as ReportFormat);
    triggerCommand(selectedAgent, skillPath, concurrency, undefined, numTrials, reporter).catch(errorHandler);
  });

program
  .command('functional [agent]')
  .description('Evaluate functional correctness of an agent skill based on assertions')
  .option('--skill <path>', 'Path to the skill directory (or set in .skill-eval.json)')
  .option('--concurrency <number>', 'Number of concurrent tasks')
  .option('--trials <number>', 'Number of trials per task for pass@k calculation')
  .option('--report <format>', 'Report format: html or json')
  .action((agent, options) => {
    const config = loadConfig(process.cwd());
    const skillPath = options.skill || config.skill;
    if (!skillPath) throw new ConfigError("No skill path provided. Use --skill <path> or set 'skill' in .skill-eval.json.");
    const selectedAgent = agent || config.agent || 'gemini-cli';
    const concurrency = parseInt(options.concurrency, 10) || config.concurrency || 5;
    const numTrials = parseInt(options.trials, 10) || config.trials || 3;
    const reporter = createReporter((options.report || config.report || 'html') as ReportFormat);
    functionalCommand(selectedAgent, skillPath, concurrency, undefined, numTrials, reporter).catch(errorHandler);
  });

program
  .command('show')
  .description('Display results of the latest evaluation run')
  .option('--report <format>', 'Report format: html or json', 'html')
  .action((options) => {
    const reporter = createReporter(options.report as ReportFormat);
    showCommand(reporter).catch(errorHandler);
  });

const isMain = process.argv[1] && (
  process.argv[1] === fileURLToPath(import.meta.url) ||
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) ||
  process.argv[1].endsWith('dist/index.js')
);

if (isMain) {
  program.parse(process.argv);
}
