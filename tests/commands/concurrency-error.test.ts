import { test, mock } from 'node:test';
import * as assert from 'node:assert';
import { triggerCommand } from '../../src/commands/trigger.js';
import { EvalEnvironment } from '../../src/core/environment.js';
import { EvalRunner } from '../../src/core/eval-runner.js';
import { EvalTask } from '../../src/types/index.js';

test('triggerCommand should continue and report on task failure', async (t) => {
  const injectedSuite = {
    skill_name: 'mock-skill',
    tasks: [
      { id: 1, prompt: 'failing prompt' },
      { id: 2, prompt: 'succeeding prompt' }
    ]
  };

  mock.method(EvalEnvironment.prototype, 'setup', async () => {});
  mock.method(EvalEnvironment.prototype, 'teardown', async () => {});

  const runnerMock = {
    runTriggerTask: mock.fn(async (task: EvalTask) => {
      if (task.id === 1) {
        throw new Error('Task failed');
      }
      return { 
        id: 1,
        transcript: { response: 'Mock response' },
        assertionResults: [],
        trialPassed: true 
      };
    })
  };
  mock.method(EvalRunner.prototype, 'runTriggerTask', runnerMock.runTriggerTask);

  await triggerCommand('gemini-cli', process.cwd(), 'mock-skill', 2, injectedSuite, 1);

  // task 1 always throws → 3 attempts (1 original + 2 retries); task 2 succeeds on first try → 4 total
  assert.strictEqual(runnerMock.runTriggerTask.mock.callCount(), 4);
});
