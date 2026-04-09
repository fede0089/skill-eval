#!/usr/bin/env node
import { Command } from 'commander';
import { triggerCommand } from './commands/trigger';
import { functionalCommand } from './commands/functional';
import { Logger } from './utils/logger';
import { AppError } from './core/errors';

const program = new Command();

const errorHandler = (err: unknown) => {
  if (err instanceof AppError) {
    Logger.error(err.message);
  } else if (err instanceof Error) {
    Logger.error(`An unexpected error occurred: ${err.message}`, err.stack);
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
  .option('-i, --interactive', 'Enable interactive mode for Gemini CLI', false)
  .action((agent, options) => {
    const selectedAgent = agent || 'gemini-cli';
    triggerCommand(selectedAgent, options.skill, { interactive: options.interactive }).catch(errorHandler);
  });

program
  .command('functional [agent]')
  .description('Evaluate functional correctness of an agent skill based on expectations')
  .requiredOption('--skill <path>', 'Path to the skill directory')
  .option('-i, --interactive', 'Enable interactive mode for Gemini CLI', false)
  .action((agent, options) => {
    const selectedAgent = agent || 'gemini-cli';
    functionalCommand(selectedAgent, options.skill, { interactive: options.interactive }).catch(errorHandler);
  });

program.parse(process.argv);
