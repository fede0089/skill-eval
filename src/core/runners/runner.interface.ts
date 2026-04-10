import { AgentTranscript, AgentOutput } from '../../types/index.js';

export interface AgentRunner {
  runPrompt(
    prompt: string, 
    cwd?: string, 
    onLog?: (log: string) => void,
    logPath?: string,
    extraArgs?: string[]
  ): Promise<AgentOutput | null>;
}
