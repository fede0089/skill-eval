import * as fs from 'fs';
import { executor } from '../utils/exec.js';
import * as path from 'path';
import { Logger } from '../utils/logger.js';
import { ExecutionError } from './errors.js';

export interface EnvironmentOptions {
  skillPath: string;
}

export class EvalEnvironment {
  private skillPath: string;
  private absoluteSkillPath: string;

  constructor(options: EnvironmentOptions) {
    this.skillPath = options.skillPath;
    this.absoluteSkillPath = path.resolve(process.cwd(), this.skillPath);
  }

  public async setup(): Promise<void> {
    Logger.debug(`Setting up evaluation environment...`);
  }

  public async teardown(): Promise<void> {
    // Global unlink is no longer needed as worktree deletion cleans up local symlinks
  }

  /**
   * Links the target skill locally within the specified worktree.
   * This provides isolation by avoiding global skill linking.
   */
  public async linkSkill(worktreePath: string): Promise<void> {
    const skillName = path.basename(this.absoluteSkillPath);
    const localSkillsDir = path.join(worktreePath, '.agents', 'skills');
    const symlinkPath = path.join(localSkillsDir, skillName);

    Logger.debug(`Linking skill to worktree: ${symlinkPath}`);

    try {
      if (!fs.existsSync(localSkillsDir)) {
        fs.mkdirSync(localSkillsDir, { recursive: true });
      }

      // If a symlink already exists, remove it
      if (fs.existsSync(symlinkPath)) {
        fs.unlinkSync(symlinkPath);
      }

      fs.symlinkSync(this.absoluteSkillPath, symlinkPath, 'dir');
      Logger.debug(`Skill linked successfully to worktree.`);
    } catch (err) {
      const errorMsg = `Failed to link skill to worktree: ${err instanceof Error ? err.message : String(err)}`;
      Logger.error(errorMsg);
      throw new ExecutionError(errorMsg);
    }
  }

  public async unlinkSkill(): Promise<void> {
    // Global unlink is deprecated in favor of isolated worktree linking.
    // This is kept for backward compatibility but does nothing.
  }

  /**
   * Creates a temporary git worktree for a specific evaluation.
   * This provides isolation by ensuring each test runs in its own clean copy of the repo.
   */
  public createWorktree(evalId: string): string {
    const worktreePath = path.resolve(process.cwd(), '.project-skill-evals', 'worktrees', evalId);
    
    Logger.debug(`Creating worktree at: ${worktreePath}`);
    
    // Ensure the path is clean before adding a worktree
    // We try to remove it first in case a previous run crashed
    executor.spawnSync('git', ['worktree', 'remove', '--force', worktreePath], { stdio: 'ignore' });
    
    const child = executor.spawnSync('git', ['worktree', 'add', worktreePath, '-f'], {
      stdio: 'ignore',
      encoding: 'utf-8'
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
