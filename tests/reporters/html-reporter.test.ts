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
          { id: 1, transcript: {}, assertionResults: [{ assertion: 'Without Skill assertion', passed: false, reason: 'Not triggered' }], trialPassed: false },
        ],
        skillTrials: {
          'local': [
            { id: 1, transcript: {}, assertionResults: [{ assertion: 'With Skill assertion', passed: true, reason: 'Passed' }], trialPassed: true },
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
  assert.ok(html.includes('Without Skill assertion'), 'should contain without-skill assertion text');
  assert.ok(html.includes('With Skill assertion'), 'should contain with-skill assertion text');
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

test('generateHtml renders failing assertion reason in output', () => {
  const report = makeTriggerReport();
  const html = generateHtml(report);
  assert.ok(html.includes('Missing field'), 'failing assertion reason should appear in output');
  assert.ok(html.includes('Check output'), 'failing assertion text should appear');
});

test('generateHtml formats passAtK 0.667 as 67%', () => {
  const report = makeTriggerReport();
  const html = generateHtml(report);
  assert.ok(html.includes('67%'), 'pass@1 should be formatted as 67%');
});

test('generateHtml renders PARTIAL badge for trials where some but not all assertions pass', () => {
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
            { assertion: 'First check', passed: true, reason: 'ok' },
            { assertion: 'Second check', passed: false, reason: 'missing' },
          ],
          trialPassed: false,
        }]
      },
    }],
  });
  const html = generateHtml(report);
  assert.ok(html.includes('PARTIAL 1/2'), 'partial badge should show passed/total counts');
  assert.ok(html.includes('trial-partial'), 'trial-partial CSS class should be applied');
});

test('generateHtml renders NOT PASSED badge when zero assertions pass', () => {
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
  assert.ok(html.includes('NOT PASSED'), 'full fail badge should still appear');
  assert.ok(!html.includes('PARTIAL'), 'partial badge should NOT appear when 0 assertions pass');
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
