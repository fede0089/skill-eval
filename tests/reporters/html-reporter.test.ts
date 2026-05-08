import { test } from 'node:test';
import * as assert from 'node:assert';
import { generateHtml } from '../../src/reporters/html-reporter.js';
import type { EvalSuiteReport } from '../../src/types/index.js';

function makeTriggerReport(overrides: Partial<EvalSuiteReport> = {}): EvalSuiteReport {
  return {
    timestamp: '2026-01-01T00:00:00.000Z',
    skill_name: 'test-skill',
    agent: 'gemini-cli',
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

function makeFunctionalReport(): EvalSuiteReport {
  return {
    timestamp: '2026-01-01T00:00:00.000Z',
    skill_name: 'func-skill',
    agent: 'gemini-cli',
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
    agent: 'gemini-cli',
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

test('generateHtml formats passAtK 0.667 as 67%', () => {
  const report = makeTriggerReport();
  const html = generateHtml(report);
  assert.ok(html.includes('67%'), 'pass@1 should be formatted as 67%');
});

test('generateHtml renders one row per expectation with per-variant pass-rate cells', () => {
  const report = makeTriggerReport({
    results: [{
      taskId: 1,
      prompt: 'Do something',
      baselineTrials: [],
      skillTrials: {
        'local': [
          {
            id: 1,
            transcript: {},
            assertionResults: [
              { assertion: 'First check', passed: true, reason: 'ok' },
              { assertion: 'Second check', passed: false, reason: 'missing' },
            ],
            trialPassed: false,
          },
          {
            id: 2,
            transcript: {},
            assertionResults: [
              { assertion: 'First check', passed: true, reason: 'ok' },
              { assertion: 'Second check', passed: true, reason: 'ok' },
            ],
            trialPassed: true,
          },
        ]
      },
    }],
  });
  const html = generateHtml(report);
  assert.ok(html.includes('First check'), 'expectation text should appear as row label');
  assert.ok(html.includes('Second check'), 'expectation text should appear as row label');
  assert.ok(html.includes('class="pass-cell green"'), 'fully passing expectation should get green pass-cell');
  assert.ok(html.includes('class="pass-cell amber"'), 'partially passing expectation should get amber pass-cell');
  assert.ok(html.includes('2 / 2'), 'fully passing expectation should show 2 / 2');
  assert.ok(html.includes('1 / 2'), 'partially passing expectation should show 1 / 2');
});

test('generateHtml renders red 0% cell when no trials pass an expectation', () => {
  const report = makeTriggerReport({
    results: [{
      taskId: 1,
      prompt: 'Do something',
      baselineTrials: [],
      skillTrials: {
        'local': [{
          id: 1,
          transcript: {},
          assertionResults: [
            { assertion: 'First check', passed: false, reason: 'missing' },
          ],
          trialPassed: false,
        }]
      },
    }],
  });
  const html = generateHtml(report);
  assert.ok(html.includes('class="pass-cell red"'), 'failing expectation should get red pass-cell');
  assert.ok(html.includes('0 / 1'), 'cell should show 0 / 1');
});

test('generateHtml escapes HTML special characters in prompt', () => {
  const report = makeTriggerReport({
    results: [{
      taskId: 1,
      prompt: '<script>alert("xss")</script>',
      baselineTrials: [],
      skillTrials: {
        'local': [{ id: 1, transcript: {}, assertionResults: [], trialPassed: false }]
      },
    }],
  });
  const html = generateHtml(report);
  assert.ok(!html.includes('<script>alert'), 'raw script tag should not appear unescaped');
  assert.ok(html.includes('&lt;script&gt;'), 'prompt should be HTML-escaped');
});
