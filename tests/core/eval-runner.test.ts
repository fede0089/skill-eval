import { test, mock } from 'node:test';
import * as assert from 'node:assert';
import { executor } from '../../src/utils/exec.js';
import { EvalRunner } from '../../src/core/eval-runner.js';
import { EvalEnvironment } from '../../src/core/environment.js';
import { RunnerFactory } from '../../src/runners/index.js';
import { Logger } from '../../src/utils/logger.js';

test('EvalRunner.runFunctionalTask should disable skill in baseline', async (t) => {
  const runnerOptions = {
    agent: 'gemini-cli',
    workspace: '/tmp',
    skillPath: './mock-skill',
    skillName: 'mock-skill',
    runDir: './runs',
    isBaseline: true
  };

  const disableSkillMock = mock.fn(async () => {});
  const agentRunnerMock = {
    skillDispatchToolName: 'activate_skill',
    runPrompt: mock.fn(async () => ({ response: 'Mock response' })),
    disableSkill: disableSkillMock
  };
  mock.method(RunnerFactory, 'create', () => agentRunnerMock);

  const runner = new EvalRunner(runnerOptions);

  // Mock dependencies
  mock.method(executor, 'execSync', mock.fn(() => Buffer.from('')));
  mock.method(EvalEnvironment.prototype, 'createWorktree', () => '/tmp/worktree');
  mock.method(EvalEnvironment.prototype, 'removeWorktree', () => {});

  const task = { id: 1, prompt: 'test prompt', assertions: [] };
  const uiCtx = { updateLog: () => {} } as any;

  await runner.runFunctionalTask(task, 0, 1, uiCtx);

  // Check if disableSkill was called with correct args
  assert.strictEqual(disableSkillMock.mock.callCount(), 1, 'disableSkill should have been called once');
  assert.strictEqual(disableSkillMock.mock.calls[0].arguments[0], 'mock-skill', 'disableSkill should receive the skill name');
  assert.strictEqual(disableSkillMock.mock.calls[0].arguments[1], '/tmp/worktree', 'disableSkill should receive the worktree path');
});

// ── Phase 2: System Prompt Restriction ──────────────────────────────────────

test('EvalRunner.runFunctionalTask baseline prompt should include negative instruction', async () => {
  const agentRunnerMock = {
    skillDispatchToolName: 'activate_skill',
    runPrompt: mock.fn(async () => ({ response: 'ok', raw_output: '' })),
    linkSkill: mock.fn(async () => {}),
    disableSkill: mock.fn(async () => {})
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
    disableSkill: mock.fn(async () => {})
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
    disableSkill: mock.fn(async () => {})
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
    disableSkill: mock.fn(async () => {})
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

test('EvalRunner.runFunctionalTask target with successful skill activation → validation passes', async () => {
  const agentRunnerMock = {
    skillDispatchToolName: 'activate_skill',
    runPrompt: mock.fn(async () => ({ response: 'ok', raw_output: skillActivationLog('t1', true) })),
    linkSkill: mock.fn(async () => {}),
    disableSkill: mock.fn(async () => {})
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

test('EvalRunner.runFunctionalTask baseline skill-disable failure should warn, not throw', async (t) => {
  const agentRunnerMock = {
    skillDispatchToolName: 'activate_skill',
    runPrompt: mock.fn(async () => ({ response: 'ok', raw_output: '' })),
    disableSkill: mock.fn(async () => { throw new Error('command not found: gemini'); })
  };
  mock.method(RunnerFactory, 'create', () => agentRunnerMock);

  const runner = new EvalRunner({
    agent: 'gemini-cli', workspace: '/tmp', skillPath: './mock-skill', skillName: 'mock-skill',
    runDir: '/tmp', isBaseline: true
  });

  const warnMock = mock.fn();
  mock.method(Logger, 'warn', warnMock);

  mock.method(executor, 'execSync', mock.fn(() => Buffer.from('')));
  mock.method(EvalEnvironment.prototype, 'createWorktree', () => '/tmp/worktree');
  mock.method(EvalEnvironment.prototype, 'removeWorktree', () => {});

  // Should not throw — warning is surfaced, trial continues
  const result = await runner.runFunctionalTask({ id: 6, prompt: 'test', assertions: [] }, 0, 1, { updateLog: () => {} } as any);

  assert.ok(result, 'Trial should still return a result when skill-disable fails');
  const warnCalls = warnMock.mock.calls.map(c => c.arguments[0] as string);
  assert.ok(
    warnCalls.some(msg => msg.includes('baseline may be unreliable')),
    `Expected a warn about baseline reliability, got: ${JSON.stringify(warnCalls)}`
  );

  mock.reset();
});
