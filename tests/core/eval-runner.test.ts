import { test, mock } from 'node:test';
import * as assert from 'node:assert';
import { executor } from '../../src/utils/exec.js';
import { EvalRunner } from '../../src/core/eval-runner.js';
import { EvalEnvironment } from '../../src/core/environment.js';
import { RunnerFactory } from '../../src/runners/index.js';
import { Logger } from '../../src/utils/logger.js';
import { withRetry } from '../../src/core/trial-utils.js';
import type { EvalTrial } from '../../src/types/index.js';

// ── Phase 2: System Prompt Restriction ──────────────────────────────────────

test('EvalRunner.runFunctionalTask baseline prompt should include negative instruction', async () => {
  const agentRunnerMock = {
    skillDispatchToolName: 'activate_skill',
    runPrompt: mock.fn(async () => ({ response: 'ok', raw_output: '' })),
    linkSkill: mock.fn(async () => {}),

  };
  mock.method(RunnerFactory, 'create', () => agentRunnerMock);

  const runner = new EvalRunner({
    agent: 'gemini-cli', workspace: '/tmp', skillPath: './mock-skill', skillName: 'mock-skill',
    runDir: '/tmp', isBaseline: true
  });

  mock.method(executor, 'execSync', mock.fn(() => Buffer.from('')));
  mock.method(EvalEnvironment.prototype, 'createWorktree', () => '/tmp/worktree');
  mock.method(EvalEnvironment.prototype, 'removeWorktree', () => {});

  await runner.runFunctionalTask({ id: 99, prompt: 'do the thing', assertions: [] }, 0, 1, { updateLog: () => {} } as any);

  const promptUsed = agentRunnerMock.runPrompt.mock.calls[0].arguments[0] as string;
  assert.ok(promptUsed.includes("MUST NOT use the 'mock-skill'"), `Expected negative instruction in baseline prompt, got: ${promptUsed}`);
});

// ── Phase 3: Transcription Validation ───────────────────────────────────────

const skillActivationLog = (toolId = 'tool-1', includeResult = false) => {
  const lines = [JSON.stringify({ type: 'tool_use', tool_name: 'activate_skill', tool_id: toolId, parameters: { name: 'mock-skill' } })];
  if (includeResult) lines.push(JSON.stringify({ type: 'tool_result', tool_id: toolId, status: 'success' }));
  return lines.join('\n');
};

test('EvalRunner.runFunctionalTask baseline with skill activation → Invalid Baseline', async () => {
  const agentRunnerMock = {
    skillDispatchToolName: 'activate_skill',
    runPrompt: mock.fn(async () => ({ response: 'ok', raw_output: skillActivationLog() })),
    linkSkill: mock.fn(async () => {}),

  };
  mock.method(RunnerFactory, 'create', () => agentRunnerMock);

  const runner = new EvalRunner({
    agent: 'gemini-cli', workspace: '/tmp', skillPath: './mock-skill', skillName: 'mock-skill',
    runDir: '/tmp', isBaseline: true
  });

  mock.method(executor, 'execSync', mock.fn(() => Buffer.from('')));
  mock.method(EvalEnvironment.prototype, 'createWorktree', () => '/tmp/worktree');
  mock.method(EvalEnvironment.prototype, 'removeWorktree', () => {});

  const result = await runner.runFunctionalTask({ id: 2, prompt: 'test', assertions: ['anything'] }, 0, 1, { updateLog: () => {} } as any);

  assert.strictEqual(result.trialPassed, false);
  assert.ok(result.assertionResults[0].reason.includes('Invalid Without Skill'), `Expected 'Invalid Without Skill', got: ${result.assertionResults[0].reason}`);
});

test('EvalRunner.runFunctionalTask baseline with clean log → validation passes', async () => {
  const agentRunnerMock = {
    skillDispatchToolName: 'activate_skill',
    runPrompt: mock.fn(async () => ({ response: 'ok', raw_output: '{"type":"message","content":"hello"}' })),
    linkSkill: mock.fn(async () => {}),

  };
  mock.method(RunnerFactory, 'create', () => agentRunnerMock);

  const runner = new EvalRunner({
    agent: 'gemini-cli', workspace: '/tmp', skillPath: './mock-skill', skillName: 'mock-skill',
    runDir: '/tmp', isBaseline: true
  });

  mock.method(executor, 'execSync', mock.fn(() => Buffer.from('')));
  mock.method(EvalEnvironment.prototype, 'createWorktree', () => '/tmp/worktree');
  mock.method(EvalEnvironment.prototype, 'removeWorktree', () => {});

  const result = await runner.runFunctionalTask({ id: 3, prompt: 'test', assertions: [] }, 0, 1, { updateLog: () => {} } as any);

  assert.ok(!result.assertionResults.some(r => r.reason.includes('Invalid Without Skill')), 'Should not flag clean without-skill as invalid');
  assert.strictEqual(result.trialPassed, true);
});

