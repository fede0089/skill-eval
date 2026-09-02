import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { implementationPathspec, resolveSkillRepo, SkillGit } from '../../src/core/skill-git.js';

// Drives real Git against a throwaway repository: what these guarantees are worth
// is exactly what git does with the pathspec, so mocking it would test nothing.

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', ...args], {
    cwd,
    encoding: 'utf-8'
  });
}

/**
 * A repository holding a skill and a file outside it, committed. The witnesses
 * of every case are the same: what lives outside the skill, and the skill's evals.
 */
function makeRepo(): { workspace: string; skillPath: string; skillGit: SkillGit } {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-skillgit-'));
  const skillPath = path.join(workspace, 'my-skill');

  fs.mkdirSync(path.join(skillPath, 'evals'), { recursive: true });
  fs.writeFileSync(path.join(skillPath, 'SKILL.md'), 'committed implementation\n');
  fs.writeFileSync(path.join(skillPath, 'evals', 'license.json'), '{"committed":true}\n');
  fs.writeFileSync(path.join(workspace, 'README.md'), 'committed readme\n');

  git(workspace, ['init', '-q']);
  git(workspace, ['add', '-A']);
  git(workspace, ['commit', '-qm', 'the committed version']);

  return { workspace, skillPath, skillGit: new SkillGit(resolveSkillRepo(skillPath)) };
}

/** The author's pending work outside the skill, staged and unstaged, plus an evals edit. */
function dirtyTheWitnesses(workspace: string): void {
  fs.writeFileSync(path.join(workspace, 'README.md'), 'staged by the author\n');
  git(workspace, ['add', 'README.md']);
  fs.writeFileSync(path.join(workspace, 'README.md'), 'and then edited again\n');
  fs.writeFileSync(path.join(workspace, 'untracked-note.md'), 'the author was taking notes\n');
  fs.writeFileSync(path.join(workspace, 'my-skill', 'evals', 'license.json'), '{"tampered":true}\n');
}

test('implementationPathspec covers the skill and excludes its evals', () => {
  assert.deepStrictEqual(implementationPathspec('my-skill'), ['my-skill', ':(exclude)my-skill/evals']);
  // A skill that is the repository root still has an evals directory to exclude.
  assert.deepStrictEqual(implementationPathspec(''), ['.', ':(exclude)evals']);
});

test('commitImplementation commits only the implementation and leaves the rest of the tree alone', () => {
  const { workspace, skillGit } = makeRepo();

  try {
    dirtyTheWitnesses(workspace);
    fs.writeFileSync(path.join(workspace, 'my-skill', 'SKILL.md'), 'candidate implementation\n');
    fs.writeFileSync(path.join(workspace, 'my-skill', 'reference.md'), 'a file the candidate added\n');

    assert.ok(skillGit.hasImplementationChanges());
    assert.deepStrictEqual(
      skillGit.implementationStatus().sort(),
      ['my-skill/SKILL.md', 'my-skill/reference.md']
    );

    skillGit.commitImplementation('accept the candidate');

    const committed = git(workspace, ['show', '--name-only', '--format=', 'HEAD']).trim().split('\n').sort();
    assert.deepStrictEqual(committed, ['my-skill/SKILL.md', 'my-skill/reference.md'],
      'the evals and everything outside the skill must stay out of the commit');

    const status = git(workspace, ['status', '--porcelain']);
    assert.match(status, /^MM README\.md$/m, "the author's staged and unstaged work must survive intact");
    assert.match(status, /^ M my-skill\/evals\/license\.json$/m, 'the evals must not be committed');
    assert.match(status, /^\?\? untracked-note\.md$/m);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('restoreImplementation returns the implementation to HEAD without touching the rest', () => {
  const { workspace, skillGit } = makeRepo();

  try {
    dirtyTheWitnesses(workspace);
    fs.writeFileSync(path.join(workspace, 'my-skill', 'SKILL.md'), 'rejected candidate\n');
    fs.writeFileSync(path.join(workspace, 'my-skill', 'junk.md'), 'a file the candidate added\n');
    // Even staged, a rejected candidate goes: the incumbent is what HEAD holds.
    git(workspace, ['add', 'my-skill/SKILL.md']);

    skillGit.restoreImplementation();

    assert.strictEqual(
      fs.readFileSync(path.join(workspace, 'my-skill', 'SKILL.md'), 'utf-8'),
      'committed implementation\n'
    );
    assert.ok(!fs.existsSync(path.join(workspace, 'my-skill', 'junk.md')), 'files the candidate added must be removed');
    assert.strictEqual(skillGit.hasImplementationChanges(), false);

    const status = git(workspace, ['status', '--porcelain']);
    assert.match(status, /^MM README\.md$/m, "the author's work outside the skill must survive a rejection");
    assert.match(status, /^ M my-skill\/evals\/license\.json$/m, 'the evals are never restored either');
    assert.ok(fs.existsSync(path.join(workspace, 'untracked-note.md')));
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('backupWorkingTree leaves a patch that reapplies the tree it preserved', () => {
  const { workspace, skillGit } = makeRepo();
  const backupDir = path.join(workspace, '..', path.basename(workspace) + '-backup');

  try {
    fs.writeFileSync(path.join(workspace, 'README.md'), 'work the author had not committed\n');
    fs.writeFileSync(path.join(workspace, 'untracked-note.md'), 'and a file only on disk\n');

    const patch = skillGit.backupWorkingTree(backupDir);
    assert.ok(patch, 'a dirty tree must be preserved');
    assert.strictEqual(
      fs.readFileSync(path.join(backupDir, 'untracked', 'untracked-note.md'), 'utf-8'),
      'and a file only on disk\n',
      'an untracked file has no patch to live in, so it is copied'
    );

    // Discard the author's work the way a rejection would, then bring it back.
    git(workspace, ['checkout', '--', '.']);
    assert.strictEqual(fs.readFileSync(path.join(workspace, 'README.md'), 'utf-8'), 'committed readme\n');

    git(workspace, ['apply', patch!]);
    assert.strictEqual(
      fs.readFileSync(path.join(workspace, 'README.md'), 'utf-8'),
      'work the author had not committed\n',
      'the copy has to be recoverable, not just retained'
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test('backupWorkingTree preserves nothing when the tree is clean', () => {
  const { workspace, skillGit } = makeRepo();
  const backupDir = path.join(workspace, '..', path.basename(workspace) + '-clean-backup');

  try {
    assert.strictEqual(skillGit.backupWorkingTree(backupDir), undefined);
    assert.ok(!fs.existsSync(backupDir));
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
