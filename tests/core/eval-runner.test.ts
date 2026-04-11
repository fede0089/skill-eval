import { test, mock } from 'node:test';
import * as assert from 'node:assert';
import { executor } from '../../src/utils/exec.js';
import { EvalRunner } from '../../src/core/eval-runner.js';
import { EvalEnvironment } from '../../src/core/environment.js';
import { RunnerFactory } from '../../src/core/runners/index.js';

test('EvalRunner.runFunctionalTask should disable skill in baseline', async (t) => {
  const runnerOptions = {
    agent: 'gemini-cli',
    skillPath: './mock-skill',
    skillName: 'mock-skill',
    runDir: './runs',
    isBaseline: true
  };

  const runner = new EvalRunner(runnerOptions);

  // Mock dependencies
  const execSyncMock = mock.fn(() => Buffer.from(''));
  mock.method(executor, 'execSync', execSyncMock);
  
  mock.method(EvalEnvironment.prototype, 'createWorktree', () => '/tmp/worktree');
  mock.method(EvalEnvironment.prototype, 'removeWorktree', () => {});
  
  const agentRunnerMock = {
    runPrompt: mock.fn(async () => ({ 
      response: 'Mock response'
    }))
  };
  mock.method(RunnerFactory, 'create', () => agentRunnerMock);

  const task = { id: 1, prompt: 'test prompt', assertions: [] };
  const uiCtx = { updateLog: () => {} } as any;

  await runner.runFunctionalTask(task, 0, uiCtx);

  // Check if gemini skills disable was called
  const disableCall = execSyncMock.mock.calls.find(call => 
    call.arguments[0].toString().includes('gemini skills disable mock-skill --scope project')
  );
  
  assert.ok(disableCall, 'gemini skills disable mock-skill --scope project should have been called');
  assert.strictEqual(disableCall.arguments[1].cwd, '/tmp/worktree', 'Disable command should be run in worktree');
});
