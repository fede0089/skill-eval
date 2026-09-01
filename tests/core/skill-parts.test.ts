import { test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { freezeEvals, materializeImplementation } from '../../src/core/skill-parts.js';
import { ConfigError } from '../../src/core/errors.js';

/** A skill with both parts populated: an implementation around its evals. */
function makeSkill(root: string, name = 'mock-skill'): string {
  const skillPath = path.join(root, name);
  fs.mkdirSync(path.join(skillPath, 'references'), { recursive: true });
  fs.writeFileSync(path.join(skillPath, 'SKILL.md'), '# skill\n');
  fs.writeFileSync(path.join(skillPath, 'references', 'guide.md'), 'guide\n');

  fs.mkdirSync(path.join(skillPath, 'evals', 'config', 'gemini-cli'), { recursive: true });
  fs.writeFileSync(path.join(skillPath, 'evals', 'license.json'), '{"skill_name":"mock-skill","evals":[]}');
  fs.writeFileSync(path.join(skillPath, 'evals', 'edge-cases.json'), '{"skill_name":"mock-skill","evals":[]}');
  fs.writeFileSync(path.join(skillPath, 'evals', 'config', 'gemini-cli', 'settings.json'), '{"local":true}');

  return skillPath;
}

test('materializeImplementation carries the implementation and leaves the evals behind', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-skill-parts-'));
  try {
    const skillPath = makeSkill(root);
    const target = materializeImplementation(skillPath, path.join(root, 'skill-impl', 'local'));

    assert.strictEqual(path.basename(target), 'mock-skill', 'The copy keeps the skill directory name it is linked by');
    assert.ok(fs.existsSync(path.join(target, 'SKILL.md')), 'Expected SKILL.md in the implementation');
    assert.ok(fs.existsSync(path.join(target, 'references', 'guide.md')), 'Expected the implementation subdirectories');
    assert.ok(
      !fs.existsSync(path.join(target, 'evals')),
      'The evaluated agent must not find the expectations it is graded with'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('materializeImplementation excludes only the evals directory at the root of the skill', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-skill-parts-'));
  try {
    const skillPath = makeSkill(root);
    // A directory deeper down that happens to share the name belongs to the implementation.
    fs.mkdirSync(path.join(skillPath, 'references', 'evals'), { recursive: true });
    fs.writeFileSync(path.join(skillPath, 'references', 'evals', 'how-to.md'), 'how to write evals\n');

    const target = materializeImplementation(skillPath, path.join(root, 'skill-impl', 'local'));

    assert.ok(fs.existsSync(path.join(target, 'references', 'evals', 'how-to.md')), 'A nested evals/ is implementation');
    assert.ok(!fs.existsSync(path.join(target, 'evals')), 'The root evals/ is still what measures the skill');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('materializeImplementation replaces an earlier materialization instead of merging into it', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-skill-parts-'));
  try {
    const skillPath = makeSkill(root);
    const targetDir = path.join(root, 'skill-impl', 'local');

    const first = materializeImplementation(skillPath, targetDir);
    fs.writeFileSync(path.join(first, 'STALE.md'), 'left by an earlier run\n');

    const second = materializeImplementation(skillPath, targetDir);

    assert.strictEqual(second, first);
    assert.ok(!fs.existsSync(path.join(second, 'STALE.md')), 'Expected the earlier copy to be gone, not merged into');
    assert.ok(fs.existsSync(path.join(second, 'SKILL.md')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('freezeEvals copies the whole evals directory into the run directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-skill-parts-'));
  try {
    const skillPath = makeSkill(root);
    const runDir = path.join(root, 'runs', '2026-09-01');
    fs.mkdirSync(runDir, { recursive: true });

    const frozen = freezeEvals(skillPath, runDir);

    assert.strictEqual(frozen.dir, path.join(runDir, 'evals'), 'The frozen copy lives with the run evidence');
    assert.strictEqual(frozen.source, path.join(skillPath, 'evals'));
    assert.deepStrictEqual(frozen.evalFiles, ['edge-cases.json', 'license.json']);
    assert.ok(fs.existsSync(path.join(frozen.dir, 'license.json')));
    assert.strictEqual(
      fs.readFileSync(path.join(frozen.dir, 'config', 'gemini-cli', 'settings.json'), 'utf-8'),
      '{"local":true}',
      'The evaluation config of the measuring roles is part of what gets frozen'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('freezeEvals fails when the skill carries no evals', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-skill-parts-'));
  try {
    const skillPath = path.join(root, 'no-evals-skill');
    fs.mkdirSync(skillPath, { recursive: true });
    fs.writeFileSync(path.join(skillPath, 'SKILL.md'), '# skill\n');

    assert.throws(() => freezeEvals(skillPath, root), ConfigError);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
