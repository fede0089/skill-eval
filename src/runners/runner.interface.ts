import { AgentOutput } from '../types/index.js';

export interface AgentRunner {
  /** Name of the tool the agent uses to dispatch skills (e.g. 'activate_skill' for Gemini CLI). */
  readonly skillDispatchToolName: string;

  runPrompt(
    prompt: string,
    cwd?: string,
    onLog?: (log: string) => void,
    logPath?: string,
    extraArgs?: string[]
  ): Promise<AgentOutput | null>;

  /**
   * Links the skill into the worktree so the agent can discover and invoke it.
   * Each runner implements this according to its own skill resolution mechanism.
   */
  linkSkill(absoluteSkillPath: string, worktreePath: string): Promise<void>;

  /**
   * Disables the named skill in the given working directory so baseline runs
   * cannot invoke it. Each runner implements this using its own CLI mechanism.
   */
  disableSkill(skillName: string, worktreePath: string): Promise<void>;
}
