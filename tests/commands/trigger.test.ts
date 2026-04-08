import { test, mock } from 'node:test';
import assert from 'node:assert';
import { triggerCommand } from '../../src/commands/trigger';
import { EvalEnvironment } from '../../src/core/environment';
import { RunnerFactory } from '../../src/core/runners';
import fs from 'node:fs';
import path from 'node:path';

test('triggerCommand should use worktrees for each evaluation', async (t) => {
  // Mock fs.existsSync and fs.readFileSync for evals.json
  const existsMock = mock.method(fs, 'existsSync', (p: string) => p.endsWith('evals.json'));
  const readMock = mock.method(fs, 'readFileSync', () => JSON.stringify({
    skill_name: 'test-skill',
    evals: [{ id: 'eval-1', prompt: 'test prompt' }]
  }));
  mock.method(fs, 'mkdirSync', () => {});
  mock.method(fs, 'writeFileSync', () => {});

  // Mock EvalEnvironment
  const setupMock = mock.method(EvalEnvironment.prototype, 'setup', async () => {});
  const teardownMock = mock.method(EvalEnvironment.prototype, 'teardown', async () => {});
  const createWorktreeMock = mock.method(EvalEnvironment.prototype, 'createWorktree', (id: string) => `/tmp/worktree-${id}`);
  const removeWorktreeMock = mock.method(EvalEnvironment.prototype, 'removeWorktree', () => {});

  // Mock Runner
  const runnerMock = {
    runPrompt: mock.fn((prompt: string, cwd?: string) => ({ response: 'ok', stats: {} }))
  };
  mock.method(RunnerFactory, 'create', () => runnerMock);

  await triggerCommand('gemini-cli', 'mock-skill');

  assert.strictEqual(createWorktreeMock.mock.calls.length, 1);
  assert.strictEqual(removeWorktreeMock.mock.calls.length, 1);
  assert.strictEqual(runnerMock.runPrompt.mock.calls[0].arguments[1], '/tmp/worktree-eval-0');

  existsMock.mock.restore();
  readMock.mock.restore();
  setupMock.mock.restore();
  teardownMock.mock.restore();
  createWorktreeMock.mock.restore();
  removeWorktreeMock.mock.restore();
  mock.restoreAll();
});
