import { test, mock } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { executor } from '../../src/utils/exec.js';
import { preflight } from '../../src/core/preflight.js';
import { ExecutionError, ConfigError } from '../../src/core/errors.js';

// executor.execSync is injected via the wrapper object and IS configurable.
// fs.existsSync is non-configurable in this Node version, so we use real filesystem paths.

test('preflight: throws ExecutionError when agent binary is not on PATH', () => {
  mock.method(executor, 'execSync', mock.fn(() => { throw new Error('not found'); }));

  assert.throws(
    () => preflight('gemini-cli', process.cwd(), './mock-skill'),
    (err) => err instanceof ExecutionError && err.message.includes("'gemini'"),
    'Should throw ExecutionError mentioning the binary name'
  );

  mock.reset();
});

test('preflight: uses registered binary name for codex agent', () => {
  const execMock = mock.fn(() => Buffer.from('/usr/bin/codex'));
  mock.method(executor, 'execSync', execMock);

  assert.doesNotThrow(
    () => preflight('codex', process.cwd(), './mock-skill'),
    'Should not throw when codex binary exists and skill path is valid'
  );
  assert.strictEqual(execMock.mock.calls[0].arguments[0], 'which codex');

  mock.reset();
});

test('preflight: throws ConfigError when skill path does not exist', () => {
  mock.method(executor, 'execSync', mock.fn(() => Buffer.from('/usr/bin/gemini')));

  assert.throws(
    () => preflight('gemini-cli', '/', '/nonexistent/skill-path-that-cannot-exist'),
    (err) => err instanceof ConfigError && err.message.includes('does not exist'),
    'Should throw ConfigError about missing skill path'
  );

  mock.reset();
});

test('preflight: throws ConfigError when evals/ directory is missing', () => {
  mock.method(executor, 'execSync', mock.fn(() => Buffer.from('/usr/bin/gemini')));

  // Create a temp dir without an evals/ subdirectory
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-test-'));

  try {
    assert.throws(
      () => preflight('gemini-cli', '/', tempDir),
      (err) => err instanceof ConfigError && err.message.includes("evals/"),
      'Should throw ConfigError about missing evals/ directory'
    );
  } finally {
    fs.rmdirSync(tempDir);
    mock.reset();
  }
});

test('preflight: does not throw when all checks pass', () => {
  mock.method(executor, 'execSync', mock.fn(() => Buffer.from('/usr/bin/gemini')));

  // mock-skill exists and has an evals/ directory
  assert.doesNotThrow(
    () => preflight('gemini-cli', process.cwd(), './mock-skill'),
    'Should not throw when agent binary exists and skill path is valid'
  );

  mock.reset();
});

test('preflight: throws naming the judge role when only the judge binary is missing', () => {
  // With two agents in play, "binary not found" has to say which of the two.
  mock.method(executor, 'execSync', mock.fn((cmd: string) => {
    if (cmd === 'which claude') throw new Error('not found');
    return Buffer.from('/usr/bin/gemini');
  }));

  assert.throws(
    () => preflight('gemini-cli', process.cwd(), './mock-skill', 'claude-code'),
    (err) => err instanceof ExecutionError && err.message.startsWith("Judge agent binary 'claude'"),
    'Should throw ExecutionError naming the judge role and its binary'
  );

  mock.reset();
});

test('preflight: checks one binary when both roles name the same agent', () => {
  const execMock = mock.fn(() => Buffer.from('/usr/bin/gemini'));
  mock.method(executor, 'execSync', execMock);

  preflight('gemini-cli', process.cwd(), './mock-skill', 'gemini-cli');

  assert.strictEqual(execMock.mock.callCount(), 1, 'The same agent in both roles is one binary to verify');

  mock.reset();
});
