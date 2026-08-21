import { AggregatedTokenStats, AggregatedDurationStats, EvalTrial, TaskResult } from '../types/index.js';
import { isCounted } from './trial-utils.js';

/**
 * Computes the fraction of individual assertions that passed across all counted trials.
 * Returns 0 if there are no counted trials or no assertions.
 */
export function computeAssertionPassRate(trials: EvalTrial[]): number {
  const relevant = trials.filter(isCounted);
  if (relevant.length === 0) return 0;
  const total = relevant.reduce((s, t) => s + t.assertionResults.length, 0);
  if (total === 0) return 0;
  const passed = relevant.reduce((s, t) => s + t.assertionResults.filter(r => r.passed).length, 0);
  return passed / total;
}

/**
 * Averages computeAssertionPassRate across all task results.
 */
export function aggregateAssertionPassRate(
  results: TaskResult[],
  trialSelector: (r: TaskResult) => EvalTrial[]
): number {
  if (results.length === 0) return 0;
  return results.reduce((sum, r) => sum + computeAssertionPassRate(trialSelector(r)), 0) / results.length;
}

/**
 * Computes the pass rate (pass@1) for a set of trials: c / n over counted trials.
 * Infrastructure errors leave the denominator rather than counting as failures,
 * matching computeAssertionPassRate — see isCounted().
 * Returns 0 when no trial counted.
 */
export function computePassAtK(trials: EvalTrial[], _k = 1): number {
  const relevant = trials.filter(isCounted);
  if (relevant.length === 0) return 0;
  return relevant.filter(t => t.trialPassed).length / relevant.length;
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
 * Computes average duration across trials that have durationMs set.
 * Returns null if no trial has duration data.
 */
export function aggregateDurationStats(trials: EvalTrial[]): AggregatedDurationStats | null {
  const withDuration = trials.filter(t => t.durationMs != null);
  if (withDuration.length === 0) return null;
  const n = withDuration.length;
  return {
    avgMs: Math.round(withDuration.reduce((s, t) => s + t.durationMs!, 0) / n),
    trialCount: n,
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
    avgTotal:  Math.round(withStats.reduce((s, t) => s + t.tokenStats!.totalTokens,  0) / n),
    avgInput:  Math.round(withStats.reduce((s, t) => s + t.tokenStats!.inputTokens,  0) / n),
    avgOutput: Math.round(withStats.reduce((s, t) => s + t.tokenStats!.outputTokens, 0) / n),
    avgCached: Math.round(withStats.reduce((s, t) => s + t.tokenStats!.cachedTokens, 0) / n),
    trialCount: n,
  };
}
