import { test } from 'node:test';
import assert from 'node:assert';
import { computePassAtK, aggregatePassAtK, aggregateTokenStats, computeAssertionPassRate, aggregateAssertionPassRate } from '../../src/core/statistics.js';
import { AssertionResult, EvalTrial, TaskResult, TrialTokenStats } from '../../src/types/index.js';

function makeTrial(passed: boolean, id = 1, tokenStats?: TrialTokenStats, assertionResults?: AssertionResult[], isError?: boolean): EvalTrial {
  return { id, transcript: {}, assertionResults: assertionResults ?? [], trialPassed: passed, tokenStats, isError };
}

function makeAssertion(passed: boolean): AssertionResult {
  return { assertion: 'test assertion', passed, reason: passed ? 'ok' : 'failed' };
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
  const { passAtK } = aggregatePassAtK([], 3, r => r.trials);
  assert.strictEqual(passAtK, 0);
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

// ---------------------------------------------------------------------------
// aggregateTokenStats
// ---------------------------------------------------------------------------

function makeTokenStats(total: number, input: number, output: number, cached: number): TrialTokenStats {
  return { totalTokens: total, inputTokens: input, outputTokens: output, cachedTokens: cached };
}

test('aggregateTokenStats: empty array → null', () => {
  assert.strictEqual(aggregateTokenStats([]), null);
});

test('aggregateTokenStats: no trials have tokenStats → null', () => {
  const trials = [makeTrial(true), makeTrial(false)];
  assert.strictEqual(aggregateTokenStats(trials), null);
});

test('aggregateTokenStats: all trials have stats → correct averages', () => {
  const trials = [
    makeTrial(true,  1, makeTokenStats(100, 80, 20, 50)),
    makeTrial(false, 2, makeTokenStats(200, 160, 40, 100)),
    makeTrial(true,  3, makeTokenStats(300, 240, 60, 150)),
  ];
  const result = aggregateTokenStats(trials);
  assert.ok(result !== null);
  assert.strictEqual(result.avgTotal,  200);
  assert.strictEqual(result.avgInput,  160);
  assert.strictEqual(result.avgOutput,  40);
  assert.strictEqual(result.avgCached, 100);
  assert.strictEqual(result.trialCount, 3);
});

test('aggregateTokenStats: mixed — only trials with stats contribute to averages', () => {
  const trials = [
    makeTrial(true,  1, makeTokenStats(100, 80, 20, 0)),
    makeTrial(true,  2),                                    // no tokenStats
    makeTrial(false, 3, makeTokenStats(300, 240, 60, 0)),
  ];
  const result = aggregateTokenStats(trials);
  assert.ok(result !== null);
  assert.strictEqual(result.trialCount, 2, 'Only 2 trials had stats');
  assert.strictEqual(result.avgTotal, 200);
  assert.strictEqual(result.avgInput, 160);
});

test('aggregateTokenStats: single trial → returns its values directly', () => {
  const trials = [makeTrial(true, 1, makeTokenStats(1000, 900, 100, 500))];
  const result = aggregateTokenStats(trials);
  assert.ok(result !== null);
  assert.strictEqual(result.avgTotal, 1000);
  assert.strictEqual(result.trialCount, 1);
});

// ---------------------------------------------------------------------------
// computeAssertionPassRate
// ---------------------------------------------------------------------------

test('computeAssertionPassRate: empty array → 0', () => {
  assert.strictEqual(computeAssertionPassRate([]), 0);
});

test('computeAssertionPassRate: all assertions pass → 1', () => {
  const trials = [
    makeTrial(true,  1, undefined, [makeAssertion(true), makeAssertion(true)]),
    makeTrial(false, 2, undefined, [makeAssertion(true)]),
  ];
  assert.strictEqual(computeAssertionPassRate(trials), 1);
});

test('computeAssertionPassRate: no assertions pass → 0', () => {
  const trials = [
    makeTrial(false, 1, undefined, [makeAssertion(false), makeAssertion(false)]),
  ];
  assert.strictEqual(computeAssertionPassRate(trials), 0);
});

test('computeAssertionPassRate: partial — 2 of 3 pass → 0.667', () => {
  const trials = [
    makeTrial(false, 1, undefined, [makeAssertion(true), makeAssertion(true), makeAssertion(false)]),
  ];
  const result = computeAssertionPassRate(trials);
  assert.ok(Math.abs(result - 2 / 3) < 1e-9, `Expected ~0.667, got ${result}`);
});

test('computeAssertionPassRate: error trials are excluded', () => {
  const trials = [
    makeTrial(false, 1, undefined, [makeAssertion(true), makeAssertion(true)]),          // 2/2
    makeTrial(false, 2, undefined, [makeAssertion(false)], true),  // error — excluded
  ];
  // Only trial 1 counts: 2/2 = 1.0
  assert.strictEqual(computeAssertionPassRate(trials), 1);
});

test('computeAssertionPassRate: only error trials → 0', () => {
  const trials = [
    makeTrial(false, 1, undefined, [makeAssertion(false)], true),
  ];
  assert.strictEqual(computeAssertionPassRate(trials), 0);
});

test('computeAssertionPassRate: trials with no assertions → 0', () => {
  const trials = [makeTrial(false, 1, undefined, [])];
  assert.strictEqual(computeAssertionPassRate(trials), 0);
});

// ---------------------------------------------------------------------------
// aggregateAssertionPassRate
// ---------------------------------------------------------------------------

test('aggregateAssertionPassRate: empty results → 0', () => {
  assert.strictEqual(aggregateAssertionPassRate([], r => r.trials), 0);
});

test('aggregateAssertionPassRate: averages across tasks', () => {
  // Task 1: 2/2 assertions pass → 1.0
  // Task 2: 0/2 assertions pass → 0.0
  // Average → 0.5
  const results: TaskResult[] = [
    {
      taskId: 1, prompt: 'a', score: 1,
      trials: [makeTrial(true, 1, undefined, [makeAssertion(true), makeAssertion(true)])]
    },
    {
      taskId: 2, prompt: 'b', score: 0,
      trials: [makeTrial(false, 1, undefined, [makeAssertion(false), makeAssertion(false)])]
    },
  ];
  const result = aggregateAssertionPassRate(results, r => r.trials);
  assert.ok(Math.abs(result - 0.5) < 1e-9, `Expected 0.5, got ${result}`);
});

test('aggregateAssertionPassRate: uses trialSelector to pick trial set', () => {
  const results: TaskResult[] = [{
    taskId: 1, prompt: 'test', score: 0,
    trials: [makeTrial(false, 1, undefined, [makeAssertion(true), makeAssertion(false)])],
    withoutSkillTrials: [makeTrial(false, 1, undefined, [makeAssertion(false), makeAssertion(false)])],
  }];
  const withSkill    = aggregateAssertionPassRate(results, r => r.trials);
  const withoutSkill = aggregateAssertionPassRate(results, r => r.withoutSkillTrials ?? []);
  assert.ok(Math.abs(withSkill - 0.5) < 1e-9, `with-skill: expected 0.5, got ${withSkill}`);
  assert.strictEqual(withoutSkill, 0);
});
