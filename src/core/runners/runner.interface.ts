import { AgentOutput } from '../../types';

export interface AgentRunner {
  runPrompt(prompt: string): AgentOutput | null;
}
