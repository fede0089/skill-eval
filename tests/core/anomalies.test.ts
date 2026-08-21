import { test } from 'node:test';
import assert from 'node:assert';
import { detectAnomalies } from '../../src/core/anomalies.js';
import type { EvalTrial } from '../../src/types/index.js';

/** Builds a trial whose assertion results pass `passed` out of `total`. */
function makeTrial(opts: {
  id: number;
  outputLen: number;
  passed: number;
  total?: number;
  tokens?: number;
  stopStatus?: string;
  isError?: boolean;
  noSummary?: boolean;
}): EvalTrial {
  const total = opts.total ?? 25;
  return {
    id: opts.id,
    transcript: {},
    assertionResults: Array.from({ length: total }, (_, i) => ({
      assertion: `a${i}`,
      passed: i < opts.passed,
      reason: '',
    })),
    trialPassed: opts.passed === total,
    isError: opts.isError,
    tokenStats: opts.tokens
      ? { totalTokens: opts.tokens, inputTokens: 0, outputTokens: 0, cachedTokens: 0 }
      : undefined,
    summary: opts.noSummary ? undefined : {
      output: 'x'.repeat(Math.min(opts.outputLen, 100)),
      outputLen: opts.outputLen,
      toolCalls: 5,
      stopStatus: opts.stopStatus ?? 'success',
      logFile: `trial_${opts.id}.log`,
    },
  };
}

function tags(trial: EvalTrial, cohort: EvalTrial[]): string[] {
  return detectAnomalies(trial, cohort).map(a => a.tag);
}

/**
 * The real cohort from run 2026-08-21T20-22-14-802Z, variant `local`:
 * trials 1 and 3 degenerated ("Rituclease" and "."), trials 2, 4 and 5 answered.
 */
function realLocalCohort(): EvalTrial[] {
  return [
    makeTrial({ id: 1, outputLen: 10,   passed: 0,  tokens: 231041 }),
    makeTrial({ id: 2, outputLen: 1899, passed: 8,  tokens: 519868 }),
    makeTrial({ id: 3, outputLen: 1,    passed: 0,  tokens: 229582 }),
    makeTrial({ id: 4, outputLen: 5043, passed: 19, tokens: 1025853 }),
    makeTrial({ id: 5, outputLen: 2193, passed: 18, tokens: 710657 }),
  ];
}

test('flags exactly the degenerate trials of a real cohort', () => {
  const cohort = realLocalCohort();
  const flagged = cohort.filter(t => detectAnomalies(t, cohort).length > 0).map(t => t.id);

  assert.deepStrictEqual(flagged, [1, 3], 'trials 1 and 3 produced "Rituclease" and "."');
});

test('a degenerate trial reports both the short output and the zero score', () => {
  const cohort = realLocalCohort();

  assert.deepStrictEqual(tags(cohort[0], cohort), ['degenerate-output', 'zero-assertions']);
});

test('anomaly reasons quote the trial value and the cohort median', () => {
  const cohort = realLocalCohort();
  const [short, zero] = detectAnomalies(cohort[0], cohort);

  assert.match(short.reason, /10 characters/);
  assert.match(short.reason, /median is 1899/);
  assert.match(zero.reason, /0 of 25 assertions/);
  assert.match(zero.reason, /median is 8/);
});

test('a legitimate low-scoring trial is not flagged', () => {
  const cohort = realLocalCohort();

  // Trial 2 passed only 8 of 25 — a bad result, but a real attempt.
  assert.deepStrictEqual(tags(cohort[1], cohort), []);
});

test('does not flag a resource outlier that stays within the cohort spread', () => {
  const cohort = realLocalCohort();

  // Trial 4 is the biggest spender at 1.0M against a 520K median — under the 2.5x bar.
  assert.deepStrictEqual(tags(cohort[3], cohort), []);
});

