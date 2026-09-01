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
 * Trial environments live inside the workspace; the evidence root is a separate
 * directory the environment only touches to clear extracted refs.
 */
function makeWorkspaceAndArtifacts(): { workspace: string; worktreesDir: string; artifactsDir: string } {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-ws-'));
  return {
    workspace,
    worktreesDir: path.join(workspace, '.skill-eval-worktrees'),
    artifactsDir: fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-artifacts-'))
  };
}

test('EvalEnvironment.worktreePathFor places trial environments inside the workspace', () => {
  const { workspace, worktreesDir, artifactsDir } = makeWorkspaceAndArtifacts();

  try {
    const env = new EvalEnvironment({ workspace, worktreesDir });
    const worktreePath = env.worktreePathFor('test-task');

    assert.strictEqual(worktreePath, path.join(worktreesDir, 'test-task'));
    assert.ok(
      worktreePath.startsWith(workspace + path.sep),
      'The trial environment must live inside the workspace under evaluation'
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    fs.rmSync(artifactsDir, { recursive: true, force: true });
  }
});

test('EvalEnvironment.removeWorktree should not warn when git fails but path is already gone', (t) => {
  const env = new EvalEnvironment({ workspace: process.cwd(), worktreesDir: '/tmp/skill-eval-worktrees' });

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
  const env = new EvalEnvironment({ workspace: process.cwd(), worktreesDir: '/tmp/skill-eval-worktrees' });

  mock.method(executor, 'spawnSync', mock.fn(() => ({ status: 128 })));
  const warnMock = mock.fn();
  mock.method(Logger, 'warn', warnMock);

  env.removeWorktree(tmpDir);

  assert.strictEqual(warnMock.mock.callCount(), 0, 'Expected no warning when fallback cleanup succeeds');
  assert.ok(!fs.existsSync(tmpDir), 'Expected directory to be removed by fallback');

  mock.reset();
});

test('EvalEnvironment.teardown cleans up remaining trial environments and the working copies of the skill', async (t) => {
  const { workspace, worktreesDir, artifactsDir } = makeWorkspaceAndArtifacts();
  fs.mkdirSync(path.join(worktreesDir, 'leftover-1'), { recursive: true });
  fs.mkdirSync(path.join(worktreesDir, 'leftover-2'), { recursive: true });

  const skillRefsDir = path.join(artifactsDir, 'skill-refs');
  fs.mkdirSync(path.join(skillRefsDir, 'ref-1'), { recursive: true });

  const skillImplDir = path.join(artifactsDir, 'skill-impl');
  fs.mkdirSync(path.join(skillImplDir, 'local', 'mock-skill'), { recursive: true });

  const env = new EvalEnvironment({ workspace, worktreesDir, skillRefsDir, skillImplDir });
  const spawnMock = t.mock.method(executor, 'spawnSync', () => ({ status: 0 }));

  try {
    await env.teardown();
    assert.ok(!fs.existsSync(skillRefsDir), 'Expected skill-refs directory to be removed');
    assert.ok(!fs.existsSync(skillImplDir), 'Expected skill-impl directory to be removed');
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
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
  const { workspace, worktreesDir, artifactsDir } = makeWorkspaceAndArtifacts();
  fs.mkdirSync(worktreesDir, { recursive: true }); // exists but empty

  const env = new EvalEnvironment({ workspace, worktreesDir });
  const spawnMock = t.mock.method(executor, 'spawnSync', () => ({ status: 0 }));

  try {
    await env.teardown();
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
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
  const { workspace, worktreesDir, artifactsDir } = makeWorkspaceAndArtifacts();
  const evalId = 'test-stale-recovery';
  const worktreePath = path.join(worktreesDir, evalId);

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

  const env = new EvalEnvironment({ workspace, worktreesDir });
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
    fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    fs.rmSync(artifactsDir, { recursive: true, force: true });
  }
});

test('EvalEnvironment.teardown is a no-op when the trial environments dir does not exist', async (t) => {
  const { workspace, worktreesDir, artifactsDir } = makeWorkspaceAndArtifacts();
  // Do NOT create <workspace>/.skill-eval-worktrees — it should not exist

  const env = new EvalEnvironment({ workspace, worktreesDir });
  const spawnMock = t.mock.method(executor, 'spawnSync', () => ({ status: 0 }));

  try {
    await env.teardown();
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    fs.rmSync(artifactsDir, { recursive: true, force: true });
  }

  assert.strictEqual(spawnMock.mock.callCount(), 0, 'Expected no spawnSync calls');
});

test('EvalEnvironment.createWorktree works against a real repository', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-realrepo-'));
  const artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-artifacts-'));
  const worktreesDir = path.join(workspace, '.skill-eval-worktrees');

  const gitOptions = { cwd: workspace, stdio: 'ignore' as const };
  execFileSync('git', ['init', '-q'], gitOptions);
  fs.writeFileSync(path.join(workspace, 'README.md'), '# fixture\n', 'utf-8');
  execFileSync('git', ['add', '-A'], gitOptions);
  execFileSync('git', [
    '-c', 'user.email=test@example.com', '-c', 'user.name=Test',
    'commit', '-qm', 'init'
  ], gitOptions);

  const env = new EvalEnvironment({ workspace, worktreesDir });

  try {
    const worktreePath = env.createWorktree('task-1-trial-1');

    assert.ok(fs.existsSync(worktreePath), 'Worktree should have been created');
    assert.ok(
      fs.existsSync(path.join(worktreePath, 'README.md')),
      'Worktree should contain the repository content'
    );
    env.removeWorktree(worktreePath);
    assert.ok(!fs.existsSync(worktreePath), 'removeWorktree should have cleaned it up');
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    fs.rmSync(artifactsDir, { recursive: true, force: true });
  }
});

test('EvalEnvironment.createWorktree keeps the trial environment inside the workspace and out of the evidence root', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-realrepo-'));
  const artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-artifacts-'));
  const worktreesDir = path.join(workspace, '.skill-eval-worktrees');

  const gitOptions = { cwd: workspace, stdio: 'ignore' as const };
  execFileSync('git', ['init', '-q'], gitOptions);
  fs.writeFileSync(path.join(workspace, 'README.md'), '# fixture\n', 'utf-8');
  execFileSync('git', ['add', '-A'], gitOptions);
  execFileSync('git', [
    '-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-qm', 'init'
  ], gitOptions);

  const env = new EvalEnvironment({ workspace, worktreesDir });

  try {
    const worktreePath = env.createWorktree('task-1-local-trial-1');
    // os.tmpdir() is itself a symlink on macOS, so both sides are canonicalized.
    const realWorktreePath = fs.realpathSync(worktreePath);

    // The agent's working directory has to sit under the author's own tree: that is
    // where the CLI finds the credentials, folder trust and project settings it
    // resolves by walking up.
    assert.ok(
      realWorktreePath.startsWith(fs.realpathSync(workspace) + path.sep),
      'The trial environment must live inside the workspace under evaluation'
    );
    assert.ok(
      !realWorktreePath.startsWith(fs.realpathSync(artifactsDir) + path.sep),
      'The evidence root must hold no trial environment'
    );
    assert.ok(
      fs.existsSync(path.join(worktreePath, 'README.md')),
      'The trial environment should carry the repository content'
    );
  } finally {
    env.removeWorktree(env.worktreePathFor('task-1-local-trial-1'));
    fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    fs.rmSync(artifactsDir, { recursive: true, force: true });
  }
});

test('EvalEnvironment.teardown removes a trial environment abandoned by an interrupted run', async (t) => {
  const { workspace, worktreesDir, artifactsDir } = makeWorkspaceAndArtifacts();

  // No run created this one: it is what an abruptly interrupted run left behind.
  const abandoned = path.join(worktreesDir, 'task-9-local-trial-3');
  fs.mkdirSync(abandoned, { recursive: true });
  fs.writeFileSync(path.join(abandoned, 'stale.txt'), 'leftover', 'utf-8');

  const env = new EvalEnvironment({ workspace, worktreesDir });
  t.mock.method(executor, 'spawnSync', () => ({ status: 128 })); // git cannot help: the path is unregistered

  try {
    await env.teardown();

    assert.ok(!fs.existsSync(abandoned), 'The abandoned trial environment should be gone');
    assert.ok(
      !fs.existsSync(worktreesDir),
      'The directory that held it should go too, leaving the workspace as it was found'
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    fs.rmSync(artifactsDir, { recursive: true, force: true });
  }
});
