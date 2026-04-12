import { test, mock } from 'node:test';
import * as assert from 'node:assert';
import fs from 'node:fs';
import { showCommand } from '../../src/commands/show.js';
import { Logger } from '../../src/utils/logger.js';

test('showCommand should display latest trigger evaluation results', async (t) => {
  const mockRunDir = '2024-04-11T12-00-00-000Z';
  const mockSummary = {
    timestamp: '2024-04-11T12:00:00.000Z',
    skill_name: 'test-skill',
    agent: 'gemini-cli',
    metrics: {
      withSkillScore: '100%',
      passedCount: 1,
      totalCount: 1,
      numTrials: 1,
      passAtK: 1.0,
      passAtN: 1.0
    },
    results: [
      {
        taskId: 1,
        prompt: 'test prompt',
        score: 1.0,
        trials: [
          { id: 1, trialPassed: true, assertionResults: [] }
        ]
      }
    ]
  };

  mock.method(fs, 'existsSync', (p: string) => true);
  mock.method(fs, 'readdirSync', (p: string) => [mockRunDir]);
  mock.method(fs, 'statSync', (p: string) => ({ isDirectory: () => true }));
  mock.method(fs, 'readFileSync', (p: string) => JSON.stringify(mockSummary));
  
  mock.method(Logger, 'write', () => {});
  mock.method(Logger, 'table', () => {});

  try {
    await showCommand();
  } finally {
    mock.reset();
  }
});

test('showCommand should display latest functional evaluation results', async (t) => {
  const mockRunDir = '2024-04-11T13-00-00-000Z';
  const mockSummary = {
    timestamp: '2024-04-11T13:00:00.000Z',
    skill_name: 'test-skill-functional',
    agent: 'gemini-cli',
    metrics: {
      withSkillScore: '100%',
      withoutSkillScore: '0%',
      skillUplift: '+100%',
      passedCount: 1,
      totalCount: 1,
      numTrials: 1,
      passAtK: 1.0,
      passAtN: 1.0,
      withoutSkillPassAtK: 0.0,
      withoutSkillPassAtN: 0.0
    },
    results: [
      {
        taskId: 1,
        prompt: 'test functional prompt',
        score: 1.0,
        trials: [{ id: 1, trialPassed: true, assertionResults: [] }],
        withoutSkillTrials: [{ id: 1, trialPassed: false, assertionResults: [] }]
      }
    ]
  };

  mock.method(fs, 'existsSync', (p: string) => true);
  mock.method(fs, 'readdirSync', (p: string) => [mockRunDir]);
  mock.method(fs, 'statSync', (p: string) => ({ isDirectory: () => true }));
  mock.method(fs, 'readFileSync', (p: string) => JSON.stringify(mockSummary));
  
  mock.method(Logger, 'write', () => {});
  mock.method(Logger, 'table', () => {});

  try {
    await showCommand();
  } finally {
    mock.reset();
  }
});

test('showCommand should throw error if no runs found', async (t) => {
  mock.method(fs, 'existsSync', (p: string) => false);
  
  try {
    await showCommand();
    assert.fail('Should have thrown an error');
  } catch (err: any) {
    assert.strictEqual(err.message, 'No evaluation runs found. Run an evaluation first.');
  } finally {
    mock.reset();
  }
});