test('flags a genuine resource outlier', () => {
  const cohort = [
    makeTrial({ id: 1, outputLen: 2000, passed: 10, tokens: 100_000 }),
    makeTrial({ id: 2, outputLen: 2100, passed: 11, tokens: 110_000 }),
    makeTrial({ id: 3, outputLen: 2050, passed: 12, tokens: 900_000 }),
  ];

  assert.deepStrictEqual(tags(cohort[2], cohort), ['resource-outlier']);
});

test('flags a non-success stop status as a premature stop', () => {
  const cohort = [
    makeTrial({ id: 1, outputLen: 2000, passed: 10 }),
    makeTrial({ id: 2, outputLen: 2100, passed: 11 }),
    makeTrial({ id: 3, outputLen: 1900, passed: 9, stopStatus: 'error' }),
  ];

  assert.deepStrictEqual(tags(cohort[2], cohort), ['premature-stop']);
});

test('a homogeneous cohort produces no anomalies', () => {
  const cohort = [
    makeTrial({ id: 1, outputLen: 2000, passed: 10, tokens: 100_000 }),
    makeTrial({ id: 2, outputLen: 2100, passed: 11, tokens: 105_000 }),
    makeTrial({ id: 3, outputLen: 1950, passed: 9,  tokens: 98_000 }),
  ];

  cohort.forEach(t => assert.deepStrictEqual(tags(t, cohort), [], `trial ${t.id}`));
});

test('a cohort where every trial degenerated flags none of them', () => {
  // With no healthy peer the median collapses, and there is no baseline to
  // stand out from. The uniformly terrible scores are the finding instead.
  const cohort = [
    makeTrial({ id: 1, outputLen: 5, passed: 0 }),
    makeTrial({ id: 2, outputLen: 3, passed: 0 }),
    makeTrial({ id: 3, outputLen: 8, passed: 0 }),
  ];

  cohort.forEach(t => assert.deepStrictEqual(tags(t, cohort), [], `trial ${t.id}`));
});

test('a cohort of one flags nothing', () => {
  const only = makeTrial({ id: 1, outputLen: 12, passed: 0 });

  assert.deepStrictEqual(tags(only, [only]), []);
});

test('infrastructure errors are never flagged', () => {
  const cohort = [
    makeTrial({ id: 1, outputLen: 2000, passed: 10 }),
    makeTrial({ id: 2, outputLen: 2100, passed: 11 }),
    makeTrial({ id: 3, outputLen: 0, passed: 0, isError: true, stopStatus: undefined }),
  ];

  assert.deepStrictEqual(tags(cohort[2], cohort), [], 'already excluded from every metric');
});

test('errored siblings do not drag the cohort median down', () => {
  const cohort = [
    makeTrial({ id: 1, outputLen: 2000, passed: 10 }),
    makeTrial({ id: 2, outputLen: 2100, passed: 11 }),
    makeTrial({ id: 3, outputLen: 0, passed: 0, isError: true }),
    makeTrial({ id: 4, outputLen: 0, passed: 0, isError: true }),
    makeTrial({ id: 5, outputLen: 12, passed: 0 }),
  ];

  // With the two errored trials in the baseline the median would be 0 and
  // trial 5 would slip through unflagged.
  assert.deepStrictEqual(tags(cohort[4], cohort), ['degenerate-output', 'zero-assertions']);
});

test('a trial without a summary is not flagged', () => {
  const cohort = [
    makeTrial({ id: 1, outputLen: 2000, passed: 10 }),
    makeTrial({ id: 2, outputLen: 12, passed: 0, noSummary: true }),
  ];

  assert.deepStrictEqual(tags(cohort[1], cohort), []);
});

test('an eval with no assertions never reports zero-assertions', () => {
  const cohort = [
    makeTrial({ id: 1, outputLen: 2000, passed: 0, total: 0 }),
    makeTrial({ id: 2, outputLen: 2100, passed: 0, total: 0 }),
  ];

  cohort.forEach(t => assert.ok(!tags(t, cohort).includes('zero-assertions'), `trial ${t.id}`));
});
