import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { executor } from '../utils/exec.js';
import { ExecutionError } from './errors.js';
import { EVALS_DIRNAME } from './skill-parts.js';

/**
 * Git operations scoped to a skill's implementation.
 *
 * An evolution session commits and restores the skill on the author's own
 * repository, so every command here is narrowed by a pathspec that covers the
 * implementation and excludes the evals. Nothing in this module operates on the
 * repository as a whole: no branch switching, no `reset --hard`, no unscoped
 * `clean`. What the author has staged or pending outside the skill has to
 * survive a session untouched.
 */

export interface SkillRepo {
  /** Root of the repository the skill lives in. */
  repoRoot: string;
  /** Path of the skill relative to that root; empty when the skill is the root. */
  skillRelPath: string;
}

/**
 * Locates the repository the skill belongs to, asking git rather than
 * subtracting two paths: on a case-insensitive filesystem the two sides can
 * disagree on spelling, and the pathspec would then match nothing.
 *
 * @throws ExecutionError if the skill is not inside a git repository.
 */
export function resolveSkillRepo(skillPath: string): SkillRepo {
  const repoRoot = runGit(['rev-parse', '--show-toplevel'], skillPath, 'locate the repository of the skill').trim();
  const prefix = runGit(['rev-parse', '--show-prefix'], skillPath, 'locate the skill inside its repository').trim();
  return { repoRoot, skillRelPath: prefix.replace(/\/+$/, '') };
}

/**
 * The pathspec of a skill's implementation: everything the skill holds except
 * its evals. It is the unit every Git safeguard of an evolution session works
 * on — what gets committed when a proposal is accepted, and what gets restored
 * when it is rejected.
 */
export function implementationPathspec(skillRelPath: string): string[] {
  const base = skillRelPath === '' ? '.' : skillRelPath;
  const evals = skillRelPath === '' ? EVALS_DIRNAME : `${skillRelPath}/${EVALS_DIRNAME}`;
  return [base, `:(exclude)${evals}`];
}

function runGit(args: string[], cwd: string, purpose: string): string {
  const result = executor.spawnSync('git', args, { cwd, encoding: 'utf-8' });
  if (result.status !== 0) {
    const stderr = (result.stderr ?? '').toString().trim();
    throw new ExecutionError(`Failed to ${purpose}: git ${args.join(' ')} exited with ${result.status}. ${stderr}`);
  }
  return (result.stdout ?? '').toString();
}

/**
 * Parses `git status --porcelain -z` into a path → status map. The NUL-separated
 * form is used because it neither quotes nor escapes unusual file names; a rename
 * or copy entry is followed by its source path, which is consumed and dropped.
 */
function parsePorcelain(raw: string): Map<string, string> {
  const entries = new Map<string, string>();
  const fields = raw.split('\0');

  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (!field) continue;
    const status = field.slice(0, 2);
    entries.set(field.slice(3), status);
    // 'R'/'C' entries carry the original path in the next field.
    if (status[0] === 'R' || status[0] === 'C') i++;
  }

  return entries;
}

/**
 * The state of one path that differs from the committed version: what git says
 * about it, and what it holds. The digest is there because a status alone cannot
 * tell a file the author had already modified from the same file modified again
 * by someone else.
 */
export interface WorkingTreeEntry {
  status: string;
  digest: string;
}

export type WorkingTreeSnapshot = Map<string, WorkingTreeEntry>;

export class SkillGit {
  private readonly repoRoot: string;
  private readonly skillRelPath: string;
  private readonly pathspec: string[];

  constructor(repo: SkillRepo) {
    this.repoRoot = repo.repoRoot;
    this.skillRelPath = repo.skillRelPath;
    this.pathspec = implementationPathspec(repo.skillRelPath);
  }

  /** Whether a repository-relative path belongs to the skill's implementation. */
  private insideImplementation(target: string): boolean {
    const base = this.skillRelPath === '' ? '' : `${this.skillRelPath}/`;
    if (base !== '' && !target.startsWith(base)) return false;
    return !target.startsWith(`${base}${EVALS_DIRNAME}/`);
  }

  private digestOf(target: string): string {
    try {
      return crypto.createHash('sha1').update(fs.readFileSync(path.join(this.repoRoot, target))).digest('hex');
    } catch {
      // Deleted, or a directory entry git reported as a whole: nothing to hash.
      return 'absent';
    }
  }

