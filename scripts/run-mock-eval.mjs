#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const [command, ...rawArgs] = process.argv.slice(2);

if (command !== 'trigger' && command !== 'functional') {
  console.error('Usage: node scripts/run-mock-eval.mjs <trigger|functional> [runner] [extra skill-eval args...]');
  process.exit(1);
}

let runner = process.env.npm_config_runner || 'gemini-cli';
const extraArgs = [];

for (let i = 0; i < rawArgs.length; i++) {
  const arg = rawArgs[i];
  if (arg === '--runner') {
    runner = rawArgs[++i] || runner;
  } else if (arg.startsWith('--runner=')) {
    runner = arg.slice('--runner='.length) || runner;
  } else if (!arg.startsWith('-') && runner === (process.env.npm_config_runner || 'gemini-cli')) {
    runner = arg;
  } else {
    extraArgs.push(arg);
  }
}

const result = spawnSync(process.execPath, [
  './dist/index.js',
  command,
  runner,
  '--workspace', '.',
  '--skill', './mock-skill',
  '--debug',
  ...extraArgs,
], {
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
