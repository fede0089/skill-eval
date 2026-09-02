import { test } from 'node:test';
import * as assert from 'node:assert';
import {
  decide,
  effectiveness,
  isInconclusive,
  parseDeclaredPrediction,
  resolvePredictions
} from '../../src/core/evolution.js';
import { EvalSuite, EvalSuiteReport, EvalTrial } from '../../src/types/index.js';

const CANDIDATE = 'local';
const INCUMBENT = 'ref:HEAD';

/** A graded trial: one entry per expectation, with the verdict the judge gave. */
function trial(id: number, results: Record<string, boolean>): EvalTrial {
  const assertionResults = Object.entries(results).map(([assertion, passed]) => ({
    assertion,
    passed,
    reason: passed ? 'met' : 'not met'
  }));
  return {
    id,
    transcript: {},
    assertionResults,
    trialPassed: assertionResults.every(r => r.passed)
  };
}

/** A trial that never reached a verdict: infrastructure failed. */
function erroredTrial(id: number): EvalTrial {
  return {
    id,
    transcript: { error: 'timeout' },
    assertionResults: [{ assertion: 'Execution', passed: false, reason: 'timeout' }],
    trialPassed: false,
    isError: true
  };
}

function report(tasks: Array<{ taskId: number; variants: Record<string, EvalTrial[]> }>): EvalSuiteReport {
  return {
    timestamp: '2026-09-02T00:00:00.000Z',
    command: 'functional',
    skill_name: 'evolving-skill',
    executorAgent: 'gemini-cli',
    metrics: { totalCount: tasks.length, scores: {}, passAtK: {}, assertionPassRate: {} },
    results: tasks.map(t => ({ taskId: t.taskId, prompt: 'do the thing', baselineTrials: [], skillTrials: t.variants }))
  };
}

const SUITE: EvalSuite = {
  skill_name: 'evolving-skill',
  tasks: [{ id: 1, prompt: 'do the thing', assertions: ['A holds', 'B holds', 'C holds'] }]
};

test('a candidate that improves the aggregate and corroborates its prediction is accepted', () => {
  const measured = report([{
    taskId: 1,
    variants: {
      [INCUMBENT]: [trial(1, { 'A holds': true, 'B holds': false }), trial(2, { 'A holds': true, 'B holds': false })],
      [CANDIDATE]: [trial(1, { 'A holds': true, 'B holds': true }), trial(2, { 'A holds': true, 'B holds': false })]
    }
  }]);

  const decision = decide({
    report: measured,
    candidate: CANDIDATE,
    incumbent: INCUMBENT,
    predictions: [{ evalId: 1, expectation: 'B holds' }]
  });

  assert.strictEqual(decision.verdict, 'accepted');
  assert.strictEqual(decision.incumbentEffectiveness, 0.5);
  assert.strictEqual(decision.candidateEffectiveness, 0.75);
  assert.deepStrictEqual(decision.predictionsMet.map(o => o.improved), [true]);
  assert.deepStrictEqual(decision.collapsed, []);
});

test('equal effectiveness is not an improvement', () => {
  const trials = () => [trial(1, { 'A holds': true, 'B holds': false }), trial(2, { 'A holds': true, 'B holds': false })];
  const measured = report([{ taskId: 1, variants: { [INCUMBENT]: trials(), [CANDIDATE]: trials() } }]);

  const decision = decide({
    report: measured,
    candidate: CANDIDATE,
    incumbent: INCUMBENT,
    predictions: [{ evalId: 1, expectation: 'B holds' }]
  });

  assert.strictEqual(decision.verdict, 'not-better');
  assert.strictEqual(decision.candidateEffectiveness, decision.incumbentEffectiveness);
});

test('an aggregate improvement the prediction does not explain is rejected as unattributable', () => {
  const measured = report([{
    taskId: 1,
    variants: {
      [INCUMBENT]: [trial(1, { 'A holds': true, 'B holds': false }), trial(2, { 'A holds': true, 'B holds': false })],
      [CANDIDATE]: [trial(1, { 'A holds': true, 'B holds': true }), trial(2, { 'A holds': true, 'B holds': false })]
    }
  }]);

  // The aggregate rose on B, but the change was declared to fix A, which never moved.
  const decision = decide({
    report: measured,
    candidate: CANDIDATE,
    incumbent: INCUMBENT,
    predictions: [{ evalId: 1, expectation: 'A holds' }]
  });

  assert.strictEqual(decision.verdict, 'unattributable');
  assert.ok(decision.candidateEffectiveness > decision.incumbentEffectiveness);
  assert.deepStrictEqual(decision.predictionsMet.map(o => o.improved), [false]);
});

