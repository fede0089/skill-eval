import { AgentOutput } from '../../types';

export interface RunPromptOptions {
  interactive?: boolean;
}

export interface AgentRunner {
  runPrompt(
    prompt: string, 
    cwd?: string, 
    onLog?: (log: string) => void,
    options?: RunPromptOptions
  ): Promise<AgentOutput | null>;
}
