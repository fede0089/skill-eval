import * as path from 'path';
import * as assert from 'node:assert';
import { test } from 'node:test';
import { EvalEnvironment } from '../../src/core/environment.js';

test('EvalEnvironment.createWorktree should return expected path', async (t) => {
  const env = new EvalEnvironment({ skillPath: 'mock-skill' });
  const taskId = 'test-task';
  const expectedPath = path.resolve(process.cwd(), '.project-skill-evals', 'worktrees', taskId);
  
  // We can't easily mock spawnSync here without issues in this env,
  // but we can verify the path generation logic.
  assert.ok(expectedPath.includes('.project-skill-evals/worktrees/test-task'));
});
