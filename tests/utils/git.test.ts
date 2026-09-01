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

// The cases below drive real git: the bug they pin is a path computation that only
// shows up against actual repository layouts.

import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { git } from '../../src/utils/git.js';

/** Creates a git repo holding a skill directory, with two commits so HEAD~1 exists. */
function makeSkillRepo(prefix: string): { repo: string; skill: string } {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const options = { cwd: repo, stdio: 'ignore' as const };
  execFileSync('git', ['init', '-q'], options);
  fs.mkdirSync(path.join(repo, 'my-skill'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'my-skill', 'SKILL.md'), '# skill\n', 'utf-8');
  execFileSync('git', ['add', '-A'], options);
  execFileSync('git', ['-c', 'user.email=t@e.com', '-c', 'user.name=T', 'commit', '-qm', 'add skill'], options);
  fs.writeFileSync(path.join(repo, 'README.md'), '# later\n', 'utf-8');
  execFileSync('git', ['add', '-A'], options);
  execFileSync('git', ['-c', 'user.email=t@e.com', '-c', 'user.name=T', 'commit', '-qm', 'later'], options);
  return { repo, skill: path.join(repo, 'my-skill') };
}

test('extractSkillRef: returns the extracted skill path, resolved against the skill repo', () => {
  mock.restoreAll();
  const { repo, skill } = makeSkillRepo('skill-eval-git-samerepo-');
  const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-ref-'));

  try {
    const extracted = git.extractSkillRef(skill, 'HEAD', targetDir);

    assert.strictEqual(extracted, path.join(targetDir, 'my-skill'));
    assert.ok(fs.existsSync(path.join(extracted, 'SKILL.md')), 'The returned path must hold the extracted skill');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
});

test('extractSkillRef: locates the skill even when it lives outside the workspace under evaluation', () => {
  mock.restoreAll();
  // Two unrelated repositories: the skill is in one, the workspace is another. Computing
  // the skill's place inside the extracted copy against the workspace used to escape
  // targetDir entirely, leaving the historical variant running with no skill.
  const { repo: skillRepo, skill } = makeSkillRepo('skill-eval-git-skillrepo-');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-git-workspace-'));
  const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-ref-'));

  try {
    const extracted = git.extractSkillRef(skill, 'HEAD~1', targetDir);

    assert.ok(
      extracted.startsWith(targetDir + path.sep),
      'The extracted skill must stay inside the extraction directory'
    );
    assert.ok(
      fs.existsSync(path.join(extracted, 'SKILL.md')),
      'The returned path must hold the extracted skill, whatever repository the workspace is'
    );

    // What the old computation produced: a path that escapes the extraction directory
    // altogether. Depending on the layout it either points nowhere or, as here, back at
    // the live working tree — which would measure the current skill twice and report the
    // historical variant as identical to local.
    const againstWorkspace = path.resolve(targetDir, path.relative(workspace, skill));
    assert.notStrictEqual(extracted, againstWorkspace, 'Fixture: the two computations must differ here');
    assert.ok(
      !againstWorkspace.startsWith(targetDir + path.sep),
      'The workspace-relative path escapes the extraction directory, which is the defect'
    );
  } finally {
    fs.rmSync(skillRepo, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
});
