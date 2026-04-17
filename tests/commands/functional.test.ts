import { test, mock } from 'node:test';
import * as assert from 'node:assert';
import fs from 'node:fs';
import { functionalCommand } from '../../src/commands/functional.js';
import { EvalEnvironment } from '../../src/core/environment.js';
import { EvalRunner } from '../../src/core/eval-runner.js';

test('functionalCommand should handle tasks and trials', async (t) => {
  // Mock fs and path dependencies
  mock.method(fs, 'mkdirSync', () => {});
  mock.method(fs, 'writeFileSync', () => {});
  mock.method(fs, 'readdirSync', () => ['evals.json']);
  mock.method(fs, 'existsSync', (p: string) => true);

  const injectedSuite = {
    skill_name: 'mock-skill',
    tasks: [{ id: 1, prompt: 'test prompt', expectations: ['is correct'] }]
  };

  // Mock environment and runner
  mock.method(EvalEnvironment.prototype, 'setup', async () => {});
  mock.method(EvalEnvironment.prototype, 'teardown', async () => {});

  const runnerMock = {
    runFunctionalTask: mock.fn(async () => ({
      id: 1,
      transcript: { response: 'Mock response' },
      assertionResults: [],
      trialPassed: true
    }))
  };
  mock.method(EvalRunner.prototype, 'runFunctionalTask', runnerMock.runFunctionalTask);

  try {
    await functionalCommand('gemini-cli', process.cwd(), 'mock-skill', 1, injectedSuite, 1);

    // Verify baseline and target runs: 1 task × 1 trial × 2 passes = 2 calls
    assert.strictEqual(runnerMock.runFunctionalTask.mock.callCount(), 2);
  } finally {
    mock.reset();
  }
});

test('functionalCommand should run all trials in parallel (no early abort on error)', async (t) => {
  mock.method(fs, 'mkdirSync', () => {});
  mock.method(fs, 'writeFileSync', () => {});
  mock.method(fs, 'readdirSync', () => ['evals.json']);
  mock.method(fs, 'existsSync', () => true);

  const injectedSuite = {
    skill_name: 'mock-skill',
    tasks: [{ id: 1, prompt: 'test prompt', expectations: ['is correct'] }]
  };

  mock.method(EvalEnvironment.prototype, 'setup', async () => {});
  mock.method(EvalEnvironment.prototype, 'teardown', async () => {});

  let callCount = 0;
  const runnerMock = {
    runFunctionalTask: mock.fn(async () => {
      callCount++;
      if (callCount === 2) throw new Error('trial 2 failed');
      return { id: callCount, transcript: { response: 'ok' }, assertionResults: [], trialPassed: true };
    })
  };
  mock.method(EvalRunner.prototype, 'runFunctionalTask', runnerMock.runFunctionalTask);

  try {
    await functionalCommand('gemini-cli', process.cwd(), 'mock-skill', 1, injectedSuite, 3);

    // without-skill: 3 trials (one throws at callCount=2) → 4 calls (3 original + 1 retry)
    // with-skill:    3 trials (none throws, callCount≠2)  → 3 calls
    // total: 7
    assert.strictEqual(runnerMock.runFunctionalTask.mock.callCount(), 7);
  } finally {
    mock.reset();
  }
});
