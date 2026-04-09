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

test('GeminiCliRunner.runPrompt should use --approval-mode yolo by default', async (t) => {
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
  
  // Verify yolo is used (this should FAIL initially as it's auto_edit)
  assert.ok(args.includes('--approval-mode'));
  assert.strictEqual(args[args.indexOf('--approval-mode') + 1], 'yolo');
  
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

test('GeminiCliRunner.runPrompt when interactive is true', async (t) => {
  const runner = new GeminiCliRunner();
  const mockChild = createMockChild();
  const spawnMock = mock.method(child_process, 'spawn', () => mockChild);

  // We expect to pass interactive as true (this will require interface update)
  const promise = (runner as any).runPrompt('test prompt', undefined, undefined, { interactive: true });

  mockChild.stdout.emit('data', Buffer.from('{"response": "ok"}'));
  mockChild.emit('close', 0);
  await promise;

  const lastCall = spawnMock.mock.calls[0];
  const args = lastCall.arguments[1];
  const options = lastCall.arguments[2];

  assert.ok(args.includes('--prompt-interactive'), 'Should include --prompt-interactive');
  assert.ok(!args.includes('--approval-mode'), 'Should NOT include --approval-mode in interactive mode');
  assert.deepStrictEqual(options.stdio, ['inherit', 'pipe', 'inherit'], 'Should inherit stdin/stderr');
  
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
