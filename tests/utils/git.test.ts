import { test, mock } from 'node:test';
import * as assert from 'node:assert';
import fs from 'node:fs';
import { extractSkillRef } from '../../src/utils/git.js';
import { executor } from '../../src/utils/exec.js';

test('extractSkillRef: should throw if skill path is not a git repo', () => {
  mock.method(executor, 'execSync', () => {
    throw new Error('not a git repository');
  });

  assert.throws(() => {
    extractSkillRef('/path/to/skill', 'main', '/target');
  }, /not inside a git repository/);

  mock.reset();
});

test('extractSkillRef: should call git archive with correct arguments', () => {
  const execMock = mock.fn();
  mock.method(executor, 'execSync', execMock);
  mock.method(fs, 'mkdirSync', () => {});

  // Mock successfully identifying git repo and then git archive
  execMock.mock.mockImplementation((cmd: string) => {
    if (cmd.includes('rev-parse')) return Buffer.from('repo-root');
    return Buffer.from('');
  });

  extractSkillRef('/path/to/skill', 'v1.0', '/target/dir');

  const calls = execMock.mock.calls;
  assert.ok(calls.some(c => (c.arguments[0] as string).includes('git archive')));
  assert.ok(calls.some(c => (c.arguments[0] as string).includes('v1.0')));
  assert.ok(calls.some(c => (c.arguments[0] as string).includes('/target/dir')));

  mock.reset();
});
