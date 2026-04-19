import { EvalTrial, TaskResult } from '../types/index.js';

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
