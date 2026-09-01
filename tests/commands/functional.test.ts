import { test, mock } from 'node:test';
import * as assert from 'node:assert';
import fs from 'node:fs';
import { functionalCommand } from '../../src/commands/functional.js';
import { EvalEnvironment } from '../../src/core/environment.js';
import { EvalRunner } from '../../src/core/eval-runner.js';
import { ConfigError } from '../../src/core/errors.js';

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
    await functionalCommand('gemini-cli', 'gemini-cli', process.cwd(), 'mock-skill', 1, injectedSuite, 1);

    // Verify skill-only runs: 1 task × 1 trial = 1 call
    assert.strictEqual(runnerMock.runFunctionalTask.mock.callCount(), 1);
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
    await functionalCommand('gemini-cli', 'gemini-cli', process.cwd(), 'mock-skill', 1, injectedSuite, 3);

    // skill-only: 3 trials (one throws at callCount=2) → 4 calls (3 original + 1 retry)
    assert.strictEqual(runnerMock.runFunctionalTask.mock.callCount(), 4);
  } finally {
    mock.reset();
  }
});

test('functionalCommand should run baseline when compareBaseline is enabled', async (t) => {
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
    await functionalCommand('gemini-cli', 'gemini-cli', process.cwd(), 'mock-skill', 1, injectedSuite, 1, undefined, undefined, undefined, [], true);

    // 1 task × 1 trial × 2 modes (baseline + local) = 2 calls
    assert.strictEqual(runnerMock.runFunctionalTask.mock.callCount(), 2);
  } finally {
    mock.reset();
  }
});

test('functionalCommand should skip trigger-only evals (should_trigger: false)', async () => {
  mock.method(fs, 'mkdirSync', () => {});
  mock.method(fs, 'writeFileSync', () => {});
  mock.method(fs, 'readdirSync', () => ['evals.json']);
  mock.method(fs, 'existsSync', () => true);

  const injectedSuite = {
    skill_name: 'mock-skill',
    tasks: [
      { id: 1, prompt: 'functional prompt', assertions: ['is correct'] },
      { id: 2, prompt: 'negative prompt', should_trigger: false }
    ]
  };

  mock.method(EvalEnvironment.prototype, 'setup', async () => {});
  mock.method(EvalEnvironment.prototype, 'teardown', async () => {});

  const runFunctionalTask = mock.fn(async () => ({
    id: 1,
    transcript: { response: 'Mock response' },
    assertionResults: [],
    trialPassed: true
  }));
  mock.method(EvalRunner.prototype, 'runFunctionalTask', runFunctionalTask);

  try {
    await functionalCommand('gemini-cli', 'gemini-cli', process.cwd(), 'mock-skill', 1, injectedSuite, 1);

    assert.strictEqual(runFunctionalTask.mock.callCount(), 1, 'Only the functional eval should run');
    const taskRun = runFunctionalTask.mock.calls[0].arguments[0] as { id: number };
    assert.strictEqual(taskRun.id, 1);
  } finally {
    mock.reset();
  }
});

test('functionalCommand should reject --eval-id targeting a trigger-only eval', async () => {
  mock.method(fs, 'mkdirSync', () => {});
  mock.method(fs, 'writeFileSync', () => {});
  mock.method(fs, 'readdirSync', () => ['evals.json']);
  mock.method(fs, 'existsSync', () => true);

  const injectedSuite = {
    skill_name: 'mock-skill',
    tasks: [
      { id: 1, prompt: 'functional prompt', assertions: ['is correct'] },
      { id: 2, prompt: 'negative prompt', should_trigger: false }
    ]
  };

  mock.method(EvalEnvironment.prototype, 'setup', async () => {});
  mock.method(EvalEnvironment.prototype, 'teardown', async () => {});

  try {
    await assert.rejects(
      () => functionalCommand('gemini-cli', 'gemini-cli', process.cwd(), 'mock-skill', 1, injectedSuite, 1, undefined, undefined, 2),
      (err: Error) => err instanceof ConfigError && err.message.includes('Eval #2 is trigger-only')
    );
  } finally {
    mock.reset();
  }
});

test('functionalCommand should reject a suite left empty by trigger-only evals', async () => {
  mock.method(fs, 'mkdirSync', () => {});
  mock.method(fs, 'writeFileSync', () => {});
  mock.method(fs, 'readdirSync', () => ['negative-triggers.json']);
  mock.method(fs, 'existsSync', () => true);

  const injectedSuite = {
    skill_name: 'mock-skill',
    tasks: [
      { id: 10, prompt: 'negative prompt', should_trigger: false },
      { id: 11, prompt: 'another negative prompt', should_trigger: false }
    ]
  };

  mock.method(EvalEnvironment.prototype, 'setup', async () => {});
  mock.method(EvalEnvironment.prototype, 'teardown', async () => {});

  try {
    await assert.rejects(
      () => functionalCommand('gemini-cli', 'gemini-cli', process.cwd(), 'mock-skill', 1, injectedSuite, 1),
      (err: Error) => err instanceof ConfigError && err.message.includes('No evals left to run')
    );
  } finally {
    mock.reset();
  }
});

test('functionalCommand drops the transcript but keeps the trial summary in the report', async () => {
  mock.method(fs, 'mkdirSync', () => {});
  mock.method(fs, 'writeFileSync', () => {});
  mock.method(fs, 'readdirSync', () => ['evals.json']);
  mock.method(fs, 'existsSync', () => true);
  mock.method(EvalEnvironment.prototype, 'setup', async () => {});
  mock.method(EvalEnvironment.prototype, 'teardown', async () => {});

  const injectedSuite = {
    skill_name: 'mock-skill',
    tasks: [{ id: 1, prompt: 'test prompt', assertions: ['is correct'] }]
  };

  const summary = {
    output: 'Rituclease',
    outputLen: 10,
    toolCalls: 10,
    stopStatus: 'success',
    logFile: 'task_1_local_trial_1.log'
  };

  mock.method(EvalRunner.prototype, 'runFunctionalTask', async () => ({
    id: 1,
    // Stand-in for the megabytes of raw NDJSON a real trial carries.
    transcript: { response: 'x'.repeat(10_000), raw_output: 'x'.repeat(10_000) },
    assertionResults: [{ assertion: 'is correct', passed: false, reason: 'no' }],
    trialPassed: false,
    summary
  }));

  let captured: any;
  const capturingReporter = { generate: (report: any) => { captured = report; } };

  try {
    await functionalCommand('gemini-cli', 'gemini-cli', process.cwd(), 'mock-skill', 1, injectedSuite, 1, capturingReporter);

    const trial = captured.results[0].skillTrials['local'][0];
    assert.strictEqual(trial.transcript, undefined, 'the raw transcript must not reach the report');
    assert.deepStrictEqual(trial.summary, summary, 'the summary is the evidence the report shows');
  } finally {
    mock.reset();
  }
});
