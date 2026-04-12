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
