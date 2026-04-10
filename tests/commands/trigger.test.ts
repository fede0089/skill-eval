import { test, mock } from 'node:test';
import * as assert from 'node:assert';
import fs from 'fs';
import { triggerCommand } from '../../src/commands/trigger.js';
import { EvalEnvironment } from '../../src/core/environment.js';
import { EvalRunner } from '../../src/core/eval-runner.js';

test('triggerCommand should use worktrees for each task', async (t) => {
  // Mock fs and path dependencies
  mock.method(fs, 'mkdirSync', () => {});
  mock.method(fs, 'writeFileSync', () => {});
  mock.method(fs, 'readdirSync', () => ['evals.json']);
  mock.method(fs, 'existsSync', (p: string) => true);
  
  const injectedSuite = {
    skill_name: 'mock-skill',
    tasks: [{ id: 'task-1', prompt: 'test prompt' }]
  };

  // Mock environment and runner
  mock.method(EvalEnvironment.prototype, 'setup', async () => {});
  mock.method(EvalEnvironment.prototype, 'teardown', async () => {});

  const runnerMock = {
    runTriggerTask: mock.fn(async () => ({ 
      id: 'trial-1',
      transcript: { response: 'Mock response' },
      assertionResults: [],
      trialPassed: true 
    }))
  };
  mock.method(EvalRunner.prototype, 'runTriggerTask', runnerMock.runTriggerTask);

  await triggerCommand('gemini-cli', 'mock-skill', 1, injectedSuite);

  // Verify runner was called
  assert.strictEqual(runnerMock.runTriggerTask.mock.callCount(), 1);
  assert.strictEqual(runnerMock.runTriggerTask.mock.calls[0].arguments[0].prompt, 'test prompt');
});
