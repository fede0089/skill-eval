export interface Eval {
  id: string;
  prompt: string;
  expected_output?: string;
  expectations?: unknown[];
  files?: string[];
}

export interface EvalFile {
  skill_name: string;
  evals: Eval[];
}

export interface ToolMetrics {
  count?: number;
  totalCalls?: number;
  totalSuccess?: number;
  totalFail?: number;
  durationMs?: number;
  [key: string]: unknown;
}

export interface AgentOutputTools {
  totalCalls: number;
  totalSuccess: number;
  totalFail: number;
  totalDurationMs: number;
  byName: Record<string, ToolMetrics>;
}

export interface AgentOutput {
  session_id?: string;
  response?: string;
  stats?: {
    tools?: AgentOutputTools;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}
