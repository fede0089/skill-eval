import { test, describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert';
import fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadEvalSuite } from '../../src/utils/eval-loader.js';
import { ConfigError } from '../../src/core/errors.js';

describe('EvalLoader', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should throw ConfigError if evals directory does not exist', () => {
    assert.throws(() => {
      loadEvalSuite(path.join(tempDir, 'non-existent'));
    }, (err) => {
      return err instanceof ConfigError && err.message.includes('Could not find evals directory');
    });
  });

  it('should map should_trigger and leave it undefined when absent', () => {
    const skillPath = path.join(tempDir, 'skill');
    const evalsDir = path.join(skillPath, 'evals');
    fs.mkdirSync(evalsDir, { recursive: true });

    fs.writeFileSync(path.join(evalsDir, 'evals.json'), JSON.stringify({
      skill_name: 'test-skill',
      evals: [
        { id: 1, prompt: 'positive' },
        { id: 2, prompt: 'negative', should_trigger: false },
        { id: 3, prompt: 'explicit positive', should_trigger: true }
      ]
    }));

    const result = loadEvalSuite(skillPath);
    assert.strictEqual(result.tasks[0].should_trigger, undefined);
    assert.strictEqual(result.tasks[1].should_trigger, false);
    assert.strictEqual(result.tasks[2].should_trigger, true);
  });

  it('should throw ConfigError if should_trigger is not a boolean', () => {
    const skillPath = path.join(tempDir, 'skill');
    const evalsDir = path.join(skillPath, 'evals');
    fs.mkdirSync(evalsDir, { recursive: true });

    fs.writeFileSync(path.join(evalsDir, 'evals.json'), JSON.stringify({
      skill_name: 'test-skill',
      evals: [{ id: 1, prompt: 'p', should_trigger: 'false' }]
    }));

    assert.throws(() => {
      loadEvalSuite(skillPath);
    }, (err) => {
      return err instanceof ConfigError && err.message.includes("Invalid 'should_trigger' for eval 1");
    });
  });

  it('should throw ConfigError if no JSON files found', () => {
    const skillPath = path.join(tempDir, 'skill');
    fs.mkdirSync(path.join(skillPath, 'evals'), { recursive: true });
    assert.throws(() => {
      loadEvalSuite(skillPath);
    }, (err) => {
      return err instanceof ConfigError && err.message.includes('No JSON evaluation files found');
    });
  });

  it('should load and merge multiple JSON files using standard "evals" and "expectations" keys', () => {
    const skillPath = path.join(tempDir, 'skill');
    const evalsDir = path.join(skillPath, 'evals');
    fs.mkdirSync(evalsDir, { recursive: true });

    const file1 = {
      skill_name: 'test-skill',
      evals: [{ id: 1, prompt: 'prompt1', expectations: ['exp 1'] }]
    };
    const file2 = {
      skill_name: 'test-skill',
      evals: [{ id: 2, prompt: 'prompt2', expectations: ['exp 2'] }]
    };

    fs.writeFileSync(path.join(evalsDir, 'evals1.json'), JSON.stringify(file1));
    fs.writeFileSync(path.join(evalsDir, 'evals2.json'), JSON.stringify(file2));

    const result = loadEvalSuite(skillPath);
    assert.strictEqual(result.skill_name, 'test-skill');
    assert.strictEqual(result.tasks.length, 2);
    assert.strictEqual(result.tasks[0].id, 1);
    assert.strictEqual(result.tasks[0].assertions![0], 'exp 1');
    assert.strictEqual(result.tasks[1].id, 2);
    assert.strictEqual(result.tasks[1].assertions![0], 'exp 2');
  });

  it('should support numeric IDs in evaluations', () => {
    const skillPath = path.join(tempDir, 'skill');
    const evalsDir = path.join(skillPath, 'evals');
    fs.mkdirSync(evalsDir, { recursive: true });

    const file = {
      skill_name: 'test-skill',
      evals: [{ id: 1, prompt: 'prompt1' }]
    };

    fs.writeFileSync(path.join(evalsDir, 'evals.json'), JSON.stringify(file));

    const result = loadEvalSuite(skillPath);
    assert.strictEqual(result.tasks[0].id, 1);
  });

  it('should throw ConfigError if ID is not a number', () => {
    const skillPath = path.join(tempDir, 'skill');
    const evalsDir = path.join(skillPath, 'evals');
    fs.mkdirSync(evalsDir, { recursive: true });

    const file = {
      skill_name: 'test-skill',
      evals: [{ id: 'string-id', prompt: 'prompt1' }]
    };

    fs.writeFileSync(path.join(evalsDir, 'evals.json'), JSON.stringify(file));

    assert.throws(() => {
      loadEvalSuite(skillPath);
    }, (err) => {
      return err instanceof ConfigError && err.message.includes('ID must be a number');
    });
  });

  it('should throw if skill names mismatch', () => {
    const skillPath = path.join(tempDir, 'skill');
    const evalsDir = path.join(skillPath, 'evals');
    fs.mkdirSync(evalsDir, { recursive: true });

    const file1 = {
      skill_name: 'skill1',
      evals: [{ id: 1, prompt: 'prompt1' }]
    };
    const file2 = {
      skill_name: 'skill2',
      evals: [{ id: 2, prompt: 'prompt2' }]
    };

    fs.writeFileSync(path.join(evalsDir, 'a.json'), JSON.stringify(file1));
    fs.writeFileSync(path.join(evalsDir, 'b.json'), JSON.stringify(file2));

    assert.throws(() => {
      loadEvalSuite(skillPath);
    }, (err) => {
      return err instanceof ConfigError && err.message.includes('Skill name mismatch');
    });
  });

  it('should load only the requested eval file', () => {
    const skillPath = path.join(tempDir, 'skill');
    const evalsDir = path.join(skillPath, 'evals');
    fs.mkdirSync(evalsDir, { recursive: true });

    fs.writeFileSync(path.join(evalsDir, 'license.json'), JSON.stringify({
      skill_name: 'test-skill',
      evals: [{ id: 1, prompt: 'prompt1' }]
    }));
    fs.writeFileSync(path.join(evalsDir, 'edge-cases.json'), JSON.stringify({
      skill_name: 'test-skill',
      evals: [{ id: 2, prompt: 'prompt2' }, { id: 3, prompt: 'prompt3' }]
    }));

    const result = loadEvalSuite(skillPath, 'edge-cases.json');
    assert.strictEqual(result.skill_name, 'test-skill');
    assert.deepStrictEqual(result.tasks.map(t => t.id), [2, 3]);
  });

  it('should resolve the eval file with or without extension, and from a path', () => {
    const skillPath = path.join(tempDir, 'skill');
    const evalsDir = path.join(skillPath, 'evals');
    fs.mkdirSync(evalsDir, { recursive: true });

    fs.writeFileSync(path.join(evalsDir, 'a.json'), JSON.stringify({
      skill_name: 'test-skill',
      evals: [{ id: 1, prompt: 'prompt1' }]
    }));
    fs.writeFileSync(path.join(evalsDir, 'edge-cases.json'), JSON.stringify({
      skill_name: 'test-skill',
      evals: [{ id: 2, prompt: 'prompt2' }]
    }));

    for (const name of ['edge-cases', 'edge-cases.json', path.join(evalsDir, 'edge-cases.json')]) {
      const result = loadEvalSuite(skillPath, name);
      assert.deepStrictEqual(result.tasks.map(t => t.id), [2], `failed for '${name}'`);
    }
  });

  it('should throw ConfigError listing available files when the eval file is missing', () => {
    const skillPath = path.join(tempDir, 'skill');
    const evalsDir = path.join(skillPath, 'evals');
    fs.mkdirSync(evalsDir, { recursive: true });

    fs.writeFileSync(path.join(evalsDir, 'a.json'), JSON.stringify({
      skill_name: 'test-skill',
      evals: [{ id: 1, prompt: 'prompt1' }]
    }));
    fs.writeFileSync(path.join(evalsDir, 'b.json'), JSON.stringify({
      skill_name: 'test-skill',
      evals: [{ id: 2, prompt: 'prompt2' }]
    }));

    assert.throws(() => {
      loadEvalSuite(skillPath, 'missing.json');
    }, (err) => {
      return err instanceof ConfigError
        && err.message.includes("missing.json")
        && err.message.includes('a.json, b.json');
    });
  });

  it('should ignore files that were filtered out when checking skill name consistency', () => {
    const skillPath = path.join(tempDir, 'skill');
    const evalsDir = path.join(skillPath, 'evals');
    fs.mkdirSync(evalsDir, { recursive: true });

    fs.writeFileSync(path.join(evalsDir, 'a.json'), JSON.stringify({
      skill_name: 'skill1',
      evals: [{ id: 1, prompt: 'prompt1' }]
    }));
    fs.writeFileSync(path.join(evalsDir, 'b.json'), JSON.stringify({
      skill_name: 'skill2',
      evals: [{ id: 2, prompt: 'prompt2' }]
    }));

    const result = loadEvalSuite(skillPath, 'b.json');
    assert.strictEqual(result.skill_name, 'skill2');
    assert.deepStrictEqual(result.tasks.map(t => t.id), [2]);
  });
});

// Helper for afterEach since node:test doesn't have it natively in some versions
function afterEach(fn: () => void) {
  // This is a simplified mock of afterEach
}
