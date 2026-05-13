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
 * isError=true means infrastructure failed (timeout, blocked prompt, runner crash, etc.)
 * and the trial never reached a judge verdict. These trials are candidates for retry.
 */
export interface TrialTokenStats {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

export interface AggregatedTokenStats {
  avgTotal: number;
  avgInput: number;
  avgOutput: number;
  avgCached: number;
  trialCount: number;
}

export interface AggregatedDurationStats {
  avgMs: number;
  trialCount: number;
}

export interface EvalTrial {
  id: number;
  transcript: AgentTranscript;
  assertionResults: AssertionResult[];
  trialPassed: boolean;
  isError?: boolean;
  tokenStats?: TrialTokenStats;
  durationMs?: number;
}

/**
 * Aggregated results for a Task across one or more trials.
 */
export interface TaskResult {
  taskId: number;
  prompt: string;
  baselineTrials: EvalTrial[];
  skillTrials: Record<string, EvalTrial[]>;
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

export interface EvalSuiteReport {
  timestamp: string;
  command?: 'trigger' | 'functional';
  skill_name: string;
  agent: string;
  metrics: {
    passedCount?: number;
    totalCount: number;
    numTrials?: number; // Number of trials per task
    // Version-specific metrics
    scores: Record<string, string>; // e.g., { "local": "85%", "ref:main": "80%" }
    passAtK: Record<string, number>; // e.g., { "local": 0.85, "baseline": 0.1 }
    assertionPassRate: Record<string, number>;
    tokenStats?: Record<string, AggregatedTokenStats>;
    durationStats?: Record<string, AggregatedDurationStats>;
    [key: string]: any;
  };
  results: TaskResult[];
}

/**
 * Typed representations of Gemini CLI stream-json events.
 * parseNdjsonEvents returns NdjsonEvent[]; callers narrow with event.type checks.
 */
export interface NdjsonToolUseEvent {
  type: 'tool_use';
  tool_id: string;
  tool_name: string;
  parameters?: { name?: string; [key: string]: unknown };
}

export interface NdjsonToolResultEvent {
  type: 'tool_result';
  tool_id: string;
  status: string;
}

export interface NdjsonMessageEvent {
  type: 'message';
  role?: string;
  content?: string;
  /** Present in stream-json mode (Gemini CLI). true = fragment of ongoing output. */
  delta?: boolean;
}

export interface NdjsonResultEvent {
  type: 'result';
  status: string;
  response?: string;
  error?: { message?: string };
  stats?: {
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    cached?: number;
    [key: string]: unknown;
  };
}

export type NdjsonEvent =
  | NdjsonToolUseEvent
  | NdjsonToolResultEvent
  | NdjsonMessageEvent
  | NdjsonResultEvent;

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
