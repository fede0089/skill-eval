import { AgentOutput } from '../../types';

export interface AgentRunner {
  runPrompt(prompt: string, cwd?: string): AgentOutput | null;
}
