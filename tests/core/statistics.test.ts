import { test } from 'node:test';
import assert from 'node:assert';
import { computePassAtK } from '../../src/core/statistics.js';
import { EvalTrial } from '../../src/types/index.js';

function makeTrial(passed: boolean, id = 1): EvalTrial {
  return { id, transcript: {}, assertionResults: [], trialPassed: passed };
}

test('computePassAtK: all pass → 1', () => {
  const trials = [makeTrial(true), makeTrial(true), makeTrial(true)];
  assert.strictEqual(computePassAtK(trials, 1), 1);
});

test('computePassAtK: all fail → 0', () => {
  const trials = [makeTrial(false), makeTrial(false), makeTrial(false)];
  assert.strictEqual(computePassAtK(trials, 1), 0);
});

test('computePassAtK: 2 pass 1 fail, k=1 ≈ 0.667', () => {
  const trials = [makeTrial(true), makeTrial(true), makeTrial(false)];
  const result = computePassAtK(trials, 1);
  assert.ok(Math.abs(result - 2 / 3) < 1e-9, `Expected ~0.667, got ${result}`);
});

test('computePassAtK: 1 pass 2 fail, k=1 ≈ 0.333', () => {
  const trials = [makeTrial(true), makeTrial(false), makeTrial(false)];
  const result = computePassAtK(trials, 1);
  assert.ok(Math.abs(result - 1 / 3) < 1e-9, `Expected ~0.333, got ${result}`);
});

test('computePassAtK: 2 pass 1 fail, k=2 = 1 - C(1,2)/C(3,2) = 1', () => {
  // C(1,2) = 0 (can't choose 2 from 1), so pass@2 = 1
  const trials = [makeTrial(true), makeTrial(true), makeTrial(false)];
  assert.strictEqual(computePassAtK(trials, 2), 1);
});

test('computePassAtK: k > n → 0', () => {
  const trials = [makeTrial(true), makeTrial(true)];
  assert.strictEqual(computePassAtK(trials, 5), 0);
});

test('computePassAtK: empty trials → 0', () => {
  assert.strictEqual(computePassAtK([], 1), 0);
});
