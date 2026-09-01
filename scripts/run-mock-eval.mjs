#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEFAULT_RUNNER = 'gemini-cli';

/**
 * Splits the args after the command into the runner name and the args forwarded
 * to skill-eval. Only a *leading* bare argument names the runner — anything else
 * is forwarded untouched, so flag values (`--compare-ref HEAD~1`) are never
 * mistaken for a runner.
 */
export function parseArgs(rawArgs, defaultRunner = process.env.npm_config_runner || DEFAULT_RUNNER) {
  let runner = defaultRunner;
  const extraArgs = [];

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === '--runner') {
      runner = rawArgs[++i] || runner;
    } else if (arg.startsWith('--runner=')) {
      runner = arg.slice('--runner='.length) || runner;
    } else if (i === 0 && !arg.startsWith('-')) {
      runner = arg;
    } else {
      extraArgs.push(arg);
    }
  }

  return { runner, extraArgs };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const [command, ...rawArgs] = process.argv.slice(2);

  if (command !== 'trigger' && command !== 'functional') {
    console.error('Usage: node scripts/run-mock-eval.mjs <trigger|functional> [runner] [extra skill-eval args...]');
    process.exit(1);
  }

  const { runner, extraArgs } = parseArgs(rawArgs);

  const result = spawnSync(process.execPath, [
    './dist/index.js',
    command,
    '--executor-agent', runner,
    '--workspace', '.',
    '--skill', './mock-skill',
    ...extraArgs,
  ], {
    stdio: 'inherit',
  });

  process.exit(result.status ?? 1);
}
