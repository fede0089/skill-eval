#!/usr/bin/env node
import { Command } from 'commander';
import { triggerCommand } from './commands/trigger.js';
import { functionalCommand } from './commands/functional.js';
import { evolveCommand } from './commands/evolve.js';
import { Logger } from './utils/logger.js';
import { AppError, ConfigError } from './core/errors.js';
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

/**
 * A variadic option used without values (`--compare-ref` on its own) is parsed as
 * `true` by commander; reject it instead of iterating over a boolean.
 */
const parseCompareRefs = (value: unknown): string[] => {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value as string[];
  errorHandler(new ConfigError('--compare-ref requires at least one git reference (e.g. --compare-ref HEAD~1).'));
  return [];
};

/** Same guard as --compare-ref: a variadic option used with no values parses as `true`. */
const parsePredictions = (value: unknown): string[] => {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value as string[];
  errorHandler(new ConfigError('--predict requires at least one expectation (e.g. --predict 1#3).'));
  return [];
};

program
  .name('skill-eval')
  .description('CLI to evaluate agent skills triggering and functionality')
  .version(pkg.version)
  .option('-v, --debug', 'Print verbose logs to the console (trial transcripts are always saved)', false);

program.on('option:debug', () => {
  process.env.DEBUG = 'true';
});

program
  .command('trigger')
  .description('Evaluate triggering of an agent skill')
  .requiredOption('--workspace <path>', 'Path to the workspace/repo to evaluate against')
  .requiredOption('--skill <path>', 'Path to the skill directory')
  .option('--agents <number>', 'Number of parallel agents', '4')
  .option('--trials <number>', 'Number of trials per task for pass@k calculation', '5')
  .option('--timeout <seconds>', 'Agent timeout in seconds')
  .option('--eval-id <id>', 'Run only the eval with this ID (numeric)')
  .option('--eval-file <name>', 'Run only the evals from this file in evals/ (e.g. edge-cases.json)')
  .option('--compare-ref [refs...]', 'Compare against historical git references')
  .option('--executor-agent <name>', 'Agent that runs the evaluated task', DEFAULT_AGENT)
  .option('--output <path>', 'Root for everything the run writes; must be outside the workspace and the skill (default: ~/.skill-eval)')
  .action((options) => {
    const workspace = path.resolve(options.workspace);
    const executorAgent = options.executorAgent;
    const maxAgents = parseInt(options.agents, 10);
    const numTrials = parseInt(options.trials, 10);
    const timeoutMs = options.timeout ? parseInt(options.timeout, 10) * 1000 : undefined;
    const evalId = options.evalId !== undefined ? parseInt(options.evalId, 10) : undefined;
    const compareRefs = parseCompareRefs(options.compareRef);
    triggerCommand(executorAgent, workspace, options.skill, maxAgents, undefined, numTrials, new HtmlReporter(), timeoutMs, evalId, compareRefs, options.evalFile, options.output).catch(errorHandler);
  });

program
  .command('functional')
  .description('Evaluate functional correctness of an agent skill against expectations')
  .requiredOption('--workspace <path>', 'Path to the workspace/repo to evaluate against')
  .requiredOption('--skill <path>', 'Path to the skill directory')
  .option('--agents <number>', 'Number of parallel agents', '4')
  .option('--trials <number>', 'Number of trials per task for pass@k calculation', '5')
  .option('--timeout <seconds>', 'Agent timeout in seconds')
  .option('--eval-id <id>', 'Run only the eval with this ID (numeric)')
  .option('--eval-file <name>', 'Run only the evals from this file in evals/ (e.g. edge-cases.json)')
  .option('--compare-ref [refs...]', 'Compare against historical git references')
  .option('--compare-baseline', 'Also run the no-skill baseline alongside the skill')
  .option('--executor-agent <name>', 'Agent that runs the evaluated task', DEFAULT_AGENT)
  .option('--judge-agent <name>', 'Agent that grades the result (default: the executor agent)')
  .option('--output <path>', 'Root for everything the run writes; must be outside the workspace and the skill (default: ~/.skill-eval)')
  .action((options) => {
    const workspace = path.resolve(options.workspace);
    const executorAgent = options.executorAgent;
    // A judge left unspecified is the executor itself: the roles are separable,
    // not mandatory to separate.
    const judgeAgent = options.judgeAgent || executorAgent;
    const maxAgents = parseInt(options.agents, 10);
    const numTrials = parseInt(options.trials, 10);
    const timeoutMs = options.timeout ? parseInt(options.timeout, 10) * 1000 : undefined;
    const evalId = options.evalId !== undefined ? parseInt(options.evalId, 10) : undefined;
    const compareRefs = parseCompareRefs(options.compareRef);
    const compareBaseline = !!options.compareBaseline;
    functionalCommand(executorAgent, judgeAgent, workspace, options.skill, maxAgents, undefined, numTrials, new HtmlReporter(), timeoutMs, evalId, compareRefs, compareBaseline, options.evalFile, options.output).catch(errorHandler);
  });


program
  .command('evolve')
  .description('Run an evolution session: measure the skill against its committed version and keep what measures better')
  .requiredOption('--workspace <path>', 'Path to the workspace/repo to evaluate against')
  .requiredOption('--skill <path>', 'Path to the skill directory')
  .option('--agents <number>', 'Number of parallel agents', '4')
  .option('--trials <number>', 'Number of trials per eval', '5')
  .option('--timeout <seconds>', 'Agent timeout in seconds')
  .option('--executor-agent <name>', 'Agent that runs the evaluated task', DEFAULT_AGENT)
  .option('--judge-agent <name>', 'Agent that grades the result (default: the executor agent)')
  .option('--optimizer-agent <name>', 'Agent that reads the evidence and proposes the change (default: the executor agent)')
  .option('--proposals <number>', 'Ceiling of optimizer invocations; every proposal consumes one', '3')
  .option('--predict [items...]', 'Expectations an uncommitted change should improve, as <evalId>#<n>')
  .option('--output <path>', 'Root for everything the session writes; must be outside the workspace and the skill (default: ~/.skill-eval)')
  .action((options) => {
    const workspace = path.resolve(options.workspace);
    const executorAgent = options.executorAgent;
    evolveCommand({
      executorAgent,
      judgeAgent: options.judgeAgent || executorAgent,
      optimizerAgent: options.optimizerAgent || executorAgent,
      workspace,
      skillPath: options.skill,
      maxAgents: parseInt(options.agents, 10),
      numTrials: parseInt(options.trials, 10),
      proposals: parseInt(options.proposals, 10),
      timeoutMs: options.timeout ? parseInt(options.timeout, 10) * 1000 : undefined,
      output: options.output,
      predict: parsePredictions(options.predict)
    }).catch(errorHandler);
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
