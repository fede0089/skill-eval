export interface Eval {
  id: string;
  prompt: string;
  expected_output?: string;
  expectations?: any[];
  files?: string[];
}

export interface EvalFile {
  skill_name: string;
  evals: Eval[];
}

export interface AgentOutputTools {
  totalCalls: number;
  totalSuccess: number;
  totalFail: number;
  totalDurationMs: number;
  byName: Record<string, any>;
}

export interface AgentOutput {
  session_id?: string;
  response?: string;
  stats?: {
    tools?: AgentOutputTools;
    [key: string]: any;
  };
  [key: string]: any;
}
