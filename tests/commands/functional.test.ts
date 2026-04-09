import { test, mock } from 'node:test';
import assert from 'node:assert';
import { functionalCommand } from '../../src/commands/functional';
import { EvalEnvironment } from '../../src/core/environment';
import { RunnerFactory } from '../../src/core/runners';
import { FunctionalEvaluator } from '../../src/core/evaluator';
import fs from 'node:fs';

test('functionalCommand should skip functional pass if expectations are missing', async (t) => {
  mock.method(fs, 'existsSync', (p: string) => p.endsWith('evals.json'));
  mock.method(fs, 'readFileSync', () => JSON.stringify({
    skill_name: 'test-skill',
    evals: [{ id: 'eval-1', prompt: 'test prompt' }] // No expectations
  }));
  mock.method(fs, 'mkdirSync', () => {});
  mock.method(fs, 'writeFileSync', () => {});
  mock.method(EvalEnvironment.prototype, 'setup', async () => {});
  mock.method(EvalEnvironment.prototype, 'teardown', async () => {});
  mock.method(EvalEnvironment.prototype, 'linkSkill', async () => {});
  mock.method(EvalEnvironment.prototype, 'unlinkSkill', async () => {});
  mock.method(EvalEnvironment.prototype, 'createWorktree', (id: string) => `/tmp/worktree-${id}`);
  mock.method(EvalEnvironment.prototype, 'removeWorktree', () => {});
  mock.method(RunnerFactory, 'create', () => ({
    runPrompt: () => ({ response: 'ok', stats: {}, error: undefined })
  }));
  mock.method(FunctionalEvaluator.prototype, 'isSkillTriggered', () => true);

  await functionalCommand('gemini-cli', 'mock-skill');
  
  mock.restoreAll();
});
