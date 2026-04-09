import { test, mock } from 'node:test';
import assert from 'node:assert';
import { GeminiCliRunner } from '../../../src/core/runners/gemini-cli.runner';
import child_process from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';

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
  mockChild.stdout.emit('data', Buffer.from('hello world'));
  mockChild.emit('close', 0);

  const result = await promise;
  
  const lastCall = spawnMock.mock.calls[0];
  const args = lastCall.arguments[1];
  
  assert.ok(args.includes('-p'), 'Should include -p');
  assert.strictEqual(args[args.indexOf('-p') + 1], 'test prompt');
  assert.ok(args.includes('--approval-mode'));
  assert.strictEqual(args[args.indexOf('--approval-mode') + 1], 'auto_edit');
  assert.ok(!args.includes('-o'), 'Should NOT include -o');
  assert.ok(!args.includes('json'), 'Should NOT include json');
  
  spawnMock.mock.restore();
});

test('GeminiCliRunner.runPrompt should pass cwd to spawn', async (t) => {
  const runner = new GeminiCliRunner();
  const mockChild = createMockChild();
  const spawnMock = mock.method(child_process, 'spawn', () => mockChild);

  const cwd = '/some/path';
  const promise = runner.runPrompt('test prompt', cwd);

  mockChild.stdout.emit('data', Buffer.from('ok'));
  mockChild.emit('close', 0);
  await promise;

  const lastCall = spawnMock.mock.calls[0];
  assert.strictEqual(lastCall.arguments[2]?.cwd, cwd);
  
  spawnMock.mock.restore();
});

test('GeminiCliRunner.runPrompt should return raw output in response and raw_output', async (t) => {
  const runner = new GeminiCliRunner();
  const mockChild = createMockChild();
  const spawnMock = mock.method(child_process, 'spawn', () => mockChild);

  const promise = runner.runPrompt('test prompt');
  
  mockChild.stdout.emit('data', Buffer.from('this is fine now'));
  mockChild.emit('close', 0);
  
  const result = await promise;
  
  assert.ok(result);
  assert.strictEqual(result?.response, 'this is fine now');
  assert.strictEqual(result?.raw_output, 'this is fine now\n--- STDERR ---\n');
  
  spawnMock.mock.restore();
});

test('GeminiCliRunner.runPrompt should write to logPath if provided', async (t) => {
  const runner = new GeminiCliRunner();
  const mockChild = createMockChild();
  const spawnMock = mock.method(child_process, 'spawn', () => mockChild);
  
  const mockWriteStream = new EventEmitter() as any;
  mockWriteStream.write = mock.fn();
  mockWriteStream.end = mock.fn();
  
  const createWriteStreamMock = mock.method(fs, 'createWriteStream', () => mockWriteStream);

  const logPath = 'test.log';
  const promise = runner.runPrompt('test prompt', undefined, undefined, logPath);
  
  mockChild.stdout.emit('data', Buffer.from('stdout data'));
  mockChild.stderr.emit('data', Buffer.from('stderr data'));
  mockChild.emit('close', 0);
  
  await promise;
  
  assert.strictEqual(createWriteStreamMock.mock.callCount(), 1);
  assert.strictEqual(createWriteStreamMock.mock.calls[0].arguments[0], logPath);
  
  // Verify writes occurred
  const writeCalls = mockWriteStream.write.mock.calls;
  assert.ok(writeCalls.some((c: any) => c.arguments[0].includes('stdout data')));
  assert.ok(writeCalls.some((c: any) => c.arguments[0].includes('stderr data')));
  assert.ok(mockWriteStream.end.mock.callCount() >= 1);
  
  spawnMock.mock.restore();
  createWriteStreamMock.mock.restore();
});
