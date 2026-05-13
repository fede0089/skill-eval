import { test, mock } from 'node:test';
import * as assert from 'node:assert';
import { Logger } from '../../src/utils/logger.js';
import { renderTriggerTable, renderFunctionalTable } from '../../src/utils/table-renderer.js';
import type { EvalSuiteReport } from '../../src/types/index.js';

function makeTrial(passed: boolean, id = 1) {
  return { id, transcript: {}, assertionResults: [], trialPassed: passed };
}

function makeTriggerReport(numTrials = 1, overrides: Partial<EvalSuiteReport> = {}): EvalSuiteReport {
  return {
    timestamp: '2026-01-01T00:00:00.000Z',
    command: 'trigger',
    skill_name: 'test-skill',
    agent: 'gemini-cli',
    metrics: { 
      passedCount: 1, 
      totalCount: 1, 
      numTrials, 
      scores: { 'local': '100%' },
      passAtK: { 'local': 1 },
      assertionPassRate: { 'local': 1 }
    },
    results: [{
      taskId: 1,
      prompt: 'Do something useful',
      baselineTrials: [],
      skillTrials: {
        'local': [makeTrial(true, 1), makeTrial(true, 2), makeTrial(false, 3)].slice(0, numTrials)
      }
    }],
    ...overrides
  };
}

function makeFunctionalReport(numTrials = 1, withBaseline = true): EvalSuiteReport {
  return {
    timestamp: '2026-01-01T00:00:00.000Z',
    command: 'functional',
    skill_name: 'test-skill',
    agent: 'gemini-cli',
    metrics: {
      passedCount: 1, totalCount: 1, numTrials,
      scores: withBaseline ? { 'baseline': '0%', 'local': '100%' } : { 'local': '100%' },
      passAtK: withBaseline ? { 'baseline': 0, 'local': 1 } : { 'local': 1 },
      assertionPassRate: withBaseline ? { 'baseline': 0, 'local': 1 } : { 'local': 1 }
    },
    results: [{
      taskId: 1,
      prompt: 'Generate a license',
      baselineTrials: withBaseline ? [makeTrial(false, 1)] : [],
      skillTrials: {
        'local': [makeTrial(true, 1)]
      }
    }]
  };
}

test('renderTriggerTable: calls Logger.table and Logger.write with rate line (1 trial)', () => {
  const tableMock = mock.fn();
  const writeMock = mock.fn();
  mock.method(Logger, 'table', tableMock);
  mock.method(Logger, 'write', writeMock);

  renderTriggerTable(makeTriggerReport(1));

  assert.strictEqual(tableMock.mock.callCount(), 1, 'Logger.table should be called once');
  const rows: string[][] = tableMock.mock.calls[0].arguments[0];
  assert.deepStrictEqual(rows[0], ['ID', 'Prompt', 'local Rate'], 'Header should have success rate column for 1 trial');
  assert.ok(rows.length > 1, 'Table should have at least one data row');

  const written = writeMock.mock.calls.map(c => c.arguments[0] as string).join('');
  assert.ok(written.includes('local Success Rate'), 'Should include rate line');

  mock.reset();
});

test('renderTriggerTable: uses pass@k columns for multi-trial reports', () => {
  const tableMock = mock.fn();
  mock.method(Logger, 'table', tableMock);
  mock.method(Logger, 'write', mock.fn());

  renderTriggerTable(makeTriggerReport(3));

  const rows: string[][] = tableMock.mock.calls[0].arguments[0];
  assert.deepStrictEqual(rows[0], ['ID', 'Prompt', 'local Trials', 'local Rate'], 'Header should have success rate column');

  mock.reset();
});

test('renderFunctionalTable: calls Logger.table and Logger.write with rate lines (1 trial)', () => {
  const tableMock = mock.fn();
  const writeMock = mock.fn();
  mock.method(Logger, 'table', tableMock);
  mock.method(Logger, 'write', writeMock);

  renderFunctionalTable(makeFunctionalReport(1));

  assert.strictEqual(tableMock.mock.callCount(), 1, 'Logger.table should be called once');
  const rows: string[][] = tableMock.mock.calls[0].arguments[0];
  assert.deepStrictEqual(rows[0], ['ID', 'Prompt', 'baseline', 'local'], 'Header should have skill columns');

  const written = writeMock.mock.calls.map(c => c.arguments[0] as string).join('');
  assert.ok(written.includes('baseline Rate'), 'Should include without-skill rate line');
  assert.ok(written.includes('local Rate'), 'Should include with-skill rate line');

  mock.reset();
});

test('renderFunctionalTable: uses pass@k columns for multi-trial reports', () => {
  const tableMock = mock.fn();
  mock.method(Logger, 'table', tableMock);
  mock.method(Logger, 'write', mock.fn());

  renderFunctionalTable(makeFunctionalReport(3));

  const rows: string[][] = tableMock.mock.calls[0].arguments[0];
  assert.ok(rows[0].includes('baseline'), 'Header should include baseline for multi-trial');
  assert.ok(rows[0].includes('local'), 'Header should include local for multi-trial');

  mock.reset();
});

test('renderFunctionalTable: omits baseline column when no baseline was run', () => {
  const tableMock = mock.fn();
  const writeMock = mock.fn();
  mock.method(Logger, 'table', tableMock);
  mock.method(Logger, 'write', writeMock);

  renderFunctionalTable(makeFunctionalReport(1, false));

  const rows: string[][] = tableMock.mock.calls[0].arguments[0];
  assert.deepStrictEqual(rows[0], ['ID', 'Prompt', 'local'], 'Header should only include skill columns');

  const written = writeMock.mock.calls.map(c => c.arguments[0] as string).join('');
  assert.ok(!written.includes('baseline Rate'), 'Should not include without-skill rate line');
  assert.ok(written.includes('local Rate'), 'Should include with-skill rate line');

  mock.reset();
});
