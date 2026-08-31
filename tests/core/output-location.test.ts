import { test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveOutputDir } from '../../src/core/output-location.js';
import { ConfigError } from '../../src/core/errors.js';

// Real filesystem paths under os.tmpdir() are used throughout: on macOS the temp
// directory is itself a symlink, so these cases also exercise the canonicalization
// that keeps a symlinked location from slipping past the containment check.

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-output-test-'));
}

test('resolveOutputDir: falls back to a per-skill directory under the user home', () => {
  const workspace = makeTempDir();

  try {
    const resolved = resolveOutputDir({
      skillName: 'license-generator',
      workspace,
      skillPath: workspace
    });

    assert.strictEqual(resolved, path.join(os.homedir(), '.skill-eval', 'license-generator'));
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('resolveOutputDir: uses --output as the root, keeping the per-skill layout', () => {
  const workspace = makeTempDir();
  const output = makeTempDir();

  try {
    const resolved = resolveOutputDir({
      output,
      skillName: 'license-generator',
      workspace,
      skillPath: workspace
    });

    assert.strictEqual(resolved, path.join(output, 'license-generator'));
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(output, { recursive: true, force: true });
  }
});

test('resolveOutputDir: throws ConfigError when the location resolves inside the workspace', () => {
  const workspace = makeTempDir();

  try {
    assert.throws(
      () => resolveOutputDir({
        output: path.join(workspace, 'evals-output'),
        skillName: 'license-generator',
        workspace,
        skillPath: workspace
      }),
      (err: unknown) => err instanceof ConfigError && err.message.includes('inside the workspace'),
      'Should reject a location under the workspace under evaluation'
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('resolveOutputDir: throws ConfigError when the location resolves inside the skill', () => {
  const workspace = makeTempDir();
  // The skill lives outside the workspace so the workspace rule cannot fire first.
  const skillPath = makeTempDir();

  try {
    assert.throws(
      () => resolveOutputDir({
        output: path.join(skillPath, 'evals-output'),
        skillName: 'license-generator',
        workspace,
        skillPath
      }),
      (err: unknown) => err instanceof ConfigError && err.message.includes('inside the skill'),
      'Should reject a location under the skill directory'
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(skillPath, { recursive: true, force: true });
  }
});

test('resolveOutputDir: accepts a location outside both the workspace and the skill', () => {
  const workspace = makeTempDir();
  const skillPath = path.join(workspace, 'mock-skill');
  fs.mkdirSync(skillPath);
  const output = makeTempDir();

  try {
    assert.doesNotThrow(() => resolveOutputDir({
      output,
      skillName: 'license-generator',
      workspace,
      skillPath
    }));
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(output, { recursive: true, force: true });
  }
});

test('resolveOutputDir: keeps a skill name with a separator inside the artifacts root', () => {
  const workspace = makeTempDir();
  const output = makeTempDir();

  try {
    const resolved = resolveOutputDir({
      output,
      skillName: 'scoped/license generator',
      workspace,
      skillPath: workspace
    });

    assert.strictEqual(path.dirname(resolved), output, 'Skill name must not escape the artifacts root');
    assert.strictEqual(path.basename(resolved), 'scoped-license-generator');
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(output, { recursive: true, force: true });
  }
});
