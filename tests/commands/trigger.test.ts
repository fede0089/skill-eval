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
    tasks: [{ id: 1, prompt: 'test prompt' }]
  };

  // Mock environment and runner
  mock.method(EvalEnvironment.prototype, 'setup', async () => {});
  mock.method(EvalEnvironment.prototype, 'teardown', async () => {});

  const runnerMock = {
    runTriggerTask: mock.fn(async () => ({
      id: 1,
      transcript: { response: 'Mock response' },
      assertionResults: [],
      trialPassed: true
    }))
  };
  mock.method(EvalRunner.prototype, 'runTriggerTask', runnerMock.runTriggerTask);

  try {
    await triggerCommand('gemini-cli', process.cwd(), 'mock-skill', 1, injectedSuite, 1);

    // Verify runner was called once (numTrials=1)
    assert.strictEqual(runnerMock.runTriggerTask.mock.callCount(), 1);
    assert.strictEqual(runnerMock.runTriggerTask.mock.calls[0].arguments[0].prompt, 'test prompt');
  } finally {
    mock.reset();
  }
});

test('triggerCommand should run all trials in parallel (no early abort on error)', async (t) => {
  mock.method(fs, 'mkdirSync', () => {});
  mock.method(fs, 'writeFileSync', () => {});
  mock.method(fs, 'readdirSync', () => ['evals.json']);
  mock.method(fs, 'existsSync', () => true);

  const injectedSuite = {
    skill_name: 'mock-skill',
    tasks: [{ id: 1, prompt: 'test prompt' }]
  };

  mock.method(EvalEnvironment.prototype, 'setup', async () => {});
  mock.method(EvalEnvironment.prototype, 'teardown', async () => {});

  let callCount = 0;
  const runnerMock = {
    runTriggerTask: mock.fn(async () => {
      callCount++;
      if (callCount === 2) throw new Error('trial 2 failed');
      return { id: callCount, transcript: { response: 'ok' }, assertionResults: [], trialPassed: true };
    })
  };
  mock.method(EvalRunner.prototype, 'runTriggerTask', runnerMock.runTriggerTask);

  try {
    await triggerCommand('gemini-cli', process.cwd(), 'mock-skill', 1, injectedSuite, 3);

    // All 3 trials must have been attempted; trial 2 errors and is retried once → 4 total calls
    assert.ok(runnerMock.runTriggerTask.mock.callCount() >= 3, 'All trials must be attempted (no early abort)');
    assert.strictEqual(runnerMock.runTriggerTask.mock.callCount(), 4, 'Errored trial should be retried once');
  } finally {
    mock.reset();
  }
});

test('triggerCommand should propagate should_trigger polarity to the report', async () => {
  mock.method(fs, 'mkdirSync', () => {});
  mock.method(fs, 'readdirSync', () => ['evals.json']);
  mock.method(fs, 'existsSync', () => true);

  const written: string[] = [];
  mock.method(fs, 'writeFileSync', (_p: string, content: string) => { written.push(content); });

  const injectedSuite = {
    skill_name: 'mock-skill',
    tasks: [
      { id: 1, prompt: 'positive prompt' },
      { id: 2, prompt: 'negative prompt', should_trigger: false }
    ]
  };

  mock.method(EvalEnvironment.prototype, 'setup', async () => {});
  mock.method(EvalEnvironment.prototype, 'teardown', async () => {});
  mock.method(EvalRunner.prototype, 'runTriggerTask', mock.fn(async () => ({
    id: 1,
    transcript: { response: 'Mock response' },
    assertionResults: [],
    trialPassed: true
  })));

  try {
    await triggerCommand('gemini-cli', process.cwd(), 'mock-skill', 1, injectedSuite, 1);

    const summary = written.map(c => { try { return JSON.parse(c); } catch { return null; } })
      .find(r => r && r.command === 'trigger');
    assert.ok(summary, 'Expected a trigger summary to be written');
    const byId = Object.fromEntries(summary.results.map((r: any) => [r.taskId, r.shouldTrigger]));
    assert.strictEqual(byId[1], true);
    assert.strictEqual(byId[2], false);
  } finally {
    mock.reset();
  }
});
