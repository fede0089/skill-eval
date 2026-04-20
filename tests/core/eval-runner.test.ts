import { test, mock } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
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
    applyRunnerConfig: mock.fn(() => {}),

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
    applyRunnerConfig: mock.fn(() => {}),

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
    applyRunnerConfig: mock.fn(() => {}),

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
    applyRunnerConfig: mock.fn(() => {}),

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
    applyRunnerConfig: mock.fn(() => {}),

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
    applyRunnerConfig: mock.fn(() => {}),

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

test('EvalRunner.runTriggerTask with stream-json error result sets isError:true', async () => {
  const ndjsonError = JSON.stringify({ type: 'result', status: 'error', error: { message: 'Gemini CLI blocked on interactive prompt' } });
  mock.method(RunnerFactory, 'create', () => ({
    skillDispatchToolName: 'activate_skill',
    runPrompt: mock.fn(async () => ({ response: ndjsonError, raw_output: '' })),
    linkSkill: mock.fn(async () => {}),
    applyRunnerConfig: mock.fn(() => {}),
  }));

  const runner = new EvalRunner({
    agent: 'gemini-cli', workspace: '/tmp', skillPath: './mock-skill', skillName: 'mock-skill',
    runDir: '/tmp', isBaseline: false
  });

  mock.method(EvalEnvironment.prototype, 'createWorktree', () => '/tmp/worktree');
  mock.method(EvalEnvironment.prototype, 'removeWorktree', () => {});

  const result = await runner.runTriggerTask({ id: 20, prompt: 'test' }, 0, 1, { updateLog: () => {} } as any);

  assert.strictEqual(result.isError, true, 'Should set isError:true when NDJSON result has status:error');
  assert.strictEqual(result.trialPassed, false);
});

test('EvalRunner.runFunctionalTask with stream-json error result sets isError:true', async () => {
  const ndjsonError = JSON.stringify({ type: 'result', status: 'error', error: { message: 'Gemini CLI blocked on interactive prompt' } });
  mock.method(RunnerFactory, 'create', () => ({
    skillDispatchToolName: 'activate_skill',
    runPrompt: mock.fn(async () => ({ response: ndjsonError, raw_output: '' })),
    linkSkill: mock.fn(async () => {}),
    applyRunnerConfig: mock.fn(() => {}),
  }));

  const runner = new EvalRunner({
    agent: 'gemini-cli', workspace: '/tmp', skillPath: './mock-skill', skillName: 'mock-skill',
    runDir: '/tmp', isBaseline: false
  });

  mock.method(EvalEnvironment.prototype, 'createWorktree', () => '/tmp/worktree');
  mock.method(EvalEnvironment.prototype, 'removeWorktree', () => {});

  const result = await runner.runFunctionalTask({ id: 21, prompt: 'test', assertions: ['check something'] }, 0, 1, { updateLog: () => {} } as any);

  assert.strictEqual(result.isError, true, 'Should set isError:true when NDJSON result has status:error');
  assert.strictEqual(result.trialPassed, false);
});

