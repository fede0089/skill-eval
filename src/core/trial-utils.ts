import { EvalTrial } from '../types/index.js';

/**
 * Returns true when a trial represents an infrastructure failure (timeout, blocked
 * interactive prompt, runner crash, etc.) rather than a legitimate judge verdict.
 * Infrastructure-error trials are candidates for retry via withRetry().
 */
export function isTrialError(trial: EvalTrial): boolean {
  return trial.isError === true;
}

/**
 * Runs fn(), retrying up to maxRetries additional times with exponential backoff
 * whenever the result is an infrastructure-error trial (isTrialError returns true).
 * A successful judge verdict (pass OR fail) stops retrying immediately.
 *
 * Delays: attempt 1 → baseDelayMs, attempt 2 → baseDelayMs * 2
 */
export async function withRetry(
  fn: () => Promise<EvalTrial>,
  maxRetries = 2,
  baseDelayMs = 1000
): Promise<EvalTrial> {
  let last: EvalTrial | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await new Promise(resolve => setTimeout(resolve, baseDelayMs * Math.pow(2, attempt - 1)));
    }
    last = await fn();
    if (!isTrialError(last)) return last;
  }
  return last!;
}

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
      trialPassed: false,
      isError: true
    });
  }
  return trials;
}
