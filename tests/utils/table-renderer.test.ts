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
    skill_name: 'test-skill',
    agent: 'gemini-cli',
    metrics: { withSkillScore: '100%', passedCount: 1, totalCount: 1, numTrials, passAtK: 1, passAtN: 1 },
    results: [{
      taskId: 1,
      prompt: 'Do something useful',
      score: 1.0,
      trials: [makeTrial(true, 1), makeTrial(true, 2), makeTrial(false, 3)].slice(0, numTrials)
    }],
    ...overrides
  };
}

function makeFunctionalReport(numTrials = 1): EvalSuiteReport {
  return {
    timestamp: '2026-01-01T00:00:00.000Z',
    skill_name: 'test-skill',
    agent: 'gemini-cli',
    metrics: {
      withSkillScore: '100%', withoutSkillScore: '0%', skillUplift: '+100%',
      passedCount: 1, totalCount: 1, numTrials,
      passAtK: 1, passAtN: 1,
      withoutSkillPassAtK: 0, withoutSkillPassAtN: 0
    },
    results: [{
      taskId: 1,
      prompt: 'Generate a license',
      score: 1.0,
      trials: [makeTrial(true, 1)],
      withoutSkillTrials: [makeTrial(false, 1)]
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
  assert.deepStrictEqual(rows[0], ['ID', 'Prompt', 'Status'], 'Header should have Status column for 1 trial');
  assert.ok(rows.length > 1, 'Table should have at least one data row');

  const written = writeMock.mock.calls.map(c => c.arguments[0] as string).join('');
  assert.ok(written.includes('Trigger Success Rate'), 'Should include rate line');

  mock.reset();
});

test('renderTriggerTable: uses pass@k columns for multi-trial reports', () => {
  const tableMock = mock.fn();
  mock.method(Logger, 'table', tableMock);
  mock.method(Logger, 'write', mock.fn());

  renderTriggerTable(makeTriggerReport(3));

  const rows: string[][] = tableMock.mock.calls[0].arguments[0];
  assert.deepStrictEqual(rows[0], ['ID', 'Prompt', 'Trials', 'pass@1'], 'Header should have pass@1 column');

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
  assert.deepStrictEqual(rows[0], ['ID', 'Prompt', 'W/o Skill', 'W/ Skill'], 'Header should have skill comparison columns');

  const written = writeMock.mock.calls.map(c => c.arguments[0] as string).join('');
  assert.ok(written.includes('Without Skill Rate'), 'Should include without-skill rate line');
  assert.ok(written.includes('With Skill Rate'), 'Should include with-skill rate line');

  mock.reset();
});

test('renderFunctionalTable: uses pass@k columns for multi-trial reports', () => {
  const tableMock = mock.fn();
  mock.method(Logger, 'table', tableMock);
  mock.method(Logger, 'write', mock.fn());

  renderFunctionalTable(makeFunctionalReport(3));

  const rows: string[][] = tableMock.mock.calls[0].arguments[0];
  assert.ok(rows[0].includes('W/o p@1'), 'Header should include W/o p@1 for multi-trial');
  assert.ok(rows[0].includes('W/ p@1'), 'Header should include W/ p@1 for multi-trial');

  mock.reset();
});
