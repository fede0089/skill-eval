import { test, mock } from 'node:test';
import assert from 'node:assert';
import { EvalEnvironment } from '../../src/core/environment';
import child_process from 'node:child_process';
import path from 'node:path';

test('EvalEnvironment.createWorktree should execute git worktree add and return the path', async (t) => {
  const env = new EvalEnvironment({ skillPath: 'mock-skill' });
  const spawnMock = mock.method(child_process, 'spawnSync', () => ({ status: 0 }));

  const evalId = 'eval-123';
  const worktreePath = env.createWorktree(evalId);

  assert.ok(spawnMock.mock.calls.length > 0);
  const lastCall = spawnMock.mock.calls[spawnMock.mock.calls.length - 1];
  assert.strictEqual(lastCall.arguments[0], 'git');
  assert.deepStrictEqual(lastCall.arguments[1], [
    'worktree',
    'add',
    path.resolve(process.cwd(), '.project-skill-evals', 'worktrees', evalId),
    '-f'
  ]);
  assert.ok(worktreePath.includes(path.join('.project-skill-evals', 'worktrees', evalId)));
  
  spawnMock.mock.restore();
});

test('EvalEnvironment.removeWorktree should execute git worktree remove', async (t) => {
  const env = new EvalEnvironment({ skillPath: 'mock-skill' });
  const spawnMock = mock.method(child_process, 'spawnSync', () => ({ status: 0 }));

  const evalPath = '/tmp/some-worktree';
  env.removeWorktree(evalPath);

  assert.ok(spawnMock.mock.calls.length > 0);
  const lastCall = spawnMock.mock.calls[spawnMock.mock.calls.length - 1];
  assert.strictEqual(lastCall.arguments[0], 'git');
  assert.deepStrictEqual(lastCall.arguments[1], [
    'worktree',
    'remove',
    '--force',
    evalPath
  ]);
  
  spawnMock.mock.restore();
});
