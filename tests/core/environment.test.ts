import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execFileSync } from 'node:child_process';
import * as assert from 'node:assert';
import { test, mock } from 'node:test';
import { EvalEnvironment } from '../../src/core/environment.js';
import { executor } from '../../src/utils/exec.js';
import { Logger } from '../../src/utils/logger.js';

/**
 * The artifacts root is always created separately from the workspace: nothing the
 * tool generates may land inside the repository under evaluation.
 */
function makeWorkspaceAndArtifacts(): { workspace: string; artifactsDir: string } {
  return {
    workspace: fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-ws-')),
    artifactsDir: fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-artifacts-'))
  };
}

test('EvalEnvironment.worktreePathFor places worktrees under the artifacts root', () => {
  const { workspace, artifactsDir } = makeWorkspaceAndArtifacts();

  try {
    const env = new EvalEnvironment({ workspace, artifactsDir });
    const worktreePath = env.worktreePathFor('test-task');

    assert.strictEqual(worktreePath, path.join(artifactsDir, 'worktrees', 'test-task'));
    assert.ok(
      !worktreePath.startsWith(workspace + path.sep),
      'Worktree must not be placed inside the workspace under evaluation'
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(artifactsDir, { recursive: true, force: true });
  }
});

test('EvalEnvironment.removeWorktree should not warn when git fails but path is already gone', (t) => {
  const env = new EvalEnvironment({ workspace: process.cwd(), artifactsDir: '/tmp/skill-eval-artifacts' });

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
  const env = new EvalEnvironment({ workspace: process.cwd(), artifactsDir: '/tmp/skill-eval-artifacts' });

  mock.method(executor, 'spawnSync', mock.fn(() => ({ status: 128 })));
  const warnMock = mock.fn();
  mock.method(Logger, 'warn', warnMock);

  env.removeWorktree(tmpDir);

  assert.strictEqual(warnMock.mock.callCount(), 0, 'Expected no warning when fallback cleanup succeeds');
  assert.ok(!fs.existsSync(tmpDir), 'Expected directory to be removed by fallback');

  mock.reset();
});

test('EvalEnvironment.teardown cleans up remaining worktrees and skill-refs', async (t) => {
  const { workspace, artifactsDir } = makeWorkspaceAndArtifacts();
  const worktreesDir = path.join(artifactsDir, 'worktrees');
  fs.mkdirSync(path.join(worktreesDir, 'leftover-1'), { recursive: true });
  fs.mkdirSync(path.join(worktreesDir, 'leftover-2'), { recursive: true });

  const skillRefsDir = path.join(artifactsDir, 'skill-refs');
  fs.mkdirSync(path.join(skillRefsDir, 'ref-1'), { recursive: true });

  const env = new EvalEnvironment({ workspace, artifactsDir });
  const spawnMock = t.mock.method(executor, 'spawnSync', () => ({ status: 0 }));

  try {
    await env.teardown();
    assert.ok(!fs.existsSync(skillRefsDir), 'Expected skill-refs directory to be removed');
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(artifactsDir, { recursive: true, force: true });
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

test('EvalEnvironment.teardown runs git worktree prune against the workspace repository', async (t) => {
  const { workspace, artifactsDir } = makeWorkspaceAndArtifacts();
  fs.mkdirSync(path.join(artifactsDir, 'worktrees'), { recursive: true }); // exists but empty

  const env = new EvalEnvironment({ workspace, artifactsDir });
  const spawnMock = t.mock.method(executor, 'spawnSync', () => ({ status: 0 }));

  try {
    await env.teardown();
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(artifactsDir, { recursive: true, force: true });
  }

  const pruneCalls = spawnMock.mock.calls.filter(c => {
    const args = c.arguments[1] as string[];
    return args[0] === 'worktree' && args[1] === 'prune';
  });
  assert.strictEqual(pruneCalls.length, 1, 'Expected git worktree prune to be called once');
  assert.deepStrictEqual(
    pruneCalls[0].arguments[2],
    { stdio: 'ignore', cwd: workspace },
    'Git must run against the workspace repository, not the artifacts root'
  );
});


test('EvalEnvironment.createWorktree should recover from stale physical directory', (t) => {
  const { workspace, artifactsDir } = makeWorkspaceAndArtifacts();
  const evalId = 'test-stale-recovery';
  const worktreePath = path.join(artifactsDir, 'worktrees', evalId);

  // Simulate a previous crashed run: directory already exists with leftover content
  fs.mkdirSync(worktreePath, { recursive: true });
  fs.writeFileSync(path.join(worktreePath, 'leftover.txt'), 'stale', 'utf-8');

  let spawnCallCount = 0;
  const spawnArgs: string[][] = [];
  t.mock.method(executor, 'spawnSync', (_cmd: string, args: string[]) => {
    spawnCallCount++;
    spawnArgs.push(args);
    if (spawnCallCount === 4) {
      // Simulate git worktree add: physical rm already happened, create fresh dir
      fs.mkdirSync(worktreePath, { recursive: true });
      return { status: 0 };
    }
    return { status: spawnCallCount === 3 ? 0 : 128 };
  });

  const env = new EvalEnvironment({ workspace, artifactsDir });
  try {
    const result = env.createWorktree(evalId);

    assert.strictEqual(result, worktreePath);
    assert.strictEqual(spawnCallCount, 4, 'Expected remove → branch delete → prune → add (4 spawnSync calls)');
    assert.ok(spawnArgs[0].includes('remove'), 'First call should be git worktree remove');
    assert.deepStrictEqual(spawnArgs[1], ['branch', '-D', evalId], 'Second call should delete the stale branch');
    assert.ok(spawnArgs[2].includes('prune'),  'Third call should be git worktree prune');
    assert.ok(spawnArgs[3].includes('add'),    'Fourth call should be git worktree add');
    assert.ok(!fs.existsSync(path.join(worktreePath, 'leftover.txt')), 'Stale leftover.txt should have been removed before add');
    assert.ok(fs.existsSync(worktreePath), 'Worktree directory should exist after add');
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(artifactsDir, { recursive: true, force: true });
  }
});

test('EvalEnvironment.teardown is a no-op when worktrees dir does not exist', async (t) => {
  const { workspace, artifactsDir } = makeWorkspaceAndArtifacts();
  // Do NOT create <artifactsDir>/worktrees — it should not exist

  const env = new EvalEnvironment({ workspace, artifactsDir });
  const spawnMock = t.mock.method(executor, 'spawnSync', () => ({ status: 0 }));

  try {
    await env.teardown();
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(artifactsDir, { recursive: true, force: true });
  }

  assert.strictEqual(spawnMock.mock.callCount(), 0, 'Expected no spawnSync calls');
});

test('EvalEnvironment.createWorktree works against a real repository with the artifacts root outside it', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-realrepo-'));
  const artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-artifacts-'));

  const gitOptions = { cwd: workspace, stdio: 'ignore' as const };
  execFileSync('git', ['init', '-q'], gitOptions);
  fs.writeFileSync(path.join(workspace, 'README.md'), '# fixture\n', 'utf-8');
  execFileSync('git', ['add', '-A'], gitOptions);
  execFileSync('git', [
    '-c', 'user.email=test@example.com', '-c', 'user.name=Test',
    'commit', '-qm', 'init'
  ], gitOptions);

  const env = new EvalEnvironment({ workspace, artifactsDir });

  try {
    const worktreePath = env.createWorktree('task-1-trial-1');

    assert.ok(fs.existsSync(worktreePath), 'Worktree should have been created');
    assert.ok(
      fs.existsSync(path.join(worktreePath, 'README.md')),
      'Worktree should contain the repository content'
    );
    assert.ok(
      !worktreePath.startsWith(fs.realpathSync(workspace) + path.sep),
      'Worktree must live outside the repository under evaluation'
    );

    env.removeWorktree(worktreePath);
    assert.ok(!fs.existsSync(worktreePath), 'removeWorktree should have cleaned it up');
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(artifactsDir, { recursive: true, force: true });
  }
});
