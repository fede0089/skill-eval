import { test, mock } from 'node:test';
import * as assert from 'node:assert';
import fs from 'fs';
import { functionalCommand } from '../../src/commands/functional.js';
import { triggerCommand } from '../../src/commands/trigger.js';
import { EvalEnvironment } from '../../src/core/environment.js';
import { EvalRunner } from '../../src/core/eval-runner.js';
import { git } from '../../src/utils/git.js';
import { AgentPool } from '../../src/core/agent-pool.js';

test('Phase 2: functionalCommand should handle N references', async (t) => {
  mock.method(fs, 'mkdirSync', () => {});
  mock.method(fs, 'writeFileSync', () => {});
  mock.method(fs, 'readdirSync', () => ['evals.json']);
  mock.method(fs, 'existsSync', () => true);
  mock.method(git, 'extractSkillRef', () => {});
  mock.method(EvalEnvironment.prototype, 'setup', async () => {});
  mock.method(EvalEnvironment.prototype, 'teardown', async () => {});

  const runnerMock = mock.method(EvalRunner.prototype, 'runFunctionalTask', async () => ({
    id: 1,
    transcript: {},
    assertionResults: [],
    trialPassed: true
  }));

  const injectedSuite = {
    skill_name: 'mock-skill',
    tasks: [{ id: 1, prompt: 'test prompt' }]
  };

  try {
    await functionalCommand('gemini-cli', process.cwd(), 'mock-skill', 4, injectedSuite, 1, undefined, undefined, undefined, ['ref1', 'ref2']);

    // total calls: baseline (1) + local (1) + ref1 (1) + ref2 (1) = 4
    assert.strictEqual(runnerMock.mock.callCount(), 4);
    
    // Check results are aggregated correctly
    // (This would require capturing the report, but build success and call count are good indicators)
  } finally {
    mock.reset();
  }
});

test('Phase 2: triggerCommand should share AgentPool across variants', async (t) => {
  mock.method(fs, 'mkdirSync', () => {});
  mock.method(fs, 'writeFileSync', () => {});
  mock.method(fs, 'readdirSync', () => ['evals.json']);
  mock.method(fs, 'existsSync', () => true);
  mock.method(git, 'extractSkillRef', () => {});
  mock.method(EvalEnvironment.prototype, 'setup', async () => {});
  mock.method(EvalEnvironment.prototype, 'teardown', async () => {});

  const acquireSpy = mock.method(AgentPool.prototype, 'acquire');

  mock.method(EvalRunner.prototype, 'runTriggerTask', async () => {
    return { id: 1, transcript: {}, assertionResults: [], trialPassed: true };
  });

  const injectedSuite = {
    skill_name: 'mock-skill',
    tasks: [{ id: 1, prompt: 'test prompt' }]
  };

  try {
    await triggerCommand('gemini-cli', process.cwd(), 'mock-skill', 4, injectedSuite, 3, undefined, undefined, undefined, ['ref1']);

    // total trials: local (3) + ref1 (3) = 6
    // each trial must acquire once
    assert.strictEqual(acquireSpy.mock.callCount(), 6);
  } finally {
    mock.reset();
  }
});
