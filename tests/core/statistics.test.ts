import { test } from 'node:test';
import assert from 'node:assert';
import { computePassAtK, aggregatePassAtK, aggregateTokenStats } from '../../src/core/statistics.js';
import { EvalTrial, TaskResult, TrialTokenStats } from '../../src/types/index.js';

function makeTrial(passed: boolean, id = 1, tokenStats?: TrialTokenStats): EvalTrial {
  return { id, transcript: {}, assertionResults: [], trialPassed: passed, tokenStats };
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
  return { total_tokens: total, input_tokens: input, output_tokens: output, cached_tokens: cached };
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
