import { test } from 'node:test';
import * as assert from 'node:assert';
import vm from 'node:vm';
import { aggregateAssertionPassRate } from '../../src/core/statistics.js';
import { generateHtml, buildRunData } from '../../src/reporters/html-reporter.js';
import type { EvalSuiteReport } from '../../src/types/index.js';

function makeTriggerReport(overrides: Partial<EvalSuiteReport> = {}): EvalSuiteReport {
  return {
    timestamp: '2026-01-01T00:00:00.000Z',
    command: 'trigger',
    skill_name: 'test-skill',
    executorAgent: 'gemini-cli',
    metrics: {
      passedCount: 2,
      totalCount: 3,
      numTrials: 3,
      scores: { 'local': '67%' },
      passAtK: { 'local': 0.667 },
      assertionPassRate: { 'local': 0.667 },
    },
    results: [
      {
        taskId: 1,
        prompt: 'Do something useful',
        baselineTrials: [],
        skillTrials: {
          'local': [
            { id: 1, transcript: {}, assertionResults: [{ assertion: 'Did it work?', passed: true, reason: 'Yes', graderType: 'model-based' }], trialPassed: true },
            { id: 2, transcript: {}, assertionResults: [{ assertion: 'Did it work?', passed: true, reason: 'Yes', graderType: 'model-based' }], trialPassed: true },
          ],
        }
      },
      {
        taskId: 2,
        prompt: 'Do something else',
        baselineTrials: [],
        skillTrials: {
          'local': [
            { id: 1, transcript: {}, assertionResults: [{ assertion: 'Check output', passed: false, reason: 'Missing field' }], trialPassed: false },
          ],
        }
      },
    ],
    ...overrides,
  };
}

function makeFunctionalReport(overrides: Partial<EvalSuiteReport> = {}): EvalSuiteReport {
  return {
    timestamp: '2026-01-01T00:00:00.000Z',
    command: 'functional',
    skill_name: 'func-skill',
    executorAgent: 'gemini-cli',
    metrics: {
      passedCount: 4,
      totalCount: 5,
      numTrials: 2,
      scores: { 'baseline': '60%', 'local': '80%' },
      passAtK: { 'baseline': 0.6, 'local': 0.8 },
      assertionPassRate: { 'baseline': 0.6, 'local': 0.8 },
    },
    results: [
      {
        taskId: 1,
        prompt: 'Functional prompt',
        baselineTrials: [
          { id: 1, transcript: {}, assertionResults: [{ assertion: 'Shared expectation', passed: false, reason: 'Not triggered' }], trialPassed: false },
        ],
        skillTrials: {
          'local': [
            { id: 1, transcript: {}, assertionResults: [{ assertion: 'Shared expectation', passed: true, reason: 'Passed' }], trialPassed: true },
          ],
        }
      },
    ],
    ...overrides,
  };
}

function makeSkillOnlyFunctionalReport(): EvalSuiteReport {
  return {
    timestamp: '2026-01-01T00:00:00.000Z',
    command: 'functional',
    skill_name: 'func-skill',
    executorAgent: 'gemini-cli',
    metrics: {
      passedCount: 2,
      totalCount: 3,
      numTrials: 1,
      scores: { 'local': '67%' },
      passAtK: { 'local': 0.667 },
      assertionPassRate: { 'local': 0.667 },
    },
    results: [
      {
        taskId: 1,
        prompt: 'Skill only prompt',
        baselineTrials: [],
        skillTrials: {
          'local': [
            { id: 1, transcript: {}, assertionResults: [{ assertion: 'Shared expectation', passed: true, reason: 'Passed' }], trialPassed: true },
          ],
        }
      },
    ],
  };
}


test('generateHtml produces valid HTML for a trigger report', () => {
  const report = makeTriggerReport();
  const html = generateHtml(report);

  assert.ok(html.includes('<!DOCTYPE html>'), 'should start with DOCTYPE');
  assert.ok(html.includes('<html'), 'should contain html tag');
  assert.ok(html.includes('test-skill'), 'should contain skill name');
  assert.ok(html.includes('Do something useful'), 'should contain task prompt');
  assert.ok(html.includes('Trigger'), 'should indicate Trigger eval type');
  assert.ok(html.includes('gemini-cli'), 'should contain agent name');
});

