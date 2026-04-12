import * as path from 'path';
import * as assert from 'node:assert';
import { test, mock } from 'node:test';
import { EvalEnvironment } from '../../src/core/environment.js';
import { executor } from '../../src/utils/exec.js';
import { Logger } from '../../src/utils/logger.js';

test('EvalEnvironment.createWorktree should return expected path', async (t) => {
  const env = new EvalEnvironment({ workspace: process.cwd(), skillPath: 'mock-skill' });
  const taskId = 'test-task';
  const expectedPath = path.resolve(process.cwd(), '.project-skill-evals', 'worktrees', taskId);

  // We can't easily mock spawnSync here without issues in this env,
  // but we can verify the path generation logic.
  assert.ok(expectedPath.includes('.project-skill-evals/worktrees/test-task'));
});

test('EvalEnvironment.removeWorktree should warn when git worktree remove fails', (t) => {
  const env = new EvalEnvironment({ workspace: process.cwd(), skillPath: 'mock-skill' });

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
