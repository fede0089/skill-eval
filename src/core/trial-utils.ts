import { EvalTrial } from '../types/index.js';

/**
 * Pads the trials array up to targetCount when a trial loop aborts early.
 * Ensures that pass@k calculations always reflect the full requested trial count.
 *
 * @param trials     Trials collected so far (may be shorter than targetCount).
 * @param targetCount The requested number of trials (numTrials).
 * @param assertionLabel The assertion label to use for the padded entries (e.g. 'Runner Execution').
 */
export function padAbortedTrials(
  trials: EvalTrial[],
  targetCount: number,
  assertionLabel: string
): EvalTrial[] {
  while (trials.length < targetCount) {
    trials.push({
      id: trials.length + 1,
      transcript: { error: 'Trial not executed (previous trial aborted)' },
      assertionResults: [{
        assertion: assertionLabel,
        passed: false,
        reason: 'Trial not executed (previous trial aborted)',
        graderType: 'programmatic'
      }],
      trialPassed: false
    });
  }
  return trials;
}
