import { test, mock } from 'node:test';
import assert from 'node:assert';
import { GeminiCliRunner } from '../../../src/core/runners/gemini-cli.runner.js';
import child_process from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * Helper to mock the spawn process
 */
function createMockChild() {
  const child = new EventEmitter() as any;
  child.stdout = new Readable({
    read() {}
  });
  child.stderr = new Readable({
    read() {}
  });
  child.kill = mock.fn();
  return child;
}

test('GeminiCliRunner.runPrompt should use --approval-mode auto_edit by default', async (t) => {
  const mockChild = createMockChild();
  const spawnMock = mock.method(child_process, 'spawn', () => mockChild);

  const runner = new GeminiCliRunner();
  const promise = runner.runPrompt('test prompt');

  setImmediate(() => {
    mockChild.stdout.push('hello world');
    mockChild.stdout.push(null);
    mockChild.stderr.push(null);
    mockChild.emit('close', 0);
  });

  await promise;
  
  assert.ok(spawnMock.mock.callCount() >= 1, 'spawn should have been called');
  const lastCall = spawnMock.mock.calls[0];
  const args = lastCall.arguments[1];
  
  assert.ok(args.includes('-p'), 'Should include -p');
  assert.strictEqual(args[args.indexOf('-p') + 1], 'test prompt');
  
  spawnMock.mock.restore();
});

test('GeminiCliRunner.runPrompt should include --output-format stream-json when passed in extraArgs', async (t) => {
  const mockChild = createMockChild();
  const spawnMock = mock.method(child_process, 'spawn', () => mockChild);

  const runner = new GeminiCliRunner();
  const promise = runner.runPrompt('test prompt', undefined, undefined, undefined, ['--output-format', 'stream-json']);

  setImmediate(() => {
    mockChild.stdout.push('{"type": "tool_use", "tool_id": "1", "tool_name": "activate_skill", "parameters": { "name": "mock-skill" }}');
    mockChild.stdout.push(null);
    mockChild.stderr.push(null);
    mockChild.emit('close', 0);
  });

  await promise;
  
  assert.ok(spawnMock.mock.callCount() >= 1, 'spawn should have been called');
  const lastCall = spawnMock.mock.calls[0];
  const args = lastCall.arguments[1];
  
  assert.ok(args.includes('--output-format'), 'Should include --output-format');
  assert.strictEqual(args[args.indexOf('--output-format') + 1], 'stream-json');
  
  spawnMock.mock.restore();
});

test('GeminiCliRunner.runPrompt should pass cwd to spawn', async (t) => {
  const mockChild = createMockChild();
  const spawnMock = mock.method(child_process, 'spawn', () => mockChild);

  const runner = new GeminiCliRunner();
  const cwd = '/some/path';
  const promise = runner.runPrompt('test prompt', cwd);

  setImmediate(() => {
    mockChild.stdout.push('ok');
    mockChild.stdout.push(null);
    mockChild.stderr.push(null);
    mockChild.emit('close', 0);
  });
  await promise;

  assert.ok(spawnMock.mock.callCount() >= 1, 'spawn should have been called');
  const lastCall = spawnMock.mock.calls[0];
  assert.strictEqual(lastCall.arguments[2]?.cwd, cwd);
  
  spawnMock.mock.restore();
});

test('GeminiCliRunner.runPrompt should return raw output in response and raw_output', async (t) => {
  const mockChild = createMockChild();
  const spawnMock = mock.method(child_process, 'spawn', () => mockChild);

  const runner = new GeminiCliRunner();
  const promise = runner.runPrompt('test prompt');
  
  setImmediate(() => {
    mockChild.stdout.push('this is fine now');
    mockChild.stdout.push(null);
    mockChild.stderr.push(null);
    mockChild.emit('close', 0);
  });
  
  const result = await promise;
  
  assert.ok(result, 'result should be defined');
  assert.strictEqual(result?.response, 'this is fine now');
  
  spawnMock.mock.restore();
});

test('GeminiCliRunner.runPrompt should write to logPath if provided', async (t) => {
  const mockChild = createMockChild();
  const spawnMock = mock.method(child_process, 'spawn', () => mockChild);
  
  const runner = new GeminiCliRunner();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-test-'));
  const logPath = path.join(tempDir, 'test.log');

  const promise = runner.runPrompt('test prompt', undefined, undefined, logPath);
  
  setImmediate(() => {
    mockChild.stdout.push('stdout data');
    mockChild.stdout.push(null);
    mockChild.stderr.push('stderr data');
    mockChild.stderr.push(null);
    mockChild.emit('close', 0);
  });
  
  await promise;
  
  assert.ok(fs.existsSync(logPath), 'Log file should exist');
  const content = fs.readFileSync(logPath, 'utf-8');
  assert.ok(content.includes('stdout data'), 'Log should contain stdout');
  assert.ok(content.includes('stderr data'), 'Log should contain stderr');
  
  spawnMock.mock.restore();
  fs.rmSync(tempDir, { recursive: true, force: true });
});
