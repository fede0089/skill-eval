import { executor } from '../utils/exec.js';
import * as path from 'path';
import * as fs from 'fs';
import { Logger } from '../utils/logger.js';
import { ExecutionError } from './errors.js';

export interface EnvironmentOptions {
  workspace: string;
}

export class EvalEnvironment {
  private workspace: string;

  constructor(options: EnvironmentOptions) {
    this.workspace = options.workspace;
  }

  public async setup(): Promise<void> {
  }

  public async teardown(): Promise<void> {
    const worktreesDir = path.resolve(this.workspace, '.project-skill-evals', 'worktrees');
    if (!fs.existsSync(worktreesDir)) return;

    for (const entry of fs.readdirSync(worktreesDir)) {
      this.removeWorktree(path.join(worktreesDir, entry));
    }

    executor.spawnSync('git', ['worktree', 'prune'], { stdio: 'ignore', cwd: this.workspace });
  }

  /**
   * Creates a temporary git worktree for a specific evaluation.
   * This provides isolation by ensuring each test runs in its own clean copy of the repo.
   */
  public createWorktree(evalId: string): string {
    const worktreePath = path.resolve(this.workspace, '.project-skill-evals', 'worktrees', evalId);

    // Ensure the path is clean before adding a worktree.
    // We try to remove it first in case a previous run crashed.
    executor.spawnSync('git', ['worktree', 'remove', '--force', worktreePath], { stdio: 'ignore', cwd: this.workspace });

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
   * Removes a previously created git worktree.
   */
  public removeWorktree(worktreePath: string): void {
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
  }
}
