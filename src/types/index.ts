export type GraderType = 'programmatic' | 'model-based';

export interface EvalTask {
  id: number;
  prompt: string;
  expected_output?: string;
  assertions?: string[];
  files?: string[];
}

export interface AssertionResult {
  assertion: string;
  passed: boolean;
  reason: string;
  graderType?: GraderType;
}

/**
 * Record of a single execution of a Task.
 */
export interface EvalTrial {
  id: number;
  transcript: AgentTranscript;
  assertionResults: AssertionResult[];
  trialPassed: boolean;
}

/**
 * Aggregated results for a Task across one or more trials.
 */
export interface TaskResult {
  taskId: number;
  prompt: string;
  score: number; // Trials passed / Total trials (0.0 to 1.0)
  trials: EvalTrial[];
  baselineTrials?: EvalTrial[];
}

export interface EvalSuite {
  skill_name: string;
  tasks: EvalTask[];
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

/**
 * The complete record of an agent trial (outputs, tool calls, stats).
 * Previously known as AgentOutput.
 */
export interface AgentTranscript {
  session_id?: string;
  response?: string;
  error?: string;
  raw_output?: string;
  stats?: {
    tools?: AgentOutputTools;
    models?: Record<string, ModelMetrics>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Final report for an evaluation suite run.
 * Previously known as EvalSummaryReport.
 */
export interface EvalSuiteReport {
  timestamp: string;
  skill_name: string;
  agent: string;
  metrics: {
    targetScore: string; // Aggregate score with skill
    baselineScore?: string; // Aggregate score without skill
    skillUplift?: string;
    passedCount: number;
    totalCount: number;
    numTrials?: number; // Number of trials per task
    passAtK?: number; // Average pass@1 across tasks (probability a single trial passes)
    baselinePassAtK?: number; // Average baseline pass@1 (functional only)
    [key: string]: any;
  };
  results: TaskResult[];
}

// Deprecated interfaces for backwards compatibility during refactor
export type Eval = EvalTask;
export type ExpectationResult = AssertionResult;
export type AgentOutput = AgentTranscript;
export type EvalFile = EvalSuite;
export type EvalSummaryReport = EvalSuiteReport;

export interface EvalSummaryResult {
  id: number;
  prompt: string;
  triggered?: boolean;
  response: string;
  expectationsResults?: ExpectationResult[];
}

export interface FunctionalEvalResult extends EvalSummaryResult {
  expectationsResults: ExpectationResult[];
  allExpectationsPassed: boolean;
  judgeReasoning?: string;
  baselineAllExpectationsPassed?: boolean;
  baselineExpectationsResults?: ExpectationResult[];
}
