import { test, mock } from 'node:test';
import * as assert from 'node:assert';
import { program } from '../../src/index.js';

test('trigger command should have --concurrency flag', (t) => {
  const triggerCmd = program.commands.find(c => c.name() === 'trigger');
  assert.ok(triggerCmd, 'trigger command not found');

  const option = triggerCmd.options.find(o => o.long === '--concurrency');
  assert.ok(option, '--concurrency option not found on trigger command');
  // Default concurrency (5) is now resolved in the action handler via config fallback
});

test('functional command should have --concurrency flag', (t) => {
  const functionalCmd = program.commands.find(c => c.name() === 'functional');
  assert.ok(functionalCmd, 'functional command not found');

  const option = functionalCmd.options.find(o => o.long === '--concurrency');
  assert.ok(option, '--concurrency option not found on functional command');
  // Default concurrency (5) is now resolved in the action handler via config fallback
});
