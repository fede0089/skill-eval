import { execSync } from 'child_process';
import * as path from 'path';

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
    console.log(`\n[Environment] Linking skill from: ${this.absoluteSkillPath}`);
    try {
      // Link the target skill and auto-confirm the prompt
      execSync(`echo "Y" | gemini skills link "${this.absoluteSkillPath}"`, { stdio: 'inherit' });
      console.log(`[Environment] Skill linked successfully.\n`);
    } catch (error) {
      console.error(`[Error] Failed to link skill: ${error}`);
      throw error;
    }
  }

  public async teardown(): Promise<void> {
    const skillName = path.basename(this.absoluteSkillPath);
    console.log(`\n[Environment] Tearing down skill link for '${skillName}'...`);
    try {
      execSync(`gemini skills uninstall ${skillName}`, { stdio: 'inherit' });
      console.log(`[Environment] Teardown complete.\n`);
    } catch (error) {
      console.error(`\n[Warning] Failed to uninstall skill during teardown (it might already be uninstalled): ${error}`);
    }
  }
}
