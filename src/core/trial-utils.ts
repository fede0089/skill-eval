import { EvalTrial, TrialSummary } from '../types/index.js';
import { parseStreamResult, parseStreamStats } from '../utils/ndjson.js';

/**
 * Cap on the agent text carried into the report. The full text always stays in
 * the trial log, which the report links to; this bound keeps a run with dozens
 * of trials from producing a multi-megabyte HTML file.
 */
export const MAX_SUMMARY_OUTPUT = 4000;

/**
 * Builds the compact record the report shows for a trial.
 * `rawStream` is the agent's raw NDJSON stdout; an empty or unparsable stream
 * yields an empty output, which is itself the signal that the agent produced
 * nothing usable.
 */
export function buildTrialSummary(rawStream: string, logFile: string): TrialSummary {
  const parsed = parseStreamResult(rawStream);
  const text = parsed && 'response' in parsed ? parsed.response : '';
  const { toolCalls, status } = parseStreamStats(rawStream);
  return {
    output: text.slice(0, MAX_SUMMARY_OUTPUT),
    outputLen: text.length,
    toolCalls,
    stopStatus: status,
    logFile,
  };
}

/**
 * Returns true when a trial represents an infrastructure failure (timeout, blocked
 * interactive prompt, runner crash, etc.) rather than a legitimate judge verdict.
 * Infrastructure-error trials are candidates for retry via withRetry().
 */
export function isTrialError(trial: EvalTrial): boolean {
  return trial.isError === true;
}

/**
 * Whether a trial contributes to metrics.
 *
 * Infrastructure errors (timeout, blocked interactive prompt, runner crash)
 * never reached a verdict, so they leave the denominator entirely instead of
 * counting as failures: a harness timeout says nothing about the skill. The
 * report shows the effective n alongside every rate so an incomplete run is
 * still visible as one.
 *
 * The report applies the same rule to trials a reviewer excluded. Exclusions
 * are made after the run, against the report, so they are not visible here.
 */
export function isCounted(trial: EvalTrial): boolean {
  return !trial.isError;
}

/**
 * Runs fn(), retrying up to maxRetries additional times with exponential backoff
 * whenever the result is an infrastructure-error trial (isTrialError returns true).
 * A successful judge verdict (pass OR fail) stops retrying immediately.
 *
 * Delays: attempt 1 → baseDelayMs, attempt 2 → baseDelayMs * 2
 *
 * @param onRetry Optional callback fired after an error result, before the next attempt.
 *                Receives the upcoming attempt number (1-based) and the failed trial.
 *                Use it to surface retry progress in the UI.
 */
export async function withRetry(
  fn: (attempt: number) => Promise<EvalTrial>,
  maxRetries = 2,
  baseDelayMs = 1000,
  onRetry?: (attempt: number, lastTrial: EvalTrial) => void
): Promise<EvalTrial> {
  let last: EvalTrial | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await new Promise(resolve => setTimeout(resolve, baseDelayMs * Math.pow(2, attempt - 1)));
    }
    last = await fn(attempt);
    if (!isTrialError(last)) return last;
    if (attempt < maxRetries) onRetry?.(attempt + 1, last);
  }
  return last!;
}

/**
 * Pads the trials array up to targetCount when a trial loop aborts early.
 *
 * The padding records that N trials were requested but never ran, so the report
 * can show "n=2/5" instead of silently presenting a two-trial measurement as if
 * it were the full run. It does not push the rates down: padded entries are
 * infrastructure errors, and isCounted() keeps those out of every denominator.
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
