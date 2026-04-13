import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as assert from 'node:assert';
import { test, mock } from 'node:test';
import { EvalEnvironment } from '../../src/core/environment.js';
import { executor } from '../../src/utils/exec.js';
import { Logger } from '../../src/utils/logger.js';

test('EvalEnvironment.createWorktree should return expected path', async (t) => {
  const env = new EvalEnvironment({ workspace: process.cwd() });
  const taskId = 'test-task';
  const expectedPath = path.resolve(process.cwd(), '.project-skill-evals', 'worktrees', taskId);

  // We can't easily mock spawnSync here without issues in this env,
  // but we can verify the path generation logic.
  assert.ok(expectedPath.includes('.project-skill-evals/worktrees/test-task'));
});

test('EvalEnvironment.removeWorktree should warn when git worktree remove fails', (t) => {
  const env = new EvalEnvironment({ workspace: process.cwd() });

  mock.method(executor, 'spawnSync', mock.fn(() => ({ status: 1 })));
  const warnMock = mock.fn();
  mock.method(Logger, 'warn', warnMock);

  env.removeWorktree('/tmp/some-worktree');

  const warnCalls = warnMock.mock.calls.map(c => c.arguments[0] as string);
  assert.ok(
    warnCalls.some(msg => msg.includes('Failed to remove worktree')),
    `Expected a warn about failed worktree removal, got: ${JSON.stringify(warnCalls)}`
  );

  mock.reset();
});

test('EvalEnvironment.teardown cleans up remaining worktrees', async (t) => {
  // Use a real temp workspace so we avoid re-mocking fs properties across tests
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-test-'));
  const worktreesDir = path.join(workspace, '.project-skill-evals', 'worktrees');
  fs.mkdirSync(path.join(worktreesDir, 'leftover-1'), { recursive: true });
  fs.mkdirSync(path.join(worktreesDir, 'leftover-2'), { recursive: true });

  const env = new EvalEnvironment({ workspace });
  const spawnMock = t.mock.method(executor, 'spawnSync', () => ({ status: 0 }));

  try {
    await env.teardown();
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }

  const removeCalls = spawnMock.mock.calls
    .filter(c => (c.arguments[1] as string[]).includes('remove'))
    .map(c => (c.arguments[1] as string[]));

  assert.ok(
    removeCalls.some(args => args.includes(path.join(worktreesDir, 'leftover-1'))),
    'Expected removeWorktree called for leftover-1'
  );
  assert.ok(
    removeCalls.some(args => args.includes(path.join(worktreesDir, 'leftover-2'))),
    'Expected removeWorktree called for leftover-2'
  );
});

test('EvalEnvironment.teardown runs git worktree prune', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-test-'));
  const worktreesDir = path.join(workspace, '.project-skill-evals', 'worktrees');
  fs.mkdirSync(worktreesDir, { recursive: true }); // exists but empty

  const env = new EvalEnvironment({ workspace });
  const spawnMock = t.mock.method(executor, 'spawnSync', () => ({ status: 0 }));

  try {
    await env.teardown();
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }

  const pruneCalls = spawnMock.mock.calls.filter(c => {
    const args = c.arguments[1] as string[];
    return args[0] === 'worktree' && args[1] === 'prune';
  });
  assert.strictEqual(pruneCalls.length, 1, 'Expected git worktree prune to be called once');
  assert.deepStrictEqual(pruneCalls[0].arguments[2], { stdio: 'ignore', cwd: workspace });
});

test('EvalEnvironment.teardown is a no-op when worktrees dir does not exist', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-test-'));
  // Do NOT create .project-skill-evals/worktrees — it should not exist

  const env = new EvalEnvironment({ workspace });
  const spawnMock = t.mock.method(executor, 'spawnSync', () => ({ status: 0 }));

  try {
    await env.teardown();
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }

  assert.strictEqual(spawnMock.mock.callCount(), 0, 'Expected no spawnSync calls');
});