test('an expectation the incumbent always passed and the candidate always fails blocks acceptance', () => {
  const measured = report([{
    taskId: 1,
    variants: {
      [INCUMBENT]: [
        trial(1, { 'A holds': true, 'B holds': false, 'C holds': false }),
        trial(2, { 'A holds': true, 'B holds': false, 'C holds': false })
      ],
      [CANDIDATE]: [
        trial(1, { 'A holds': false, 'B holds': true, 'C holds': true }),
        trial(2, { 'A holds': false, 'B holds': true, 'C holds': true })
      ]
    }
  }]);

  const decision = decide({
    report: measured,
    candidate: CANDIDATE,
    incumbent: INCUMBENT,
    predictions: [{ evalId: 1, expectation: 'B holds' }]
  });

  assert.strictEqual(decision.verdict, 'total-regression');
  assert.ok(decision.candidateEffectiveness > decision.incumbentEffectiveness, 'the aggregate did improve');
  assert.deepStrictEqual(decision.predictionsMet.map(o => o.improved), [true], 'and the prediction did hold');
  assert.deepStrictEqual(decision.collapsed, [{ evalId: 1, expectation: 'A holds' }]);
});

test('a partial drop is tolerated', () => {
  const measured = report([{
    taskId: 1,
    variants: {
      [INCUMBENT]: [
        trial(1, { 'A holds': true, 'B holds': false, 'C holds': false }),
        trial(2, { 'A holds': true, 'B holds': false, 'C holds': false })
      ],
      [CANDIDATE]: [
        trial(1, { 'A holds': false, 'B holds': true, 'C holds': true }),
        trial(2, { 'A holds': true, 'B holds': true, 'C holds': true })
      ]
    }
  }]);

  const decision = decide({
    report: measured,
    candidate: CANDIDATE,
    incumbent: INCUMBENT,
    predictions: [{ evalId: 1, expectation: 'B holds' }]
  });

  assert.strictEqual(decision.verdict, 'accepted', 'A dropped in one trial out of two, not in all of them');
  assert.deepStrictEqual(decision.collapsed, []);
});

test('an expectation is measured over every counted trial, including one that never reached it', () => {
  const measured = report([{
    taskId: 1,
    variants: {
      [INCUMBENT]: [trial(1, { 'A holds': true }), trial(2, { 'A holds': true })],
      // The second trial ran and was graded, but the skill never activated, so it
      // carries the programmatic assertion instead of the expectations.
      [CANDIDATE]: [
        trial(1, { 'A holds': true }),
        trial(2, { 'Target pass must invoke the skill': false })
      ]
    }
  }]);

  const decision = decide({
    report: measured,
    candidate: CANDIDATE,
    incumbent: INCUMBENT,
    predictions: [{ evalId: 1, expectation: 'A holds' }]
  });

  assert.strictEqual(decision.predictionsMet[0].incumbentRate, 1);
  assert.strictEqual(decision.predictionsMet[0].candidateRate, 0.5, 'the trial that never got there counts against it');
});

test('effectiveness leaves infrastructure errors out of the denominator', () => {
  const measured = report([{
    taskId: 1,
    variants: { [CANDIDATE]: [trial(1, { 'A holds': true }), erroredTrial(2)] }
  }]);

  assert.strictEqual(effectiveness(measured, CANDIDATE), 1);
});

test('a comparison is inconclusive when a variant is left without a counted trial in an eval', () => {
  const measured = report([
    {
      taskId: 1,
      variants: { [INCUMBENT]: [trial(1, { 'A holds': true })], [CANDIDATE]: [trial(1, { 'A holds': true })] }
    },
    {
      taskId: 2,
      variants: { [INCUMBENT]: [trial(1, { 'A holds': true })], [CANDIDATE]: [erroredTrial(1)] }
    }
  ]);

  assert.strictEqual(isInconclusive(measured, [CANDIDATE, INCUMBENT]), true);
});

test('a comparison with a counted trial per eval and variant is conclusive', () => {
  const measured = report([{
    taskId: 1,
    variants: {
      [INCUMBENT]: [trial(1, { 'A holds': true }), erroredTrial(2)],
      [CANDIDATE]: [trial(1, { 'A holds': true }), trial(2, { 'A holds': false })]
    }
  }]);

  assert.strictEqual(isInconclusive(measured, [CANDIDATE, INCUMBENT]), false);
});

test('a prediction is read by position and resolved against the frozen evals', () => {
  assert.deepStrictEqual(parseDeclaredPrediction('1#3'), { evalId: 1, index: 3 });
  assert.deepStrictEqual(
    resolvePredictions(SUITE, [parseDeclaredPrediction('1#3')]),
    [{ evalId: 1, expectation: 'C holds' }]
  );
  assert.throws(() => parseDeclaredPrediction('eval one'), /is not in the '<evalId>#<n>' form/);
});

test('a prediction that names no existing expectation does not resolve', () => {
  assert.throws(() => resolvePredictions(SUITE, [{ evalId: 7, index: 1 }]), /Eval #7 does not exist/);
  assert.throws(() => resolvePredictions(SUITE, [{ evalId: 1, index: 9 }]), /names none of them/);
  assert.throws(
    () => resolvePredictions(SUITE, [{ evalId: 1, expectation: 'D holds' }]),
    /is not an expectation of eval #1/
  );
  assert.throws(() => resolvePredictions(SUITE, []), /No expectation was declared/);
});
