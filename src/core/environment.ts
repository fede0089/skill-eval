import { spawnSync } from 'child_process';
import * as path from 'path';
import { Logger } from '../utils/logger';
import { ExecutionError } from './errors';

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
    Logger.debug(`Linking skill from: ${this.absoluteSkillPath}`);
    
    // Link the target skill and auto-confirm the prompt
    const child = spawnSync('gemini', ['skills', 'link', this.absoluteSkillPath], {
      input: 'Y\n',
      stdio: ['pipe', 'ignore', 'ignore'],
      encoding: 'utf-8'
    });

    if (child.status !== 0) {
      const errorMsg = `Failed to link skill: gemini process exited with code ${child.status}`;
      Logger.error(errorMsg);
      throw new ExecutionError(errorMsg);
    }

    Logger.debug(`Skill linked successfully.`);
  }

  public async teardown(): Promise<void> {
    const skillName = path.basename(this.absoluteSkillPath);
    Logger.debug(`Tearing down skill link for '${skillName}'...`);
    
    const child = spawnSync('gemini', ['skills', 'uninstall', skillName], {
      stdio: 'ignore',
      encoding: 'utf-8'
    });

    if (child.status !== 0) {
      Logger.debug(`Failed to uninstall skill during teardown (it might already be uninstalled). Status code: ${child.status}`);
    } else {
      Logger.debug(`Teardown complete.`);
    }
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
    spawnSync('git', ['worktree', 'remove', '--force', worktreePath], { stdio: 'ignore' });
    
    const child = spawnSync('git', ['worktree', 'add', worktreePath, '-f'], {
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
    
    const child = spawnSync('git', ['worktree', 'remove', '--force', worktreePath], {
      stdio: 'ignore',
      encoding: 'utf-8'
    });

    if (child.status !== 0) {
      Logger.debug(`Failed to remove worktree at ${worktreePath}. Process exited with code ${child.status}`);
    }
  }
}