test('generateHtml produces functional report with baseline and local data', () => {
  const report = makeFunctionalReport();
  const html = generateHtml(report);

  assert.ok(html.includes('Functional'), 'should indicate Functional eval type');
  assert.ok(html.includes('baseline'), 'should contain baseline label');
  assert.ok(html.includes('local'), 'should contain local label');
  assert.ok(html.includes('Functional prompt'), 'should contain task prompt');
  assert.ok(html.includes('Shared expectation'), 'should contain shared expectation text');
  assert.ok(html.includes('Not triggered'), 'should contain baseline judge reason in drill-down');
  assert.ok(html.includes('Passed'), 'should contain local judge reason in drill-down');
});


test('generateHtml handles empty results without throwing', () => {
  const report = makeTriggerReport({ 
    results: [], 
    metrics: { 
      passedCount: 0, 
      totalCount: 0,
      scores: { 'local': '0%' },
      passAtK: { 'local': 0 },
      assertionPassRate: { 'local': 0 }
    } 
  });
  assert.doesNotThrow(() => generateHtml(report));
  const html = generateHtml(report);
  assert.ok(html.includes('<!DOCTYPE html>'));
});

test('generateHtml renders failing assertion text and judge reason in functional drill-down', () => {
  const report: EvalSuiteReport = {
    timestamp: '2026-01-01T00:00:00.000Z',
    skill_name: 'func-skill',
    executorAgent: 'gemini-cli',
    metrics: {
      passedCount: 0,
      totalCount: 1,
      numTrials: 1,
      scores: { 'baseline': '0%', 'local': '0%' },
      passAtK: { 'baseline': 0, 'local': 0 },
      assertionPassRate: { 'baseline': 0, 'local': 0 },
    },
    results: [{
      taskId: 1,
      prompt: 'A prompt',
      baselineTrials: [
        { id: 1, transcript: {}, assertionResults: [{ assertion: 'Check output', passed: false, reason: 'Missing field' }], trialPassed: false },
      ],
      skillTrials: {
        'local': [
          { id: 1, transcript: {}, assertionResults: [{ assertion: 'Check output', passed: false, reason: 'Missing field' }], trialPassed: false },
        ],
      }
    }],
  };
  const html = generateHtml(report);
  assert.ok(html.includes('Check output'), 'failing assertion text should appear as row label');
  assert.ok(html.includes('Missing field'), 'judge reason should appear in the drill-down');
  assert.ok(html.includes('exp-detail-row'), 'drill-down rows should be rendered for functional evals');
});





// ── Embedded run data ───────────────────────────────────────────────────────

function makeReportWith(trials: any[], overrides: Partial<EvalSuiteReport> = {}): EvalSuiteReport {
  return {
    timestamp: '2026-01-01T00:00:00.000Z',
    command: 'functional',
    skill_name: 'test-skill',
    executorAgent: 'gemini-cli',
    metrics: { totalCount: 1, numTrials: trials.length, scores: {}, passAtK: {}, assertionPassRate: {} },
    results: [{ taskId: 1, prompt: 'Do something', baselineTrials: [], skillTrials: { local: trials } }],
    ...overrides,
  };
}

function makeTrial(id: number, passed: boolean[], extra: any = {}): any {
  return {
    id,
    transcript: {},
    assertionResults: passed.map((p, i) => ({ assertion: `check ${i + 1}`, passed: p, reason: p ? 'ok' : 'missing' })),
    trialPassed: passed.every(Boolean),
    summary: { output: 'a plan', outputLen: 6, toolCalls: 4, stopStatus: 'success', logFile: `t${id}.log` },
    ...extra,
  };
}

test('buildRunData carries each trial verbatim, with its summary and log pointer', () => {
  const data = buildRunData(makeReportWith([makeTrial(1, [true, false])]));
  const trial = data.tasks[0].variants.local[0];

  assert.deepStrictEqual(data.tasks[0].assertions, ['check 1', 'check 2']);
  assert.deepStrictEqual(trial.results, [1, 0]);
  assert.deepStrictEqual(trial.reasons, ['ok', 'missing']);
  assert.strictEqual(trial.output, 'a plan');
  assert.strictEqual(trial.toolCalls, 4);
  assert.strictEqual(trial.logFile, 't1.log');
});

test('buildRunData derives a runId matching the run directory name', () => {
  const data = buildRunData(makeReportWith([makeTrial(1, [true])]));

  assert.strictEqual(data.runId, '2026-01-01T00-00-00-000Z');
});

