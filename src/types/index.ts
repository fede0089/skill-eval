export interface Eval {
  id: string;
  prompt: string;
  expected_output?: string;
  expectations?: string[];
  files?: string[];
}

export interface ExpectationResult {
  expectation: string;
  passed: boolean;
  reason: string;
}

export interface FunctionalEvalResult extends EvalSummaryResult {
  expectationsResults: ExpectationResult[];
  allExpectationsPassed: boolean;
  judgeReasoning?: string;
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

export interface ModelMetrics {
  api: {
    totalRequests: number;
    totalErrors: number;
    totalLatencyMs: number;
  };
  tokens: {
    input: number;
    prompt: number;
    candidates: number;
    total: number;
    cached: number;
    thoughts: number;
    tool: number;
  };
  [key: string]: unknown;
}

export interface AgentOutput {
  session_id: string;
  response?: string;
  stats?: {
    tools?: AgentOutputTools;
    models?: Record<string, ModelMetrics>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface EvalSummaryResult {
  id: string;
  prompt: string;
  triggered: boolean;
  latencyMs: number;
  tokens: number;
  response: string;
}

export interface EvalSummaryReport {
  timestamp: string;
  skill_name: string;
  agent: string;
  metrics: {
    avgLatencyMs: number;
    totalTokens: number;
    passRate: string;
    triggeredCount: number;
    totalCount: number;
  };
  results: EvalSummaryResult[];
}

