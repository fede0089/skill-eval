import { EvalTrial } from '../types/index.js';

/**
 * A signal that a trial may not be a legitimate attempt at the task —
 * the agent degenerated, stopped early, or burned resources without producing
 * anything. These are advisory only: excluding a trial is always a human call,
 * because no threshold can reliably tell "the skill failed" from
 * "the model went off the rails this time".
 */
export type AnomalyTag =
  | 'degenerate-output'
  | 'zero-assertions'
  | 'premature-stop'
  | 'resource-outlier';

export interface Anomaly {
  tag: AnomalyTag;
  /** Reviewer-facing explanation, always stating the trial's value against its cohort. */
  reason: string;
}

/** Fraction of the cohort's median output length below which text reads as degenerate. */
const DEGENERATE_OUTPUT_RATIO = 0.15;

/** Multiple of the cohort's median token spend above which a trial is an outlier. */
const RESOURCE_OUTLIER_RATIO = 2.5;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function passedAssertions(trial: EvalTrial): number {
  return trial.assertionResults.filter(r => r.passed).length;
}

/**
 * Flags a trial against its cohort — the sibling trials of the same eval and
 * variant. Comparisons are relative to the cohort median rather than absolute
 * thresholds, so the signals hold whether an eval has 3 assertions or 30 and
 * whether a task normally takes 20K tokens or 2M.
 *
 * Infrastructure errors return no anomalies: they are already excluded from
 * every metric, and flagging them again would only pad the review queue.
 *
 * @param trial  The trial to inspect.
 * @param cohort All trials of the same eval and variant, including `trial`.
 */
export function detectAnomalies(trial: EvalTrial, cohort: EvalTrial[]): Anomaly[] {
  if (trial.isError || !trial.summary) return [];

  // Errored siblings produced no output; letting them into the baseline would
  // drag the median down and mask the degenerate trials this exists to catch.
  const peers = cohort.filter(t => !t.isError && t.summary);
  const anomalies: Anomaly[] = [];

  const medianOutputLen = median(peers.map(t => t.summary!.outputLen));
  if (medianOutputLen > 0 && trial.summary.outputLen < medianOutputLen * DEGENERATE_OUTPUT_RATIO) {
    anomalies.push({
      tag: 'degenerate-output',
      reason: `Final output is ${trial.summary.outputLen} characters; the cohort median is ${Math.round(medianOutputLen)}.`,
    });
  }

  const medianPassed = median(peers.map(passedAssertions));
  if (trial.assertionResults.length > 0 && passedAssertions(trial) === 0 && medianPassed > 0) {
    anomalies.push({
      tag: 'zero-assertions',
      reason: `Passed 0 of ${trial.assertionResults.length} assertions; the cohort median is ${medianPassed}.`,
    });
  }

  if (trial.summary.outputLen === 0 || trial.summary.stopStatus !== 'success') {
    anomalies.push({
      tag: 'premature-stop',
      reason: `Run ended with status "${trial.summary.stopStatus ?? 'unknown'}" and ${trial.summary.outputLen} characters of output.`,
    });
  }

  const medianTokens = median(
    peers.filter(t => t.tokenStats).map(t => t.tokenStats!.totalTokens)
  );
  if (trial.tokenStats && medianTokens > 0 &&
      trial.tokenStats.totalTokens > medianTokens * RESOURCE_OUTLIER_RATIO) {
    anomalies.push({
      tag: 'resource-outlier',
      reason: `Spent ${trial.tokenStats.totalTokens.toLocaleString('en-US')} tokens against a cohort median of ${Math.round(medianTokens).toLocaleString('en-US')}.`,
    });
  }

  return anomalies;
}
