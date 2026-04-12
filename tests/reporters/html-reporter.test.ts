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
      withSkillScore: '67%',
      passedCount: 2,
      totalCount: 3,
      numTrials: 3,
      passAtK: 0.667,
      passAtN: 1.0,
    },
    results: [
      {
        taskId: 1,
        prompt: 'Do something useful',
        score: 1.0,
        trials: [
          { id: 1, transcript: {}, assertionResults: [{ assertion: 'Did it work?', passed: true, reason: 'Yes', graderType: 'model-based' }], trialPassed: true },
          { id: 2, transcript: {}, assertionResults: [{ assertion: 'Did it work?', passed: true, reason: 'Yes', graderType: 'model-based' }], trialPassed: true },
        ],
      },
      {
        taskId: 2,
        prompt: 'Do something else',
        score: 0.0,
        trials: [
          { id: 1, transcript: {}, assertionResults: [{ assertion: 'Check output', passed: false, reason: 'Missing field' }], trialPassed: false },
        ],
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
      withSkillScore: '80%',
      withoutSkillScore: '60%',
      skillUplift: '+20%',
      passedCount: 4,
      totalCount: 5,
      numTrials: 2,
      passAtK: 0.8,
      passAtN: 0.9,
      withoutSkillPassAtK: 0.6,
      withoutSkillPassAtN: 0.7,
    },
    results: [
      {
        taskId: 1,
        prompt: 'Functional prompt',
        score: 1.0,
        trials: [
          { id: 1, transcript: {}, assertionResults: [{ assertion: 'With Skill assertion', passed: true, reason: 'Passed' }], trialPassed: true },
        ],
        withoutSkillTrials: [
          { id: 1, transcript: {}, assertionResults: [{ assertion: 'Without Skill assertion', passed: false, reason: 'Not triggered' }], trialPassed: false },
        ],
      },
    ],
  };
}

test('generateHtml produces valid HTML for a trigger report', () => {
  const report = makeTriggerReport();
  const html = generateHtml(report);

  assert.ok(html.includes('<!DOCTYPE html>'), 'should start with DOCTYPE');
  assert.ok(html.includes('<html'), 'should contain html tag');
  assert.ok(html.includes('chart.js'), 'should include Chart.js CDN');
  assert.ok(html.includes('test-skill'), 'should contain skill name');
  assert.ok(html.includes('Do something useful'), 'should contain task prompt');
  assert.ok(html.includes('Trigger'), 'should indicate Trigger eval type');
  assert.ok(html.includes('gemini-cli'), 'should contain agent name');
});

test('generateHtml produces functional report with baseline and uplift data', () => {
  const report = makeFunctionalReport();
  const html = generateHtml(report);

  assert.ok(html.includes('Functional'), 'should indicate Functional eval type');
  assert.ok(html.includes('Without Skill'), 'should contain Without Skill label');
  assert.ok(html.includes('With Skill'), 'should contain With Skill label');
  assert.ok(html.includes('+20%'), 'should contain skill uplift value');
  assert.ok(html.includes('Functional prompt'), 'should contain task prompt');
  assert.ok(html.includes('Without Skill assertion'), 'should contain without-skill assertion text');
  assert.ok(html.includes('With Skill assertion'), 'should contain with-skill assertion text');
});

test('generateHtml handles empty results without throwing', () => {
  const report = makeTriggerReport({ results: [], metrics: { withSkillScore: '0%', passedCount: 0, totalCount: 0 } });
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

test('generateHtml escapes HTML special characters in prompt', () => {
  const report = makeTriggerReport({
    results: [{
      taskId: 1,
      prompt: '<script>alert("xss")</script>',
      score: 0,
      trials: [{ id: 1, transcript: {}, assertionResults: [], trialPassed: false }],
    }],
  });
  const html = generateHtml(report);
  assert.ok(!html.includes('<script>alert'), 'raw script tag should not appear unescaped');
  assert.ok(html.includes('&lt;script&gt;'), 'prompt should be HTML-escaped');
});
