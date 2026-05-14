#!/usr/bin/env node
import { Command } from 'commander';
import { triggerCommand } from './commands/trigger.js';
import { functionalCommand } from './commands/functional.js';
import { Logger } from './utils/logger.js';
import { AppError } from './core/errors.js';
import { HtmlReporter } from './reporters/index.js';
import { DEFAULT_AGENT } from './runners/registry.js';

import * as path from 'path';
import * as fs from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const pkg = createRequire(import.meta.url)('../package.json') as { version: string };

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
  .version(pkg.version)
  .option('-v, --debug', 'Enable debug logging', false);

program.on('option:debug', () => {
  process.env.DEBUG = 'true';
});

program
  .command('trigger [agent]')
  .description('Evaluate triggering of an agent skill')
  .requiredOption('--workspace <path>', 'Path to the workspace/repo to evaluate against')
  .requiredOption('--skill <path>', 'Path to the skill directory')
  .option('--agents <number>', 'Number of parallel agents', '4')
  .option('--trials <number>', 'Number of trials per task for pass@k calculation', '3')
  .option('--timeout <seconds>', 'Agent timeout in seconds')
  .option('--eval-id <id>', 'Run only the eval with this ID (numeric)')
  .option('--compare-ref [refs...]', 'Compare against historical git references')
  .action((agent, options) => {
    const workspace = path.resolve(options.workspace);
    const selectedAgent = agent || DEFAULT_AGENT;
    const maxAgents = parseInt(options.agents, 10);
    const numTrials = parseInt(options.trials, 10);
    const timeoutMs = options.timeout ? parseInt(options.timeout, 10) * 1000 : undefined;
    const evalId = options.evalId !== undefined ? parseInt(options.evalId, 10) : undefined;
    const compareRefs = options.compareRef || [];
    triggerCommand(selectedAgent, workspace, options.skill, maxAgents, undefined, numTrials, new HtmlReporter(), timeoutMs, evalId, compareRefs).catch(errorHandler);
  });

program
  .command('functional [agent]')
  .description('Evaluate functional correctness of an agent skill against expectations')
  .requiredOption('--workspace <path>', 'Path to the workspace/repo to evaluate against')
  .requiredOption('--skill <path>', 'Path to the skill directory')
  .option('--agents <number>', 'Number of parallel agents', '4')
  .option('--trials <number>', 'Number of trials per task for pass@k calculation', '3')
  .option('--timeout <seconds>', 'Agent timeout in seconds')
  .option('--eval-id <id>', 'Run only the eval with this ID (numeric)')
  .option('--compare-ref [refs...]', 'Compare against historical git references')
  .option('--compare-baseline', 'Also run the no-skill baseline alongside the skill')
  .action((agent, options) => {
    const workspace = path.resolve(options.workspace);
    const selectedAgent = agent || DEFAULT_AGENT;
    const maxAgents = parseInt(options.agents, 10);
    const numTrials = parseInt(options.trials, 10);
    const timeoutMs = options.timeout ? parseInt(options.timeout, 10) * 1000 : undefined;
    const evalId = options.evalId !== undefined ? parseInt(options.evalId, 10) : undefined;
    const compareRefs = options.compareRef || [];
    const compareBaseline = !!options.compareBaseline;
    functionalCommand(selectedAgent, workspace, options.skill, maxAgents, undefined, numTrials, new HtmlReporter(), timeoutMs, evalId, compareRefs, compareBaseline).catch(errorHandler);
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
