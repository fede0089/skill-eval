import { executor } from '../utils/exec.js';
import * as path from 'path';
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
    Logger.debug(`Setting up evaluation environment...`);
  }

  public async teardown(): Promise<void> {
    // Global unlink is no longer needed as worktree deletion cleans up local symlinks
  }

  /**
   * Creates a temporary git worktree for a specific evaluation.
   * This provides isolation by ensuring each test runs in its own clean copy of the repo.
   */
  public createWorktree(evalId: string): string {
    const worktreePath = path.resolve(this.workspace, '.project-skill-evals', 'worktrees', evalId);

    Logger.debug(`Creating worktree at: ${worktreePath}`);

    // Ensure the path is clean before adding a worktree
    // We try to remove it first in case a previous run crashed
    executor.spawnSync('git', ['worktree', 'remove', '--force', worktreePath], { stdio: 'ignore', cwd: this.workspace });

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
    Logger.debug(`Removing worktree: ${worktreePath}`);
    
    const child = executor.spawnSync('git', ['worktree', 'remove', '--force', worktreePath], {
      stdio: 'ignore',
      encoding: 'utf-8'
    });

    if (child.status !== 0) {
      Logger.warn(`Failed to remove worktree at ${worktreePath}. Process exited with code ${child.status}. Manual cleanup may be required.`);
    }
  }
}
