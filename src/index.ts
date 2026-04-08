#!/usr/bin/env node
import { Command } from 'commander';
import { triggerCommand } from './commands/trigger';
import { rateCommand } from './commands/rate';
import { viewCommand } from './commands/view';

const program = new Command();

program
  .name('skill-eval')
  .description('CLI to evaluate agent skills triggering')
  .version('1.0.0');

program
  .command('trigger [agent]')
  .description('Evaluate triggering of an agent skill')
  .requiredOption('--skill <path>', 'Path to the skill directory')
  .action((agent, options) => {
    const selectedAgent = agent || 'gemini-cli';
    triggerCommand(selectedAgent, options.skill).catch((err: any) => {
      console.error(`Fatal error:`, err);
      process.exit(1);
    });
  });

program
  .command('rate')
  .description('Rate your experience with the tool')
  .argument('<score>', 'Rating score from 1 to 5')
  .option('-c, --comment <text>', 'Optional comment')
  .action((score, options) => {
    rateCommand(score, options).catch((err: any) => {
      console.error(`Fatal error:`, err);
      process.exit(1);
    });
  });

program
  .command('view')
  .description('Comprehensive view to rate your experience')
  .option('-e, --ease <1-5>', 'Ease of use score (1-5)')
  .option('-s, --speed <1-5>', 'Speed and performance score (1-5)')
  .option('-a, --accuracy <1-5>', 'Triggering accuracy score (1-5)')
  .option('-c, --comment <text>', 'Overall comment')
  .action((options) => {
    viewCommand(options).catch((err: any) => {
      console.error(`Fatal error:`, err);
      process.exit(1);
    });
  });

program.parse(process.argv);
