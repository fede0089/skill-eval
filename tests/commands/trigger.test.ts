import { test, mock } from 'node:test';
import * as assert from 'node:assert';
import fs from 'fs';
import { triggerCommand } from '../../src/commands/trigger';
import { EvalEnvironment } from '../../src/core/environment';
import { GeminiCliRunner } from '../../src/core/runners/gemini-cli.runner';

test('triggerCommand should use worktrees for each task', async (t) => {
  // Mock fs and path dependencies
  mock.method(fs, 'mkdirSync', () => {});
  mock.method(fs, 'writeFileSync', () => {});
  mock.method(fs, 'readdirSync', () => ['evals.json']);
  mock.method(fs, 'existsSync', (p: string) => true);
  mock.method(fs, 'readFileSync', () => JSON.stringify({
    skill_name: 'mock-skill',
    evals: [{ id: 'task-1', prompt: 'test prompt' }]
  }));

  // Mock environment and runner
  mock.method(EvalEnvironment.prototype, 'setup', async () => {});
  mock.method(EvalEnvironment.prototype, 'teardown', async () => {});
  mock.method(EvalEnvironment.prototype, 'linkSkill', async () => {});
  const createWorktreeMock = mock.method(EvalEnvironment.prototype, 'createWorktree', (id: string) => `/tmp/worktree-${id}`);
  const removeWorktreeMock = mock.method(EvalEnvironment.prototype, 'removeWorktree', () => {});

  const runnerMock = {
    runPrompt: mock.fn(async () => ({ response: 'Mock response', stats: { tools: { byName: { 'mock-skill': { count: 1 } } } } }))
  };
  mock.method(GeminiCliRunner.prototype, 'runPrompt', runnerMock.runPrompt);

  await triggerCommand('gemini-cli', 'mock-skill');

  // Verify worktree was created for the task
  assert.strictEqual(createWorktreeMock.mock.calls.length, 1);
  assert.strictEqual(createWorktreeMock.mock.calls[0].arguments[0], 'task-0');
  
  // Verify runner was called with the worktree path
  assert.strictEqual(runnerMock.runPrompt.mock.calls.length, 1);
  assert.strictEqual(runnerMock.runPrompt.mock.calls[0].arguments[1], '/tmp/worktree-task-0');

  // Verify worktree was removed
  assert.strictEqual(removeWorktreeMock.mock.calls.length, 1);
});
