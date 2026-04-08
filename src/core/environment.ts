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
    Logger.info(`\n[Environment] Linking skill from: ${this.absoluteSkillPath}`);
    
    // Link the target skill and auto-confirm the prompt
    const child = spawnSync('gemini', ['skills', 'link', this.absoluteSkillPath], {
      input: 'Y\n',
      stdio: ['pipe', 'inherit', 'inherit'],
      encoding: 'utf-8'
    });

    if (child.status !== 0) {
      const errorMsg = `Failed to link skill: gemini process exited with code ${child.status}`;
      Logger.error(errorMsg);
      throw new ExecutionError(errorMsg);
    }

    Logger.info(`[Environment] Skill linked successfully.\n`);
  }

  public async teardown(): Promise<void> {
    const skillName = path.basename(this.absoluteSkillPath);
    Logger.info(`\n[Environment] Tearing down skill link for '${skillName}'...`);
    
    const child = spawnSync('gemini', ['skills', 'uninstall', skillName], {
      stdio: 'inherit',
      encoding: 'utf-8'
    });

    if (child.status !== 0) {
      Logger.warn(`Failed to uninstall skill during teardown (it might already be uninstalled). Status code: ${child.status}`);
    } else {
      Logger.info(`[Environment] Teardown complete.\n`);
    }
  }
}
