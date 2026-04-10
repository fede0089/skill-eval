#!/usr/bin/env node
import { Command } from 'commander';
import { triggerCommand } from './commands/trigger';
import { functionalCommand } from './commands/functional';
import { Logger } from './utils/logger';
import { AppError } from './core/errors';

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
  .requiredOption('--skill <path>', 'Path to the skill directory')
  .option('--concurrency <number>', 'Number of concurrent tasks', '5')
  .action((agent, options) => {
    const selectedAgent = agent || 'gemini-cli';
    const concurrency = parseInt(options.concurrency, 10);
    triggerCommand(selectedAgent, options.skill, concurrency).catch(errorHandler);
  });

program
  .command('functional [agent]')
  .description('Evaluate functional correctness of an agent skill based on assertions')
  .requiredOption('--skill <path>', 'Path to the skill directory')
  .option('--concurrency <number>', 'Number of concurrent tasks', '5')
  .action((agent, options) => {
    const selectedAgent = agent || 'gemini-cli';
    const concurrency = parseInt(options.concurrency, 10);
    functionalCommand(selectedAgent, options.skill, concurrency).catch(errorHandler);
  });

if (require.main === module) {
  program.parse(process.argv);
}
