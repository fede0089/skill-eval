import { test, mock } from 'node:test';
import assert from 'node:assert';
import { GeminiCliRunner } from '../../../src/core/runners/gemini-cli.runner';
import child_process from 'node:child_process';

test('GeminiCliRunner.runPrompt should pass cwd to spawnSync', async (t) => {
  const runner = new GeminiCliRunner();
  const spawnMock = mock.method(child_process, 'spawnSync', () => ({ 
    status: 0, 
    stdout: '{"response": "ok", "stats": {}}' 
  }));

  const cwd = '/some/path';
  runner.runPrompt('test prompt', cwd);

  const lastCall = spawnMock.mock.calls[0];
  assert.strictEqual(lastCall.arguments[2]?.cwd, cwd);
  
  spawnMock.mock.restore();
});

test('GeminiCliRunner.runPrompt should return error object on invalid JSON', async (t) => {
  const runner = new GeminiCliRunner();
  const spawnMock = mock.method(child_process, 'spawnSync', () => ({ 
    status: 0, 
    stdout: 'this is not json' 
  }));

  const result = runner.runPrompt('test prompt');
  
  // Currently it returns null on failure, we want it to potentially include error info or at least handle it gracefully
  // Let's first check current behavior and then improve it.
  assert.strictEqual(result, null);
  
  spawnMock.mock.restore();
});

test('GeminiCliRunner.runPrompt should handle non-zero exit code', async (t) => {
  const runner = new GeminiCliRunner();
  const spawnMock = mock.method(child_process, 'spawnSync', () => ({ 
    status: 1, 
    stderr: 'Fatal error',
    stdout: ''
  }));

  const result = runner.runPrompt('test prompt');
  assert.strictEqual(result, null);
  
  spawnMock.mock.restore();
});

test('GeminiCliRunner.runPrompt should extract JSON even if there is leading text', async (t) => {
  const runner = new GeminiCliRunner();
  const stdout = 'Log line 1\nLog line 2\n{"response": "ok", "stats": {}}';
  const spawnMock = mock.method(child_process, 'spawnSync', () => ({ 
    status: 0, 
    stdout: stdout
  }));

  const result = runner.runPrompt('test prompt');
  assert.ok(result);
  assert.strictEqual(result?.response, 'ok');
  
  spawnMock.mock.restore();
});