  /**
   * What the whole repository looks like right now, relative to the committed
   * version. Taken before handing the tree to an agent, so what the agent changed
   * outside the skill can be told apart from what the author already had there.
   */
  public snapshotWorkingTree(): WorkingTreeSnapshot {
    const raw = this.git(['status', '--porcelain', '-z'], 'read the status of the working tree');
    const snapshot: WorkingTreeSnapshot = new Map();
    for (const [target, status] of parsePorcelain(raw)) {
      snapshot.set(target, { status, digest: this.digestOf(target) });
    }
    return snapshot;
  }

  /**
   * Undoes what changed outside the skill's implementation since `before`.
   *
   * The comparison is against that snapshot and never against HEAD: what the
   * author already had pending outside the skill has to be left exactly as it
   * was. A path the agent created is removed; a tracked one is checked out.
   *
   * @returns the paths that were reverted.
   */
  public revertOutOfScope(before: WorkingTreeSnapshot): string[] {
    const after = this.snapshotWorkingTree();
    const reverted: string[] = [];

    for (const [target, state] of after) {
      if (this.insideImplementation(target)) continue;

      const prior = before.get(target);
      if (prior && prior.status === state.status && prior.digest === state.digest) continue;

      if (state.status.startsWith('??')) {
        fs.rmSync(path.join(this.repoRoot, target), { recursive: true, force: true });
      } else {
        this.git(['checkout', '--', target], `revert '${target}', which the agent changed outside its scope`);
      }
      reverted.push(target);
    }

    return reverted;
  }

  /** The committed version currently in effect. */
  public headSha(): string {
    return this.git(['rev-parse', 'HEAD'], 'read the current commit').trim();
  }

  public shortSha(sha = 'HEAD'): string {
    return this.git(['rev-parse', '--short', sha], 'read the short form of a commit').trim();
  }

  /** Paths of the implementation that differ from the committed version. */
  public implementationStatus(): string[] {
    const raw = this.git(
      ['status', '--porcelain', '-z', '--', ...this.pathspec],
      'read the status of the skill implementation'
    );
    return [...parsePorcelain(raw).keys()];
  }

  public hasImplementationChanges(): boolean {
    return this.implementationStatus().length > 0;
  }

  /**
   * Commits the implementation as it stands in the working tree.
   *
   * The commit is partial and addressed by pathspec, so it takes the working
   * tree content of those paths and leaves the rest of the index exactly as the
   * author left it. `add -N` first, so a file the candidate created is included
   * without staging anything else.
   *
   * @returns the sha of the commit created.
   */
  public commitImplementation(message: string): string {
    this.git(['add', '-N', '--', ...this.pathspec], 'mark new implementation files for the commit');
    this.git(['commit', '-m', message, '--', ...this.pathspec], 'commit the skill implementation');
    return this.headSha();
  }

  /**
   * Brings the implementation back to the committed version: tracked files are
   * checked out from HEAD, and files the candidate added are removed. The evals
   * and everything outside the skill are left as they are.
   */
  public restoreImplementation(): void {
    const checkout = executor.spawnSync(
      'git',
      ['checkout', 'HEAD', '--', ...this.pathspec],
      { cwd: this.repoRoot, encoding: 'utf-8' }
    );

    if (checkout.status !== 0) {
      const stderr = (checkout.stderr ?? '').toString().trim();
      // A skill with nothing committed under its implementation has nothing to
      // check out, and `clean` alone is the whole restoration. Any other failure
      // means the implementation was left as the candidate had it.
      if (!/did not match any file\(s\) known to git/.test(stderr)) {
        throw new ExecutionError(`Failed to restore the skill implementation: ${stderr}`);
      }
    }

    this.git(['clean', '-fd', '--', ...this.pathspec], 'remove the files the candidate added');
  }

  /**
   * Preserves a recoverable copy of whatever the author had in the working tree,
   * before the session can discard any of it: a patch of the tracked changes plus
   * the untracked files themselves.
   *
   * @returns the path of the patch, or undefined when the tree was clean.
   */
  public backupWorkingTree(targetDir: string): string | undefined {
    const diff = this.git(['diff', 'HEAD'], 'read the pending changes of the working tree');
    const untracked = this.git(
      ['ls-files', '--others', '--exclude-standard', '-z'],
      'list the untracked files of the working tree'
    ).split('\0').filter(Boolean);

    if (diff === '' && untracked.length === 0) return undefined;

    fs.mkdirSync(targetDir, { recursive: true });
    const patchPath = path.join(targetDir, 'author-worktree.patch');
    fs.writeFileSync(patchPath, diff);

    for (const relative of untracked) {
      const target = path.join(targetDir, 'untracked', relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(this.repoRoot, relative), target);
    }

    return patchPath;
  }

  private git(args: string[], purpose: string): string {
    return runGit(args, this.repoRoot, purpose);
  }
}