test('buildRunData embeds anomalies computed against the trial cohort', () => {
  const data = buildRunData(makeReportWith([
    makeTrial(1, [true, true], { summary: { output: 'a'.repeat(2000), outputLen: 2000, toolCalls: 4, stopStatus: 'success', logFile: 't1.log' } }),
    makeTrial(2, [true, true], { summary: { output: 'a'.repeat(2100), outputLen: 2100, toolCalls: 4, stopStatus: 'success', logFile: 't2.log' } }),
    makeTrial(3, [false, false], { summary: { output: '.', outputLen: 1, toolCalls: 9, stopStatus: 'success', logFile: 't3.log' } }),
  ]));
  const trials = data.tasks[0].variants.local;

  assert.deepStrictEqual(trials[0].anomalies, []);
  assert.deepStrictEqual(trials[2].anomalies.map(a => a.tag), ['degenerate-output', 'zero-assertions']);
});

test('buildRunData omits the baseline column when no baseline ran', () => {
  const data = buildRunData(makeReportWith([makeTrial(1, [true])]));

  assert.deepStrictEqual(Object.keys(data.tasks[0].variants), ['local']);
});

test('generateHtml neutralises markup so nothing can close the data script tag', () => {
  const evil = '</script><script>alert(1)</script>';
  const html = generateHtml(makeReportWith(
    [makeTrial(1, [false], {
      summary: { output: evil, outputLen: evil.length, toolCalls: 1, stopStatus: 'success', logFile: 't.log' },
    })],
    {
      results: [{
        taskId: 1,
        prompt: evil,
        baselineTrials: [],
        skillTrials: {
          local: [makeTrial(1, [false], {
            summary: { output: evil, outputLen: evil.length, toolCalls: 1, stopStatus: 'success', logFile: 't.log' },
          })],
        },
      }],
    },
  ));

  const blob = html.match(/<script id="run-data" type="application\/json">([\s\S]*?)<\/script>/)![1];

  // Escaping "<" is enough: no tag can start, so no tag can close this one.
  assert.ok(!blob.includes('<'), 'no raw angle bracket may survive inside the data blob');
  assert.ok(blob.includes('\\u003c/script>'), 'markup is escaped as \\u003c and decoded back by JSON.parse');
});

// ── The page's own arithmetic ───────────────────────────────────────────────
//
// The report computes every figure client-side, so its aggregation is a second
// implementation of statistics.ts. These tests execute the embedded script and
// hold the two to the same numbers, which is what keeps them from drifting.

/**
 * Runs the report's script against a minimal DOM and returns the HTML it painted,
 * keyed by element id. `storage` seeds localStorage, standing in for a reviewer
 * who has already excluded trials.
 */
function renderReport(html: string, storage: Record<string, string> = {}): Record<string, string> {
  const script = html.match(/<script>\n([\s\S]*?)\n<\/script>\n<\/body>/)![1];
  const runData = html.match(/<script id="run-data" type="application\/json">([\s\S]*?)<\/script>/)![1];

  const painted: Record<string, string> = {};
  const makeEl = (id: string) => ({
    id,
    set innerHTML(v: string) { painted[id] = v; },
    get innerHTML() { return painted[id] ?? ''; },
    set textContent(v: string) { painted[id] = v; },
    get textContent() { return id === 'run-data' ? runData : (painted[id] ?? ''); },
    classList: { add() {}, remove() {}, toggle: () => false, contains: () => false },
    className: '',
    addEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    getAttribute: () => null,
    setAttribute() {},
    value: '',
  });

  const context: any = {
    document: { getElementById: makeEl, querySelectorAll: () => [], createElement: makeEl, body: makeEl('body') },
    localStorage: {
      getItem: (k: string) => storage[k] ?? null,
      setItem: (k: string, v: string) => { storage[k] = v; },
    },
    setTimeout: () => 0,
    clearTimeout: () => {},
    JSON, Math, Object, Array, String, Number, Date, RegExp, isNaN, parseInt, parseFloat,
  };
  vm.createContext(context);
  vm.runInContext(script, context);
  return painted;
}

/** Percentages in the order the metrics table renders them, one per variant. */
function renderedRates(painted: Record<string, string>): string[] {
  const row = painted['metrics-grid'].match(/<tr><td>Success Rate<\/td>([\s\S]*?)<\/tr>/)![1];
  return [...row.matchAll(/class="metric-val [a-z]+">(\d+%)</g)].map(m => m[1]);
}

