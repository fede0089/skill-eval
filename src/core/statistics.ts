import { AggregatedTokenStats, EvalTrial, TaskResult } from '../types/index.js';

/**
 * Computes the pass rate (pass@1) for a set of trials.
 * Returns the fraction of trials that passed: c / n.
 */
export function computePassAtK(trials: EvalTrial[], _k = 1): number {
  const n = trials.length;
  if (n === 0) return 0;
  return trials.filter(t => t.trialPassed).length / n;
}

/**
 * Aggregates pass@1 across all task results.
 * Returns the average pass rate over all tasks.
 *
 * @param results       Array of task results to aggregate.
 * @param _numTrials    Unused — kept for call-site compatibility.
 * @param trialSelector Function that extracts the trial array from a TaskResult.
 */
export function aggregatePassAtK(
  results: TaskResult[],
  _numTrials: number,
  trialSelector: (r: TaskResult) => EvalTrial[]
): { passAtK: number } {
  if (results.length === 0) return { passAtK: 0 };
  return {
    passAtK: results.reduce((sum, r) => sum + computePassAtK(trialSelector(r)), 0) / results.length
  };
}

/**
 * Computes average token consumption across trials that have token stats.
 * Trials without tokenStats are excluded from the average.
 * Returns null if no trial has token stats.
 */
export function aggregateTokenStats(trials: EvalTrial[]): AggregatedTokenStats | null {
  const withStats = trials.filter(t => t.tokenStats);
  if (withStats.length === 0) return null;
  const n = withStats.length;
  return {
    avgTotal:  Math.round(withStats.reduce((s, t) => s + t.tokenStats!.total_tokens,  0) / n),
    avgInput:  Math.round(withStats.reduce((s, t) => s + t.tokenStats!.input_tokens,  0) / n),
    avgOutput: Math.round(withStats.reduce((s, t) => s + t.tokenStats!.output_tokens, 0) / n),
    avgCached: Math.round(withStats.reduce((s, t) => s + t.tokenStats!.cached_tokens, 0) / n),
    trialCount: n,
  };
}
