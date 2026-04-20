import { test, mock } from 'node:test';
import * as assert from 'node:assert';
import { program } from '../../src/index.js';

test('trigger command should have --agents flag', (t) => {
  const triggerCmd = program.commands.find(c => c.name() === 'trigger');
  assert.ok(triggerCmd, 'trigger command not found');

  const option = triggerCmd.options.find(o => o.long === '--agents');
  assert.ok(option, '--agents option not found on trigger command');
});

test('functional command should have --agents flag', (t) => {
  const functionalCmd = program.commands.find(c => c.name() === 'functional');
  assert.ok(functionalCmd, 'functional command not found');

  const option = functionalCmd.options.find(o => o.long === '--agents');
  assert.ok(option, '--agents option not found on functional command');
});
