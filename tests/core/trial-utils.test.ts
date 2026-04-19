import { test } from 'node:test';
import assert from 'node:assert';
import { isTrialError, withRetry, padAbortedTrials } from '../../src/core/trial-utils.js';
import type { EvalTrial } from '../../src/types/index.js';

function makeTrial(overrides: Partial<EvalTrial> = {}): EvalTrial {
  return {
    id: 1,
    transcript: {},
    assertionResults: [],
    trialPassed: false,
    ...overrides
  };
}

// ── isTrialError ─────────────────────────────────────────────────────────────

test('isTrialError returns true when isError is true', () => {
  assert.strictEqual(isTrialError(makeTrial({ isError: true })), true);
});

test('isTrialError returns false when isError is false', () => {
  assert.strictEqual(isTrialError(makeTrial({ isError: false })), false);
});

test('isTrialError returns false when isError is undefined', () => {
  assert.strictEqual(isTrialError(makeTrial()), false);
});

test('isTrialError returns false for a passing trial with no isError', () => {
  assert.strictEqual(isTrialError(makeTrial({ trialPassed: true })), false);
});

// ── withRetry ────────────────────────────────────────────────────────────────

test('withRetry returns result immediately when first attempt succeeds', async () => {
  let callCount = 0;
  const fn = async () => {
    callCount++;
    return makeTrial({ trialPassed: true });
  };
  const result = await withRetry(fn, 2, 0);
  assert.strictEqual(callCount, 1, 'fn should be called exactly once');
  assert.strictEqual(result.trialPassed, true);
});

test('withRetry returns result immediately when first attempt is a genuine fail (not error)', async () => {
  let callCount = 0;
  const fn = async () => {
    callCount++;
    return makeTrial({ trialPassed: false, isError: false });
  };
  const result = await withRetry(fn, 2, 0);
  assert.strictEqual(callCount, 1, 'A judge-decided fail should not be retried');
  assert.strictEqual(result.trialPassed, false);
  assert.ok(!result.isError);
});

test('withRetry retries once when first attempt is an error trial, succeeds on second', async () => {
  let callCount = 0;
  const fn = async () => {
    callCount++;
    if (callCount === 1) return makeTrial({ isError: true });
    return makeTrial({ trialPassed: true });
  };
  const result = await withRetry(fn, 2, 0);
  assert.strictEqual(callCount, 2);
  assert.strictEqual(result.trialPassed, true);
  assert.ok(!result.isError);
});

test('withRetry exhausts all retries and returns last error trial', async () => {
  let callCount = 0;
  const fn = async () => {
    callCount++;
    return makeTrial({ isError: true, id: callCount });
  };
  const result = await withRetry(fn, 2, 0);
  assert.strictEqual(callCount, 3, 'Should attempt 1 original + 2 retries');
  assert.ok(result.isError, 'Final result should still be an error trial');
  assert.strictEqual(result.id, 3, 'Should return the last attempt');
});

test('withRetry stops retrying as soon as a non-error result is returned', async () => {
  let callCount = 0;
  const fn = async () => {
    callCount++;
    if (callCount < 2) return makeTrial({ isError: true });
    return makeTrial({ trialPassed: false }); // judge said FAIL, not error
  };
  const result = await withRetry(fn, 2, 0);
  assert.strictEqual(callCount, 2);
  assert.ok(!result.isError);
  assert.strictEqual(result.trialPassed, false);
});

test('withRetry calls onRetry before each retry with next attempt number and last trial', async () => {
  const retryLog: Array<{ attempt: number; trialId: number }> = [];
  let callCount = 0;
  const fn = async () => {
    callCount++;
    return makeTrial({ isError: true, id: callCount });
  };
  await withRetry(fn, 2, 0, (attempt, lastTrial) => {
    retryLog.push({ attempt, trialId: lastTrial.id });
  });
  assert.deepStrictEqual(retryLog, [
    { attempt: 1, trialId: 1 },
    { attempt: 2, trialId: 2 }
  ], 'onRetry should be called twice, with attempt 1 and 2, carrying the last failed trial');
});

test('withRetry does not call onRetry on the last exhausted attempt', async () => {
  let retryCalls = 0;
  await withRetry(async () => makeTrial({ isError: true }), 2, 0, () => { retryCalls++; });
  assert.strictEqual(retryCalls, 2, 'onRetry fires before attempt 1 and 2, but not after the last failure');
});

// ── padAbortedTrials ─────────────────────────────────────────────────────────

test('padAbortedTrials pads up to targetCount with isError:true trials', () => {
  const trials = [makeTrial({ id: 1, trialPassed: true })];
  const result = padAbortedTrials(trials, 3, 'Runner Execution');
  assert.strictEqual(result.length, 3);
  assert.ok(result[1].isError, 'Padded trial should have isError:true');
  assert.ok(result[2].isError, 'Padded trial should have isError:true');
});

test('padAbortedTrials does not pad when already at targetCount', () => {
  const trials = [makeTrial({ id: 1 }), makeTrial({ id: 2 })];
  const result = padAbortedTrials(trials, 2, 'Runner Execution');
  assert.strictEqual(result.length, 2);
});
