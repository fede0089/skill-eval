import { executor } from '../utils/exec.js';
import * as path from 'path';
import * as fs from 'fs';
import { Logger } from '../utils/logger.js';
import { ExecutionError } from './errors.js';

export interface EnvironmentOptions {
  /** Repository the worktrees are cut from; every git command runs with its cwd here. */
  workspace: string;
  /**
   * Directory holding the isolated environment of each trial. It lives inside the
   * workspace so the agent resolves credentials, folder trust and project settings
   * exactly as it would in the author's real use, and it is removed on teardown.
   */
  worktreesDir: string;
  /**
   * Extracted copies of historical refs, under the evidence root. Only the
   * command-level environment owns them, so per-trial environments omit it.
   */
  skillRefsDir?: string;
  /**
   * Materialized skill implementations — what each variant links into its trial
   * environment — under the evidence root. Owned like `skillRefsDir`.
   */
  skillImplDir?: string;
}

export class EvalEnvironment {
  private workspace: string;
  private worktreesDir: string;
  private skillRefsDir?: string;
  private skillImplDir?: string;

  constructor(options: EnvironmentOptions) {
    this.workspace = options.workspace;
    this.worktreesDir = options.worktreesDir;
    this.skillRefsDir = options.skillRefsDir;
    this.skillImplDir = options.skillImplDir;
  }

  /** Path of the isolated environment for an eval, inside the workspace. */
  public worktreePathFor(evalId: string): string {
    return path.resolve(this.worktreesDir, evalId);
  }

  public async setup(): Promise<void> {
  }

  public async teardown(): Promise<void> {
    // 1. Trial environments. Anything found here is removed, including what an
    // interrupted earlier run left behind, and the directory goes with it so the
    // workspace is left exactly as it was found.
    if (fs.existsSync(this.worktreesDir)) {
      for (const entry of fs.readdirSync(this.worktreesDir)) {
        this.removeWorktree(path.join(this.worktreesDir, entry));
      }
      executor.spawnSync('git', ['worktree', 'prune'], { stdio: 'ignore', cwd: this.workspace });
      try {
        fs.rmSync(this.worktreesDir, { recursive: true, force: true });
      } catch (err) {
        Logger.warn(`Failed to remove trial environments directory at ${this.worktreesDir}. Manual cleanup may be required.`);
      }
    }

    // 2. Working copies of the skill under the evidence root — the extracted
    // historical refs and the materialized implementations — only when this
    // environment owns them. The run's evidence itself is never touched.
    this.removeOwnedDir(this.skillRefsDir, 'skill-refs');
    this.removeOwnedDir(this.skillImplDir, 'skill-impl');
  }

  private removeOwnedDir(dir: string | undefined, label: string): void {
    if (!dir || !fs.existsSync(dir)) return;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      Logger.warn(`Failed to remove ${label} directory at ${dir}. Manual cleanup may be required.`);
    }
  }

  /**
   * Creates a temporary git worktree for a specific evaluation.
   * This provides isolation by ensuring each test runs in its own clean copy of the repo.
   */
  public createWorktree(evalId: string): string {
    const worktreePath = this.worktreePathFor(evalId);
    const branchName = path.basename(worktreePath);

    // Ensure the path is clean before adding a worktree.
    // We try to remove it first in case a previous run crashed.
    executor.spawnSync('git', ['worktree', 'remove', '--force', worktreePath], { stdio: 'ignore', cwd: this.workspace });
    executor.spawnSync('git', ['branch', '-D', branchName], { stdio: 'ignore', cwd: this.workspace });

    // If git worktree remove failed (e.g. path was never registered, or git
    // metadata is stale), fall back to a physical wipe and a metadata prune so
    // that 'git worktree add' does not exit 128 on a pre-existing path.
    if (fs.existsSync(worktreePath)) {
      fs.rmSync(worktreePath, { recursive: true, force: true });
    }
    executor.spawnSync('git', ['worktree', 'prune'], { stdio: 'ignore', cwd: this.workspace });

    const child = executor.spawnSync('git', ['worktree', 'add', worktreePath, '-f'], {
      stdio: 'ignore',
      encoding: 'utf-8',
      cwd: this.workspace
    });

    if (child.status !== 0) {
      throw new ExecutionError(`Failed to create git worktree at ${worktreePath}. Process exited with code ${child.status}`);
    }

    return worktreePath;
  }

  /**
   * Removes a previously created git worktree and its associated branch.
   */
  public removeWorktree(worktreePath: string): void {
    const branchName = path.basename(worktreePath);

    const child = executor.spawnSync('git', ['worktree', 'remove', '--force', worktreePath], {
      stdio: 'ignore',
      encoding: 'utf-8',
      cwd: this.workspace
    });

    if (child.status !== 0) {
      // git worktree remove failed (e.g. path already deregistered by a previous prune).
      // Fall back to physical removal and prune stale references.
      try {
        if (fs.existsSync(worktreePath)) {
          fs.rmSync(worktreePath, { recursive: true, force: true });
        }
        executor.spawnSync('git', ['worktree', 'prune'], { stdio: 'ignore', cwd: this.workspace });
      } catch (err) {
        Logger.warn(`Failed to remove worktree at ${worktreePath}. Process exited with code ${child.status}. Manual cleanup may be required.`);
      }
    }

    // Always try to delete the branch created for this worktree.
    // Wrap in try-catch because the branch might already be gone.
    try {
      executor.spawnSync('git', ['branch', '-D', branchName], {
        stdio: 'ignore',
        cwd: this.workspace
      });
    } catch (err) {
      // Ignore errors deleting the temporary branch
    }
  }
}