function parityReport(): EvalSuiteReport {
  const local = [
    makeTrial(1, [true, true, true]),
    makeTrial(2, [true, false, false]),
    makeTrial(3, [false, false, false]),
  ];
  const baseline = [
    makeTrial(1, [true, false, false]),
    makeTrial(2, [false, false, false]),
    makeTrial(3, [false, false, false]),
  ];
  return {
    timestamp: '2026-01-01T00:00:00.000Z',
    command: 'functional',
    skill_name: 'test-skill',
    executorAgent: 'gemini-cli',
    metrics: { totalCount: 1, numTrials: 3, scores: {}, passAtK: {}, assertionPassRate: {} },
    results: [{ taskId: 1, prompt: 'Do something', baselineTrials: baseline, skillTrials: { local } }],
  };
}

test('the report renders the same rates statistics.ts computes', () => {
  const report = parityReport();
  const painted = renderReport(generateHtml(report));

  const expectedLocal = aggregateAssertionPassRate(report.results, r => r.skillTrials.local);
  const expectedBaseline = aggregateAssertionPassRate(report.results, r => r.baselineTrials);

  assert.deepStrictEqual(renderedRates(painted), [
    `${Math.round(expectedBaseline * 100)}%`,
    `${Math.round(expectedLocal * 100)}%`,
  ]);
});

test('the report leaves errored trials out of the denominator, like statistics.ts', () => {
  const report = parityReport();
  report.results[0].skillTrials.local.push(
    { id: 4, transcript: {}, assertionResults: [], trialPassed: false, isError: true } as any
  );

  const painted = renderReport(generateHtml(report));
  const expected = aggregateAssertionPassRate(report.results, r => r.skillTrials.local);

  assert.strictEqual(renderedRates(painted)[1], `${Math.round(expected * 100)}%`);
});

test('excluding trials recomputes the rate and keeps the raw figure visible', () => {
  const report = parityReport();
  const runId = '2026-01-01T00-00-00-000Z';
  const storage = {
    [`skill-eval:excl:${runId}`]: JSON.stringify({ '1:local:3': { reason: 'degenerate-output' } }),
  };

  const painted = renderReport(generateHtml(report), storage);

  // Dropping the all-failing trial leaves 4 of 6 assertions passing.
  assert.strictEqual(renderedRates(painted)[1], '67%');
  assert.ok(painted['metrics-grid'].includes('raw <s>44%</s>'), 'the unadjusted rate stays on screen');
  assert.ok(painted['metrics-grid'].includes('n=2/3'), 'the effective sample size is disclosed');
});

test('excluding trials asymmetrically raises a warning', () => {
  const report = parityReport();
  const storage = {
    'skill-eval:excl:2026-01-01T00-00-00-000Z': JSON.stringify({ '1:local:3': { reason: 'degenerate-output' } }),
  };

  const painted = renderReport(generateHtml(report), storage);

  assert.match(painted['excl-headline'], /1 of 6 trials excluded/);
  assert.match(painted['excl-warn'], /not balanced across variants/);
});

test('a balanced exclusion raises no warning', () => {
  const report = parityReport();
  const storage = {
    'skill-eval:excl:2026-01-01T00-00-00-000Z': JSON.stringify({
      '1:local:3': { reason: 'degenerate-output' },
      '1:baseline:3': { reason: 'degenerate-output' },
    }),
  };

  const painted = renderReport(generateHtml(report), storage);

  assert.strictEqual(painted['excl-warn'], '');
});

test('the trials table lists every trial with its anomalies and controls', () => {
  const painted = renderReport(generateHtml(parityReport()));
  const details = painted['details-1'];

  assert.ok(details.includes('>Trials <'), 'the Trials subsection is labelled');
  assert.ok(details.includes('>Expectations <'), 'the Expectations subsection is labelled');
  assert.strictEqual((details.match(/class="trial-row/g) ?? []).length, 6, 'one row per trial per variant');
  assert.strictEqual((details.match(/data-act="exclude"/g) ?? []).length, 6, 'every trial can be excluded');
  assert.ok(!details.includes('trial-detail'), 'trial detail rows stay collapsed until asked for');
});

test('buildRunData carries the agent of each role, and invents no judge when none graded', () => {
  const judged = buildRunData(makeFunctionalReport({ executorAgent: 'gemini-cli', judgeAgent: 'claude-code' }));
  assert.strictEqual(judged.executorAgent, 'gemini-cli');
  assert.strictEqual(judged.judgeAgent, 'claude-code');

  // A trigger run is graded programmatically: the role stays empty rather than
  // repeating the executor, which would claim an agent judged it.
  const unjudged = buildRunData(makeTriggerReport());
  assert.strictEqual(unjudged.executorAgent, 'gemini-cli');
  assert.strictEqual(unjudged.judgeAgent, undefined);
});
