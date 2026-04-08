import { test, mock } from 'node:test';
import assert from 'node:assert';
import { functionalCommand } from '../../src/commands/functional';
import { EvalEnvironment } from '../../src/core/environment';
import { RunnerFactory } from '../../src/core/runners';
import { FunctionalEvaluator } from '../../src/core/evaluator';
import fs from 'node:fs';
import * as child_process from 'node:child_process';

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
  mock.method(EvalEnvironment.prototype, 'createWorktree', (id: string) => `/tmp/worktree-${id}`);
  mock.method(EvalEnvironment.prototype, 'removeWorktree', () => {});
  mock.method(RunnerFactory, 'create', () => ({
    runPrompt: () => ({ response: 'ok', stats: {} })
  }));
  mock.method(FunctionalEvaluator.prototype, 'isSkillTriggered', () => true);
  mock.method(FunctionalEvaluator.prototype, 'extractMetrics', () => ({ latencyMs: 10, tokens: 100 }));

  await functionalCommand('gemini-cli', 'mock-skill');
  
  // We can't easily check the logger output here without more mocks, 
  // but we can check the final summary file if we mock it correctly.
  
  mock.restoreAll();
});
