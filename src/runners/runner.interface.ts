import { AgentOutput } from '../types/index.js';

export interface AgentRunner {
  /** Name of the tool the agent uses to dispatch skills (e.g. 'activate_skill' for Gemini CLI). */
  readonly skillDispatchToolName: string;

  runPrompt(
    prompt: string,
    cwd?: string,
    onLog?: (log: string) => void,
    logPath?: string,
    extraArgs?: string[],
    timeoutMs?: number
  ): Promise<AgentOutput | null>;

  /**
   * Links the skill into the worktree so the agent can discover and invoke it.
   * Each runner implements this according to its own skill resolution mechanism.
   */
  linkSkill(absoluteSkillPath: string, worktreePath: string): Promise<void>;

  /**
   * Copies runner-specific config from the skill's evals/config/ directory
   * into the worktree. Each runner knows its own subdirectory name and target
   * location (e.g. GeminiCliRunner copies 'gemini-cli/' → '.gemini/').
   * No-ops silently if the config directory doesn't exist.
   */
  applyRunnerConfig(evalConfigBaseDir: string, worktreePath: string): void;
}
