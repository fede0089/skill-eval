import { test, mock } from 'node:test';
import * as assert from 'node:assert';
import fs from 'fs';
import { functionalCommand } from '../../src/commands/functional';
import { EvalEnvironment } from '../../src/core/environment';
import { GeminiCliRunner } from '../../src/core/runners/gemini-cli.runner';
import { ModelBasedGrader } from '../../src/core/evaluator';

test('functionalCommand should handle tasks and trials', async (t) => {
  // Mock fs and path dependencies
  mock.method(fs, 'mkdirSync', () => {});
  mock.method(fs, 'writeFileSync', () => {});
  mock.method(fs, 'readdirSync', () => ['evals.json']);
  mock.method(fs, 'existsSync', (p: string) => true);
  mock.method(fs, 'readFileSync', () => JSON.stringify({
    skill_name: 'mock-skill',
    evals: [{ id: 'task-1', prompt: 'test prompt', expectations: ['is correct'] }]
  }));

  // Mock environment and runner
  mock.method(EvalEnvironment.prototype, 'setup', async () => {});
  mock.method(EvalEnvironment.prototype, 'teardown', async () => {});
  mock.method(EvalEnvironment.prototype, 'linkSkill', async () => {});
  mock.method(EvalEnvironment.prototype, 'createWorktree', (id: string) => `/tmp/worktree-${id}`);
  mock.method(EvalEnvironment.prototype, 'removeWorktree', () => {});

  const runnerMock = {
    runPrompt: mock.fn(async () => ({ response: 'Mock response' }))
  };
  mock.method(GeminiCliRunner.prototype, 'runPrompt', runnerMock.runPrompt);

  const graderMock = {
    gradeModelBased: mock.fn(async () => [{ assertion: 'is correct', passed: true, reason: 'looks good', graderType: 'model-based' }])
  };
  mock.method(ModelBasedGrader.prototype, 'gradeModelBased', graderMock.gradeModelBased);

  await functionalCommand('gemini-cli', 'mock-skill');

  // Verify baseline and target runs (2 trials)
  assert.strictEqual(runnerMock.runPrompt.mock.calls.length, 2);
  
  // Verify grader was called for both trials
  assert.strictEqual(graderMock.gradeModelBased.mock.calls.length, 2);
});