test('EvalRunner.runTriggerTask with error transcript always calls removeWorktree', async () => {
  mock.method(RunnerFactory, 'create', () => ({
    skillDispatchToolName: 'activate_skill',
    runPrompt: mock.fn(async () => ({ error: 'Process timeout exceeded' })),
    linkSkill: mock.fn(async () => {}),
    applyRunnerConfig: mock.fn(() => {}),
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
    applyRunnerConfig: mock.fn(() => {}),
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
    applyRunnerConfig: mock.fn(() => {}),
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

// ── Judge retry ──────────────────────────────────────────────────────────────

test('EvalRunner.runFunctionalTask retries only the judge when gradeModelBased throws, succeeds on second attempt', async () => {
  let runPromptCallCount = 0;
  const skillLog = skillActivationLog('t1', true);
  const judgeResponse = JSON.stringify([{ assertion: 'test', passed: true, reason: 'ok' }]);
  const ndjsonJudgeResponse = `${JSON.stringify({ type: 'message', role: 'assistant', content: judgeResponse })}\n${JSON.stringify({ type: 'result', status: 'success' })}`;

  mock.method(RunnerFactory, 'create', () => ({
    skillDispatchToolName: 'activate_skill',
    runPrompt: mock.fn(async () => {
      runPromptCallCount++;
      if (runPromptCallCount === 1) {
        // Agent call — success with skill activation
        return { response: 'ok', raw_output: skillLog };
      } else if (runPromptCallCount === 2) {
        // Judge call attempt 0 — infrastructure failure
        return { error: 'Gemini CLI blocked on interactive prompt', raw_output: '' };
      } else {
        // Judge call attempt 1 — success
        return { response: ndjsonJudgeResponse, raw_output: '' };
      }
    }),
    linkSkill: mock.fn(async () => {}),
    applyRunnerConfig: mock.fn(() => {}),
  }));

  const runner = new EvalRunner({
    agent: 'gemini-cli', workspace: '/tmp', skillPath: './mock-skill', skillName: 'mock-skill',
    runDir: '/tmp', isBaseline: false, judgeRetryDelayMs: 0
  });

  mock.method(executor, 'execSync', mock.fn(() => Buffer.from('')));
  mock.method(EvalEnvironment.prototype, 'createWorktree', () => '/tmp/worktree');
  mock.method(EvalEnvironment.prototype, 'removeWorktree', () => {});

  const result = await runner.runFunctionalTask({ id: 30, prompt: 'test', assertions: ['test'] }, 0, 1, { updateLog: () => {} } as any);

  assert.strictEqual(result.trialPassed, true, 'Trial should pass after judge retry succeeds');
  assert.strictEqual(result.isError, undefined, 'isError should not be set when judge eventually succeeds');
  assert.strictEqual(runPromptCallCount, 3, 'Agent called once, judge called twice (1 fail + 1 success)');
});

test('EvalRunner.runFunctionalTask returns inconclusive failure (isError unset) when judge exhausts all retries', async () => {
  let runPromptCallCount = 0;
  const skillLog = skillActivationLog('t1', true);

  mock.method(RunnerFactory, 'create', () => ({
    skillDispatchToolName: 'activate_skill',
    runPrompt: mock.fn(async () => {
      runPromptCallCount++;
      if (runPromptCallCount === 1) {
        // Agent call — success
        return { response: 'ok', raw_output: skillLog };
      }
      // All judge calls — infrastructure failure
      return { error: 'Gemini CLI blocked on interactive prompt', raw_output: '' };
    }),
    linkSkill: mock.fn(async () => {}),
    applyRunnerConfig: mock.fn(() => {}),
  }));

  const runner = new EvalRunner({
    agent: 'gemini-cli', workspace: '/tmp', skillPath: './mock-skill', skillName: 'mock-skill',
    runDir: '/tmp', isBaseline: false, judgeRetryDelayMs: 0
  });

  mock.method(executor, 'execSync', mock.fn(() => Buffer.from('')));
  mock.method(EvalEnvironment.prototype, 'createWorktree', () => '/tmp/worktree');
  mock.method(EvalEnvironment.prototype, 'removeWorktree', () => {});

  const result = await runner.runFunctionalTask({ id: 31, prompt: 'test', assertions: ['test'] }, 0, 1, { updateLog: () => {} } as any);

  assert.strictEqual(result.trialPassed, false, 'Trial should fail when judge is exhausted');
  assert.ok(!result.isError, 'isError should NOT be set — outer withRetry must not re-run the agent for a judge failure');
  assert.ok(result.assertionResults[0].reason.includes('Judge agent failed'), `Expected judge error reason, got: ${result.assertionResults[0].reason}`);
  // Agent called once, judge called 3 times (MAX_JUDGE_RETRIES=2 → attempts 0,1,2)
  assert.strictEqual(runPromptCallCount, 4, 'Agent called once, judge called 3 times (initial + 2 retries)');
});

// ── Runner config (evals/config/<agent>/) ───────────────────────────────────

test('EvalRunner.runTriggerTask copies evals/config/gemini-cli/ into worktree .gemini/', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-test-'));
  const skillDir = path.join(workspace, 'test-skill');
  const configDir = path.join(skillDir, 'evals', 'config', 'gemini-cli');
  fs.mkdirSync(configDir, { recursive: true });
  const settingsContent = JSON.stringify({ telemetry: { enabled: false } });
  fs.writeFileSync(path.join(configDir, 'settings.json'), settingsContent);

  const worktreePath = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-worktree-'));

  try {
    mock.method(RunnerFactory, 'create', () => ({
      skillDispatchToolName: 'activate_skill',
      runPrompt: mock.fn(async () => ({ response: 'ok', raw_output: '' })),
      linkSkill: mock.fn(async () => {}),
      applyRunnerConfig: mock.fn((src: string, dst: string) => {
        const geminiSrc = path.join(src, 'gemini-cli');
        if (!fs.existsSync(geminiSrc)) return;
        const geminiDst = path.join(dst, '.gemini');
        fs.mkdirSync(geminiDst, { recursive: true });
        fs.cpSync(geminiSrc, geminiDst, { recursive: true, force: true });
      }),
    }));
    mock.method(EvalEnvironment.prototype, 'createWorktree', () => worktreePath);
    mock.method(EvalEnvironment.prototype, 'removeWorktree', () => {});

    const runner = new EvalRunner({
      agent: 'gemini-cli', workspace, skillPath: './test-skill', skillName: 'test-skill',
      runDir: '/tmp',
    });

    await runner.runTriggerTask({ id: 1, prompt: 'test' }, 0, 1, { updateLog: () => {} } as any);

    const copiedSettings = path.join(worktreePath, '.gemini', 'settings.json');
    assert.ok(fs.existsSync(copiedSettings), 'settings.json should be copied to worktree .gemini/');
    assert.strictEqual(fs.readFileSync(copiedSettings, 'utf-8'), settingsContent);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(worktreePath, { recursive: true, force: true });
  }
});

test('EvalRunner.runTriggerTask does not fail when evals/config/gemini-cli/ does not exist', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-test-'));
  const worktreePath = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-worktree-'));

  try {
    mock.method(RunnerFactory, 'create', () => ({
      skillDispatchToolName: 'activate_skill',
      runPrompt: mock.fn(async () => ({ response: 'ok', raw_output: '' })),
      linkSkill: mock.fn(async () => {}),
      applyRunnerConfig: mock.fn(() => {}),
    }));
    mock.method(EvalEnvironment.prototype, 'createWorktree', () => worktreePath);
    mock.method(EvalEnvironment.prototype, 'removeWorktree', () => {});

    const runner = new EvalRunner({
      agent: 'gemini-cli', workspace, skillPath: './test-skill', skillName: 'test-skill',
      runDir: '/tmp',
    });

    await assert.doesNotReject(
      () => runner.runTriggerTask({ id: 1, prompt: 'test' }, 0, 1, { updateLog: () => {} } as any),
      'Should not throw when runner config dir does not exist'
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(worktreePath, { recursive: true, force: true });
  }
});

// ── Token stats extraction ───────────────────────────────────────────────────

const resultWithStats = JSON.stringify({
  type: 'result', status: 'success',
  stats: { total_tokens: 5000, input_tokens: 4500, output_tokens: 500, cached: 2000 }
});

test('EvalRunner.runTriggerTask extracts tokenStats when result event has stats', async () => {
  mock.method(RunnerFactory, 'create', () => ({
    skillDispatchToolName: 'activate_skill',
    runPrompt: mock.fn(async () => ({ response: resultWithStats, raw_output: '' })),
    linkSkill: mock.fn(async () => {}),
    applyRunnerConfig: mock.fn(() => {}),
  }));

  const runner = new EvalRunner({
    agent: 'gemini-cli', workspace: '/tmp', skillPath: './mock-skill', skillName: 'mock-skill',
    runDir: '/tmp'
  });

  mock.method(EvalEnvironment.prototype, 'createWorktree', () => '/tmp/worktree');
  mock.method(EvalEnvironment.prototype, 'removeWorktree', () => {});

  const result = await runner.runTriggerTask({ id: 50, prompt: 'test' }, 0, 1, { updateLog: () => {} } as any);

  assert.ok(result.tokenStats, 'tokenStats should be populated');
  assert.strictEqual(result.tokenStats?.total_tokens, 5000);
  assert.strictEqual(result.tokenStats?.input_tokens, 4500);
  assert.strictEqual(result.tokenStats?.output_tokens, 500);
  assert.strictEqual(result.tokenStats?.cached_tokens, 2000);
});

test('EvalRunner.runTriggerTask has no tokenStats when result event lacks stats', async () => {
  mock.method(RunnerFactory, 'create', () => ({
    skillDispatchToolName: 'activate_skill',
    runPrompt: mock.fn(async () => ({ response: JSON.stringify({ type: 'result', status: 'success' }), raw_output: '' })),
    linkSkill: mock.fn(async () => {}),
    applyRunnerConfig: mock.fn(() => {}),
  }));

  const runner = new EvalRunner({
    agent: 'gemini-cli', workspace: '/tmp', skillPath: './mock-skill', skillName: 'mock-skill',
    runDir: '/tmp'
  });

  mock.method(EvalEnvironment.prototype, 'createWorktree', () => '/tmp/worktree');
  mock.method(EvalEnvironment.prototype, 'removeWorktree', () => {});

  const result = await runner.runTriggerTask({ id: 51, prompt: 'test' }, 0, 1, { updateLog: () => {} } as any);

  assert.strictEqual(result.tokenStats, undefined, 'tokenStats should be undefined when stats are absent');
});

test('EvalRunner.runFunctionalTask extracts tokenStats for with-skill trial', async () => {
  const ndjsonWithSkill = [
    JSON.stringify({ type: 'tool_use', tool_name: 'activate_skill', tool_id: 'x1', parameters: { name: 'mock-skill' } }),
    JSON.stringify({ type: 'tool_result', tool_id: 'x1', status: 'success' }),
    resultWithStats
  ].join('\n');

  mock.method(RunnerFactory, 'create', () => ({
    skillDispatchToolName: 'activate_skill',
    runPrompt: mock.fn(async () => ({ response: ndjsonWithSkill, raw_output: ndjsonWithSkill })),
    linkSkill: mock.fn(async () => {}),
    applyRunnerConfig: mock.fn(() => {}),
  }));

  const runner = new EvalRunner({
    agent: 'gemini-cli', workspace: '/tmp', skillPath: './mock-skill', skillName: 'mock-skill',
    runDir: '/tmp', isBaseline: false
  });

  mock.method(executor, 'execSync', mock.fn(() => Buffer.from('')));
  mock.method(EvalEnvironment.prototype, 'createWorktree', () => '/tmp/worktree');
  mock.method(EvalEnvironment.prototype, 'removeWorktree', () => {});

  const result = await runner.runFunctionalTask({ id: 52, prompt: 'test', assertions: [] }, 0, 1, { updateLog: () => {} } as any);

  assert.ok(result.tokenStats, 'tokenStats should be populated for with-skill functional trial');
  assert.strictEqual(result.tokenStats?.total_tokens, 5000);
});

test('EvalRunner.runFunctionalTask extracts tokenStats for without-skill trial', async () => {
  const ndjsonBaseline = resultWithStats;

  mock.method(RunnerFactory, 'create', () => ({
    skillDispatchToolName: 'activate_skill',
    runPrompt: mock.fn(async () => ({ response: ndjsonBaseline, raw_output: '' })),
    linkSkill: mock.fn(async () => {}),
    applyRunnerConfig: mock.fn(() => {}),
  }));

  const runner = new EvalRunner({
    agent: 'gemini-cli', workspace: '/tmp', skillPath: './mock-skill', skillName: 'mock-skill',
    runDir: '/tmp', isBaseline: true
  });

  mock.method(executor, 'execSync', mock.fn(() => Buffer.from('')));
  mock.method(EvalEnvironment.prototype, 'createWorktree', () => '/tmp/worktree');
  mock.method(EvalEnvironment.prototype, 'removeWorktree', () => {});

  const result = await runner.runFunctionalTask({ id: 53, prompt: 'test', assertions: [] }, 0, 1, { updateLog: () => {} } as any);

  assert.ok(result.tokenStats, 'tokenStats should be populated for without-skill functional trial');
  assert.strictEqual(result.tokenStats?.total_tokens, 5000);
});

