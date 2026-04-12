import { test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadConfig } from '../../src/core/config.js';
import { ConfigError } from '../../src/core/errors.js';

function withTempDir(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-config-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('loadConfig: returns {} when .skill-eval.json does not exist', () => {
  withTempDir((dir) => {
    const config = loadConfig(dir);
    assert.deepStrictEqual(config, {});
  });
});

test('loadConfig: parses a valid config file correctly', () => {
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, '.skill-eval.json'), JSON.stringify({
      agent: 'gemini-cli',
      concurrency: 3,
      trials: 5,
      report: 'json',
      skill: './my-skill'
    }));

    const config = loadConfig(dir);
    assert.strictEqual(config.agent, 'gemini-cli');
    assert.strictEqual(config.concurrency, 3);
    assert.strictEqual(config.trials, 5);
    assert.strictEqual(config.report, 'json');
    assert.strictEqual(config.skill, './my-skill');
  });
});

test('loadConfig: returns partial config when only some fields are set', () => {
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, '.skill-eval.json'), JSON.stringify({ skill: './my-skill' }));
    const config = loadConfig(dir);
    assert.strictEqual(config.skill, './my-skill');
    assert.strictEqual(config.agent, undefined);
    assert.strictEqual(config.trials, undefined);
  });
});

test('loadConfig: throws ConfigError on malformed JSON', () => {
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, '.skill-eval.json'), '{ invalid json }');
    assert.throws(
      () => loadConfig(dir),
      (err) => err instanceof ConfigError && err.message.includes('Failed to parse'),
      'Should throw ConfigError on malformed JSON'
    );
  });
});

test('loadConfig: throws ConfigError when concurrency is not a number', () => {
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, '.skill-eval.json'), JSON.stringify({ concurrency: 'five' }));
    assert.throws(
      () => loadConfig(dir),
      (err) => err instanceof ConfigError && err.message.includes("'concurrency'"),
      'Should throw ConfigError on type mismatch for concurrency'
    );
  });
});

test('loadConfig: throws ConfigError when report has invalid value', () => {
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, '.skill-eval.json'), JSON.stringify({ report: 'pdf' }));
    assert.throws(
      () => loadConfig(dir),
      (err) => err instanceof ConfigError && err.message.includes("'report'"),
      'Should throw ConfigError on invalid report value'
    );
  });
});

test('loadConfig: throws ConfigError when root is not an object', () => {
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, '.skill-eval.json'), JSON.stringify([1, 2, 3]));
    assert.throws(
      () => loadConfig(dir),
      (err) => err instanceof ConfigError,
      'Should throw ConfigError when root is not an object'
    );
  });
});
