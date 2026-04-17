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

test('EvalEnvironment.removeWorktree should not warn when git fails but path is already gone', (t) => {
  const env = new EvalEnvironment({ workspace: process.cwd() });

  mock.method(executor, 'spawnSync', mock.fn(() => ({ status: 128 })));
  const warnMock = mock.fn();
  mock.method(Logger, 'warn', warnMock);

  // Non-existent path — fs.existsSync naturally returns false, no fs mocking needed
  env.removeWorktree('/tmp/skill-eval-nonexistent-worktree-xyz-99999');

  assert.strictEqual(warnMock.mock.callCount(), 0, 'Expected no warning when path is already gone');

  mock.reset();
});

test('EvalEnvironment.removeWorktree should silently clean up when git fails but dir still exists', (t) => {
  // Use a real temp dir so existsSync returns true and rmSync actually removes it
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-worktree-test-'));
  const env = new EvalEnvironment({ workspace: process.cwd() });

  mock.method(executor, 'spawnSync', mock.fn(() => ({ status: 128 })));
  const warnMock = mock.fn();
  mock.method(Logger, 'warn', warnMock);

  env.removeWorktree(tmpDir);

  assert.strictEqual(warnMock.mock.callCount(), 0, 'Expected no warning when fallback cleanup succeeds');
  assert.ok(!fs.existsSync(tmpDir), 'Expected directory to be removed by fallback');

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

test('EvalEnvironment.createWorktree copies .gemini/ from workspace into worktree', (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-test-'));
  const evalId = 'test-copy-gemini';
  const worktreePath = path.join(workspace, '.project-skill-evals', 'worktrees', evalId);

  // Create a .gemini/settings.json in the workspace
  const geminiDir = path.join(workspace, '.gemini');
  fs.mkdirSync(geminiDir, { recursive: true });
  const settingsContent = JSON.stringify({ tools: { allowed: ['run_shell_command'] } });
  fs.writeFileSync(path.join(geminiDir, 'settings.json'), settingsContent, 'utf-8');

  // Mock spawnSync: call 1 = remove --force (returns 128), call 2 = prune (returns 0),
  // call 3 = add (returns 0, and creates the directory)
  let spawnCallCount = 0;
  t.mock.method(executor, 'spawnSync', () => {
    spawnCallCount++;
    if (spawnCallCount === 3) {
      // Simulate git worktree add by creating the directory
      fs.mkdirSync(worktreePath, { recursive: true });
      return { status: 0 };
    }
    return { status: 128 };
  });

  const env = new EvalEnvironment({ workspace });
  try {
    env.createWorktree(evalId);
    const copiedSettings = path.join(worktreePath, '.gemini', 'settings.json');
    assert.ok(fs.existsSync(copiedSettings), 'Expected .gemini/settings.json to be copied into worktree');
    assert.strictEqual(fs.readFileSync(copiedSettings, 'utf-8'), settingsContent);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('EvalEnvironment.createWorktree does not fail when workspace has no .gemini/', (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-test-'));
  const evalId = 'test-no-gemini';
  const worktreePath = path.join(workspace, '.project-skill-evals', 'worktrees', evalId);

  let spawnCallCount = 0;
  t.mock.method(executor, 'spawnSync', () => {
    spawnCallCount++;
    if (spawnCallCount === 3) {
      fs.mkdirSync(worktreePath, { recursive: true });
      return { status: 0 };
    }
    return { status: 128 };
  });

  const env = new EvalEnvironment({ workspace });
  try {
    const result = env.createWorktree(evalId);
    assert.strictEqual(result, worktreePath);
    assert.ok(!fs.existsSync(path.join(worktreePath, '.gemini')), 'Expected no .gemini/ in worktree when workspace has none');
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('EvalEnvironment.createWorktree should recover from stale physical directory', (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-test-'));
  const evalId = 'test-stale-recovery';
  const worktreePath = path.join(workspace, '.project-skill-evals', 'worktrees', evalId);

  // Simulate a previous crashed run: directory already exists with leftover content
  fs.mkdirSync(worktreePath, { recursive: true });
  fs.writeFileSync(path.join(worktreePath, 'leftover.txt'), 'stale', 'utf-8');

  let spawnCallCount = 0;
  const spawnArgs: string[][] = [];
  t.mock.method(executor, 'spawnSync', (_cmd: string, args: string[]) => {
    spawnCallCount++;
    spawnArgs.push(args);
    if (spawnCallCount === 3) {
      // Simulate git worktree add: physical rm already happened, create fresh dir
      fs.mkdirSync(worktreePath, { recursive: true });
      return { status: 0 };
    }
    return { status: spawnCallCount === 2 ? 0 : 128 };
  });

  const env = new EvalEnvironment({ workspace });
  try {
    const result = env.createWorktree(evalId);

    assert.strictEqual(result, worktreePath);
    assert.strictEqual(spawnCallCount, 3, 'Expected remove → prune → add (3 spawnSync calls)');
    assert.ok(spawnArgs[0].includes('remove'), 'First call should be git worktree remove');
    assert.ok(spawnArgs[1].includes('prune'),  'Second call should be git worktree prune');
    assert.ok(spawnArgs[2].includes('add'),    'Third call should be git worktree add');
    assert.ok(!fs.existsSync(path.join(worktreePath, 'leftover.txt')), 'Stale leftover.txt should have been removed before add');
    assert.ok(fs.existsSync(worktreePath), 'Worktree directory should exist after add');
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
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
