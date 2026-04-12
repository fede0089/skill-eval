import { EvalTrial, TaskResult } from '../types/index.js';

function combinations(n: number, r: number): number {
  if (r > n || r < 0) return 0;
  if (r === 0 || r === n) return 1;
  let result = 1;
  for (let i = 0; i < r; i++) {
    result = (result * (n - i)) / (i + 1);
  }
  return result;
}

/**
 * Computes the pass@k metric for a set of trials.
 * Answers: "What is the probability that at least one of k randomly sampled trials passes?"
 * Formula: pass@k = 1 - C(n-c, k) / C(n, k)
 * where n = total trials, c = correct (passing) trials, k = sample size.
 */
export function computePassAtK(trials: EvalTrial[], k: number): number {
  const n = trials.length;
  if (n === 0 || k > n) return 0;
  const c = trials.filter(t => t.trialPassed).length;
  const failing = n - c;
  return 1 - combinations(failing, k) / combinations(n, k);
}

/**
 * Aggregates pass@1 and pass@numTrials across all task results.
 * Returns the average probability over all tasks for both metrics.
 *
 * @param results       Array of task results to aggregate.
 * @param numTrials     The number of trials used per task (pass@n sample size).
 * @param trialSelector Function that extracts the trial array from a TaskResult.
 */
export function aggregatePassAtK(
  results: TaskResult[],
  numTrials: number,
  trialSelector: (r: TaskResult) => EvalTrial[]
): { passAtK: number; passAtN: number } {
  if (results.length === 0) return { passAtK: 0, passAtN: 0 };
  return {
    passAtK: results.reduce((sum, r) => sum + computePassAtK(trialSelector(r), 1), 0) / results.length,
    passAtN: results.reduce((sum, r) => sum + computePassAtK(trialSelector(r), numTrials), 0) / results.length
  };
}
