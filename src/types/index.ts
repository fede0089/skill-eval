export type GraderType = 'programmatic' | 'model-based';

export interface EvalTask {
  id: number;
  prompt: string;
  expected_output?: string;
  assertions?: string[];
  files?: string[];
  /** Whether the skill is expected to activate for this prompt. Defaults to true. */
  should_trigger?: boolean;
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

/**
 * Compact, always-persisted record of what the agent actually produced.
 * The full transcript is megabytes of NDJSON and is dropped before reporting;
 * this survives into the report so a reviewer can see the evidence a trial
 * rests on without opening the log.
 */
export interface TrialSummary {
  /** Final assistant text, truncated to MAX_SUMMARY_OUTPUT characters. */
  output: string;
  /** Length of the untruncated text, so the report can say how much was cut. */
  outputLen: number;
  toolCalls: number;
  /** Status carried by the agent's result event ('success', 'error', ...). */
  stopStatus?: string;
  /** Log filename, relative to the run directory, holding the full transcript. */
  logFile: string;
}

export interface EvalTrial {
  id: number;
  transcript: AgentTranscript;
  assertionResults: AssertionResult[];
  trialPassed: boolean;
  isError?: boolean;
  tokenStats?: TrialTokenStats;
  durationMs?: number;
  summary?: TrialSummary;
}

/**
 * Aggregated results for a Task across one or more trials.
 */
export interface TaskResult {
  taskId: number;
  prompt: string;
  baselineTrials: EvalTrial[];
  skillTrials: Record<string, EvalTrial[]>;
  /** Expected trigger polarity for this eval (trigger runs only). Absent = positive. */
  shouldTrigger?: boolean;
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
 * The evals a run was measured with. Every variant shares one frozen set, so this
 * is the record of what produced the numbers — and of what a later comparison has
 * to reuse for those numbers to mean anything.
 */
export interface ReportFrozenEvals {
  /** The skill's evals directory the frozen copy was taken from. */
  source: string;
  /** Where the frozen copy lives, relative to the run directory. */
  frozen: string;
  /** Eval files the frozen copy holds. */
  evalFiles: string[];
}

export interface EvalSuiteReport {
  timestamp: string;
  command?: 'trigger' | 'functional';
  skill_name: string;
  /** Agent that ran the evaluated task. */
  executorAgent: string;
  /** Agent that graded it. Absent when nothing graded — trigger grades programmatically. */
  judgeAgent?: string;
  /** Frozen evals every variant was measured with. Absent when nothing was frozen. */
  frozenEvals?: ReportFrozenEvals;
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

/**
 * One expectation an author or an optimizer declared their change should
 * improve. A proposal is accepted only when the evidence corroborates every
 * one of them, so the pair (eval, expectation text) has to name an expectation
 * the frozen evals actually hold.
 */
export interface PredictedExpectation {
  evalId: number;
  expectation: string;
}

/**
 * Why a candidate was accepted or rejected.
 * - `not-better`      the aggregate effectiveness did not improve; equal is not better.
 * - `unattributable`  the aggregate improved but a declared expectation did not.
 * - `total-regression` an expectation the incumbent passed in all its trials fails in all the candidate's.
 */
export type ProposalVerdict = 'accepted' | 'not-better' | 'unattributable' | 'total-regression';

/** How one declared expectation fared between the two variants. */
export interface ExpectationOutcome {
  prediction: PredictedExpectation;
  candidateRate: number;
  incumbentRate: number;
  improved: boolean;
}

export interface ProposalDecision {
  verdict: ProposalVerdict;
  /** Effectiveness of both variants, unrounded: equal is not better. */
  candidateEffectiveness: number;
  incumbentEffectiveness: number;
  /** One entry per declared expectation, in the order it was declared. */
  predictionsMet: ExpectationOutcome[];
  /** Expectations the incumbent passed in every trial and the candidate fails in every one. */
  collapsed: PredictedExpectation[];
}

/** Where a proposal came from. The uncommitted working tree is a full proposal. */
export type ProposalOrigin = 'working-tree' | 'optimizer';

/**
 * What the session did with one proposal. It is shown in the terminal and does
 * not persist anywhere: the durable evolution history arrives with its own spec.
 */
export interface ProposalRecord {
  /** 1-based, in the order the session ran them. */
  number: number;
  total: number;
  origin: ProposalOrigin;
  /** The single hypothesis behind the change. Absent for the working tree. */
  hypothesis?: string;
  predictions: PredictedExpectation[];
  /** Absent when the attempt was invalid and never reached a comparison. */
  decision?: ProposalDecision;
  /** Why the attempt was invalid, when it was. */
  invalidReason?: string;
  /** Commit an accepted proposal produced. */
  sha?: string;
  /** Run directory that measured it. */
  runDir?: string;
}

export interface SessionBalance {
  proposals: number;
  accepted: number;
  rejected: number;
  invalid: number;
  initialSha: string;
  finalSha: string;
  /**
   * End-to-end effectiveness, measured fresh between the session's initial and
   * final versions. Absent when nothing was accepted, since there is nothing to
   * compare.
   */
  endToEnd?: { initial: number; final: number };
}

/** The single hypothesis an optimizer proposes, with what it says the change should improve. */
export interface OptimizerProposal {
  hypothesis: string;
  predictions: PredictedExpectation[];
}

/**
 * Why an attempt never reached a comparison. Every one of them is treated the
 * same: what fell outside the scope is reverted, the candidate is not measured,
 * the reason is reported, and the proposal is consumed all the same.
 */
export type InvalidReason =
  | 'no-declaration'
  | 'unparsable-declaration'
  | 'unknown-expectation'
  | 'out-of-scope'
  | 'timeout'
  | 'agent-error'
  | 'no-change';
