import { AgentOutput } from '../../types';

export interface AgentRunner {
  runPrompt(prompt: string, cwd?: string, onLog?: (log: string) => void): Promise<AgentOutput | null>;
}
