import { test, mock } from 'node:test';
import assert from 'node:assert';
import { GeminiCliRunner } from '../../../src/core/runners/gemini-cli.runner';
import child_process from 'node:child_process';
import { EventEmitter } from 'node:events';

/**
 * Helper to mock the spawn process
 */
function createMockChild() {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = mock.fn();
  return child;
}

test('GeminiCliRunner.runPrompt should use --approval-mode auto_edit by default', async (t) => {
  const runner = new GeminiCliRunner();
  const mockChild = createMockChild();
  
  const spawnMock = mock.method(child_process, 'spawn', () => mockChild);

  const promise = runner.runPrompt('test prompt');

  // Simulate process output and close
  mockChild.stdout.emit('data', Buffer.from('{"response": "ok"}'));
  mockChild.emit('close', 0);

  const result = await promise;
  
  const lastCall = spawnMock.mock.calls[0];
  const args = lastCall.arguments[1];
  
  assert.ok(args.includes('-p'), 'Should include -p');
  assert.strictEqual(args[args.indexOf('-p') + 1], 'test prompt');
  assert.ok(args.includes('--approval-mode'));
  assert.strictEqual(args[args.indexOf('--approval-mode') + 1], 'auto_edit');
  
  spawnMock.mock.restore();
});

test('GeminiCliRunner.runPrompt should pass cwd to spawn', async (t) => {
  const runner = new GeminiCliRunner();
  const mockChild = createMockChild();
  const spawnMock = mock.method(child_process, 'spawn', () => mockChild);

  const cwd = '/some/path';
  const promise = runner.runPrompt('test prompt', cwd);

  mockChild.stdout.emit('data', Buffer.from('{"response": "ok"}'));
  mockChild.emit('close', 0);
  await promise;

  const lastCall = spawnMock.mock.calls[0];
  assert.strictEqual(lastCall.arguments[2]?.cwd, cwd);
  
  spawnMock.mock.restore();
});

test('GeminiCliRunner.runPrompt should return error object on invalid JSON', async (t) => {
  const runner = new GeminiCliRunner();
  const mockChild = createMockChild();
  const spawnMock = mock.method(child_process, 'spawn', () => mockChild);

  const promise = runner.runPrompt('test prompt');
  
  mockChild.stdout.emit('data', Buffer.from('this is not json'));
  mockChild.emit('close', 0);
  
  const result = await promise;
  
  assert.ok(result);
  assert.strictEqual(result?.error, 'No JSON object found');
  assert.strictEqual(result?.raw_output, 'this is not json');
  
  spawnMock.mock.restore();
});