test('EvalRunner.runFunctionalTask target with no skill activation → Invalid Target', async () => {
  const agentRunnerMock = {
    skillDispatchToolName: 'activate_skill',
    runPrompt: mock.fn(async () => ({ response: 'ok', raw_output: '{"type":"message","content":"hello"}' })),
    linkSkill: mock.fn(async () => {}),

  };
  mock.method(RunnerFactory, 'create', () => agentRunnerMock);

  const runner = new EvalRunner({
    agent: 'gemini-cli', workspace: '/tmp', skillPath: './mock-skill', skillName: 'mock-skill',
    runDir: '/tmp', isBaseline: false
  });

  mock.method(executor, 'execSync', mock.fn(() => Buffer.from('')));
  mock.method(EvalEnvironment.prototype, 'createWorktree', () => '/tmp/worktree');
  mock.method(EvalEnvironment.prototype, 'removeWorktree', () => {});

  const result = await runner.runFunctionalTask({ id: 4, prompt: 'test', assertions: ['anything'] }, 0, 1, { updateLog: () => {} } as any);

  assert.strictEqual(result.trialPassed, false);
  assert.ok(result.assertionResults[0].reason.includes('Invalid With Skill'), `Expected 'Invalid With Skill', got: ${result.assertionResults[0].reason}`);
});

test('EvalRunner.runFunctionalTask with error transcript sets isError:true', async () => {
  const agentRunnerMock = {
    skillDispatchToolName: 'activate_skill',
    runPrompt: mock.fn(async () => ({ error: 'Process timeout exceeded (600 seconds)' })),
    linkSkill: mock.fn(async () => {}),

  };
  mock.method(RunnerFactory, 'create', () => agentRunnerMock);

  const runner = new EvalRunner({
    agent: 'gemini-cli', workspace: '/tmp', skillPath: './mock-skill', skillName: 'mock-skill',
    runDir: '/tmp', isBaseline: false
  });

  mock.method(executor, 'execSync', mock.fn(() => Buffer.from('')));
  mock.method(EvalEnvironment.prototype, 'createWorktree', () => '/tmp/worktree');
  mock.method(EvalEnvironment.prototype, 'removeWorktree', () => {});

  const result = await runner.runFunctionalTask({ id: 99, prompt: 'test', assertions: ['check something'] }, 0, 1, { updateLog: () => {} } as any);

  assert.strictEqual(result.trialPassed, false);
  assert.ok(result.isError, 'Should set isError:true when runner returns an error transcript');
});

test('EvalRunner.runFunctionalTask target with successful skill activation → validation passes', async () => {
  const agentRunnerMock = {
    skillDispatchToolName: 'activate_skill',
    runPrompt: mock.fn(async () => ({ response: 'ok', raw_output: skillActivationLog('t1', true) })),
    linkSkill: mock.fn(async () => {}),

  };
  mock.method(RunnerFactory, 'create', () => agentRunnerMock);

  const runner = new EvalRunner({
    agent: 'gemini-cli', workspace: '/tmp', skillPath: './mock-skill', skillName: 'mock-skill',
    runDir: '/tmp', isBaseline: false
  });

  mock.method(executor, 'execSync', mock.fn(() => Buffer.from('')));
  mock.method(EvalEnvironment.prototype, 'createWorktree', () => '/tmp/worktree');
  mock.method(EvalEnvironment.prototype, 'removeWorktree', () => {});

  const result = await runner.runFunctionalTask({ id: 5, prompt: 'test', assertions: [] }, 0, 1, { updateLog: () => {} } as any);

  assert.ok(!result.assertionResults.some(r => r.reason.includes('Invalid With Skill')), 'Should not flag valid with-skill as invalid');
  assert.strictEqual(result.trialPassed, true);
});

// ── Retry workspace isolation ────────────────────────────────────────────────

