import { test, mock } from 'node:test';
import assert from 'node:assert';
import { triggerCommand } from '../../src/commands/trigger';
import { EvalEnvironment } from '../../src/core/environment';
import { RunnerFactory } from '../../src/core/runners';
import fs from 'node:fs';

test('triggerCommand should use worktrees for each evaluation', async (t) => {
  mock.method(fs, 'existsSync', (p: string) => p.endsWith('evals.json'));
  mock.method(fs, 'readFileSync', () => JSON.stringify({
    skill_name: 'test-skill',
    evals: [{ id: 'eval-1', prompt: 'test prompt' }]
  }));
  mock.method(fs, 'mkdirSync', () => {});
  mock.method(fs, 'writeFileSync', () => {});

  mock.method(EvalEnvironment.prototype, 'setup', async () => {});
  mock.method(EvalEnvironment.prototype, 'teardown', async () => {});
  const createWorktreeMock = mock.method(EvalEnvironment.prototype, 'createWorktree', (id: string) => `/tmp/worktree-${id}`);
  const removeWorktreeMock = mock.method(EvalEnvironment.prototype, 'removeWorktree', () => {});

  const runnerMock = {
    runPrompt: mock.fn(() => ({ response: 'ok', stats: {}, error: undefined }))
  };
  mock.method(RunnerFactory, 'create', () => runnerMock);

  await triggerCommand('gemini-cli', 'mock-skill');

  assert.strictEqual(createWorktreeMock.mock.calls.length, 1);
  assert.strictEqual(removeWorktreeMock.mock.calls.length, 1);
  assert.strictEqual(runnerMock.runPrompt.mock.calls[0].arguments[1], '/tmp/worktree-eval-0');

  mock.restoreAll();
});

test('triggerCommand should pass interactive flag to runner', async (t) => {
  mock.method(fs, 'existsSync', (p: string) => p.endsWith('evals.json'));
  mock.method(fs, 'readFileSync', () => JSON.stringify({
    skill_name: 'test-skill',
    evals: [{ id: 'eval-1', prompt: 'test prompt' }]
  }));
  mock.method(fs, 'mkdirSync', () => {});
  mock.method(fs, 'writeFileSync', () => {});

  mock.method(EvalEnvironment.prototype, 'setup', async () => {});
  mock.method(EvalEnvironment.prototype, 'teardown', async () => {});
  mock.method(EvalEnvironment.prototype, 'createWorktree', (id: string) => `/tmp/worktree-${id}`);
  mock.method(EvalEnvironment.prototype, 'removeWorktree', () => {});

  const runnerMock = {
    runPrompt: mock.fn(() => ({ response: 'ok', stats: {}, error: undefined }))
  };
  mock.method(RunnerFactory, 'create', () => runnerMock);

  // Call with interactive = true
  await (triggerCommand as any)('gemini-cli', 'mock-skill', { interactive: true });

  const lastCall = runnerMock.runPrompt.mock.calls[0];
  assert.deepStrictEqual(lastCall.arguments[3], { interactive: true });

  mock.restoreAll();
});
