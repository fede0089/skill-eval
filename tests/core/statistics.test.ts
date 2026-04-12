import { test } from 'node:test';
import assert from 'node:assert';
import { computePassAtK, aggregatePassAtK } from '../../src/core/statistics.js';
import { EvalTrial, TaskResult } from '../../src/types/index.js';

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

function makeTaskResult(passed: boolean[]): TaskResult {
  return {
    taskId: 1,
    prompt: 'test',
    score: passed.filter(Boolean).length / passed.length,
    trials: passed.map((p, i) => makeTrial(p, i + 1))
  };
}

test('aggregatePassAtK: empty results → 0', () => {
  const { passAtK, passAtN } = aggregatePassAtK([], 3, r => r.trials);
  assert.strictEqual(passAtK, 0);
  assert.strictEqual(passAtN, 0);
});

test('aggregatePassAtK: all tasks pass → passAtK = 1', () => {
  const results = [makeTaskResult([true, true, true]), makeTaskResult([true, true, true])];
  const { passAtK } = aggregatePassAtK(results, 3, r => r.trials);
  assert.strictEqual(passAtK, 1);
});

test('aggregatePassAtK: averages passAtK across tasks', () => {
  // Task 1: all 3 pass → passAtK=1, Task 2: all 3 fail → passAtK=0 → avg = 0.5
  const results = [makeTaskResult([true, true, true]), makeTaskResult([false, false, false])];
  const { passAtK } = aggregatePassAtK(results, 3, r => r.trials);
  assert.ok(Math.abs(passAtK - 0.5) < 1e-9, `Expected 0.5, got ${passAtK}`);
});

test('aggregatePassAtK: uses trialSelector to choose trial set', () => {
  const withSkillTrials = [makeTrial(true), makeTrial(true), makeTrial(true)];
  const withoutSkillTrials = [makeTrial(false), makeTrial(false), makeTrial(false)];
  const results: TaskResult[] = [{
    taskId: 1, prompt: 'test', score: 1,
    trials: withSkillTrials,
    withoutSkillTrials
  }];

  const { passAtK: withSkillK } = aggregatePassAtK(results, 3, r => r.trials);
  const { passAtK: withoutSkillK } = aggregatePassAtK(results, 3, r => r.withoutSkillTrials ?? []);

  assert.strictEqual(withSkillK, 1);
  assert.strictEqual(withoutSkillK, 0);
});