test('EvalRunner.runTriggerTask with error transcript always calls removeWorktree', async () => {
  mock.method(RunnerFactory, 'create', () => ({
    skillDispatchToolName: 'activate_skill',
    runPrompt: mock.fn(async () => ({ error: 'Process timeout exceeded' })),
    linkSkill: mock.fn(async () => {}),
  }));

  const runner = new EvalRunner({
    agent: 'gemini-cli', workspace: '/tmp', skillPath: './mock-skill', skillName: 'mock-skill',
    runDir: '/tmp', isBaseline: false
  });

  mock.method(EvalEnvironment.prototype, 'createWorktree', mock.fn(() => '/tmp/worktree'));
  const removeWorktreeMock = mock.fn(() => {});
  mock.method(EvalEnvironment.prototype, 'removeWorktree', removeWorktreeMock);

  const result = await runner.runTriggerTask({ id: 10, prompt: 'test' }, 0, 1, { updateLog: () => {} } as any);

  assert.strictEqual(result.isError, true, 'Should return isError:true on timeout');
  assert.strictEqual(removeWorktreeMock.mock.calls.length, 1, 'removeWorktree must be called for cleanup even on error path');
});

test('EvalRunner.runFunctionalTask with error transcript always calls removeWorktree', async () => {
  mock.method(RunnerFactory, 'create', () => ({
    skillDispatchToolName: 'activate_skill',
    runPrompt: mock.fn(async () => ({ error: 'Process timeout exceeded' })),
    linkSkill: mock.fn(async () => {}),
  }));

  const runner = new EvalRunner({
    agent: 'gemini-cli', workspace: '/tmp', skillPath: './mock-skill', skillName: 'mock-skill',
    runDir: '/tmp', isBaseline: false
  });

  mock.method(EvalEnvironment.prototype, 'createWorktree', mock.fn(() => '/tmp/worktree'));
  const removeWorktreeMock = mock.fn(() => {});
  mock.method(EvalEnvironment.prototype, 'removeWorktree', removeWorktreeMock);

  const result = await runner.runFunctionalTask({ id: 11, prompt: 'test', assertions: ['x'] }, 0, 1, { updateLog: () => {} } as any);

  assert.strictEqual(result.isError, true, 'Should return isError:true on timeout');
  assert.strictEqual(removeWorktreeMock.mock.calls.length, 1, 'removeWorktree must be called for cleanup even on error path');
});

test('EvalRunner.runTriggerTask uses unique worktree name per retry attempt', async () => {
  mock.method(RunnerFactory, 'create', () => ({
    skillDispatchToolName: 'activate_skill',
    runPrompt: mock.fn(async () => ({ response: 'ok', raw_output: '' })),
    linkSkill: mock.fn(async () => {}),
  }));

  const runner = new EvalRunner({
    agent: 'gemini-cli', workspace: '/tmp', skillPath: './mock-skill', skillName: 'mock-skill',
    runDir: '/tmp', isBaseline: false
  });

  const createWorktreeMock = mock.fn(() => '/tmp/worktree');
  mock.method(EvalEnvironment.prototype, 'createWorktree', createWorktreeMock);
  mock.method(EvalEnvironment.prototype, 'removeWorktree', mock.fn(() => {}));

  await runner.runTriggerTask({ id: 7, prompt: 'test' }, 0, 3, { updateLog: () => {} } as any, 0);
  const attempt0Id = createWorktreeMock.mock.calls[0].arguments[0] as string;

  await runner.runTriggerTask({ id: 7, prompt: 'test' }, 0, 3, { updateLog: () => {} } as any, 1);
  const attempt1Id = createWorktreeMock.mock.calls[1].arguments[0] as string;

  assert.strictEqual(attempt0Id, 'task-7-trial-3', 'First attempt uses base name');
  assert.strictEqual(attempt1Id, 'task-7-trial-3-r1', 'First retry uses -r1 suffix');
  assert.notStrictEqual(attempt0Id, attempt1Id, 'Retry must use a different worktree name');
});

test('withRetry passes attempt number 0, 1, 2 to fn and stops on success', async () => {
  const attempts: number[] = [];
  const fn = mock.fn(async (attempt: number): Promise<EvalTrial> => {
    attempts.push(attempt);
    if (attempt < 2) {
      return { id: 1, transcript: { error: 'infra fail' }, assertionResults: [], trialPassed: false, isError: true };
    }
    return { id: 1, transcript: { response: 'ok' }, assertionResults: [], trialPassed: true };
  });

  const result = await withRetry(fn, 2, 0);

  assert.deepStrictEqual(attempts, [0, 1, 2], 'Should call fn with attempt 0, 1, 2');
  assert.strictEqual(result.trialPassed, true, 'Should return successful result');
});

