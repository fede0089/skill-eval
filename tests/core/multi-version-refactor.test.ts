import { test } from 'node:test';
import assert from 'node:assert';
import { TaskResult } from '../../src/types/index.js';

test('TaskResult supports multiple versions', () => {
  const result: TaskResult = {
    taskId: 1,
    prompt: 'test',
    baselineTrials: [],
    skillTrials: {
      'local': [],
      'ref:main': []
    }
  };

  assert.ok(result.skillTrials['local']);
  assert.ok(result.skillTrials['ref:main']);
});
