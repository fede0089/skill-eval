import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadEvals } from '../../src/utils/eval-loader';
import { ConfigError } from '../../src/core/errors';

describe('EvalLoader', () => {
  let tempDir: string;

  before(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-test-'));
  });

  after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should throw ConfigError if evals directory does not exist', () => {
    assert.throws(() => {
      loadEvals(path.join(tempDir, 'non-existent'));
    }, (err: any) => {
      return err instanceof ConfigError && err.message.includes('Could not find evals directory');
    });
  });

  it('should throw ConfigError if no JSON files are found', () => {
    const skillPath = path.join(tempDir, 'no-json');
    fs.mkdirSync(path.join(skillPath, 'evals'), { recursive: true });
    
    assert.throws(() => {
      loadEvals(skillPath);
    }, (err: any) => {
      return err instanceof ConfigError && err.message.includes('No JSON evaluation files found');
    });
  });

  it('should successfully merge multiple JSON files with same skill_name', () => {
    const skillPath = path.join(tempDir, 'valid-merge');
    const evalsDir = path.join(skillPath, 'evals');
    fs.mkdirSync(evalsDir, { recursive: true });

    const file1 = {
      skill_name: 'test-skill',
      evals: [{ id: '1', prompt: 'prompt1' }]
    };
    const file2 = {
      skill_name: 'test-skill',
      evals: [{ id: '2', prompt: 'prompt2' }]
    };

    fs.writeFileSync(path.join(evalsDir, 'evals1.json'), JSON.stringify(file1));
    fs.writeFileSync(path.join(evalsDir, 'evals2.json'), JSON.stringify(file2));

    const result = loadEvals(skillPath);
    assert.strictEqual(result.skill_name, 'test-skill');
    assert.strictEqual(result.evals.length, 2);
    assert.strictEqual(result.evals[0].id, '1');
    assert.strictEqual(result.evals[1].id, '2');
  });

  it('should throw ConfigError if skill_name mismatches', () => {
    const skillPath = path.join(tempDir, 'mismatch');
    const evalsDir = path.join(skillPath, 'evals');
    fs.mkdirSync(evalsDir, { recursive: true });

    const file1 = {
      skill_name: 'skill-a',
      evals: [{ id: '1', prompt: 'prompt1' }]
    };
    const file2 = {
      skill_name: 'skill-b',
      evals: [{ id: '2', prompt: 'prompt2' }]
    };

    fs.writeFileSync(path.join(evalsDir, 'a.json'), JSON.stringify(file1));
    fs.writeFileSync(path.join(evalsDir, 'b.json'), JSON.stringify(file2));

    assert.throws(() => {
      loadEvals(skillPath);
    }, (err: any) => {
      return err instanceof ConfigError && err.message.includes('Skill name mismatch');
    });
  });

  it('should throw ConfigError if JSON is malformed', () => {
    const skillPath = path.join(tempDir, 'malformed');
    const evalsDir = path.join(skillPath, 'evals');
    fs.mkdirSync(evalsDir, { recursive: true });

    fs.writeFileSync(path.join(evalsDir, 'bad.json'), '{ invalid json }');

    assert.throws(() => {
      loadEvals(skillPath);
    }, (err: any) => {
      return err instanceof ConfigError && err.message.includes('Failed to parse bad.json');
    });
  });

  it('should throw ConfigError if required fields are missing', () => {
    const skillPath = path.join(tempDir, 'missing-fields');
    const evalsDir = path.join(skillPath, 'evals');
    fs.mkdirSync(evalsDir, { recursive: true });

    const incomplete = { evals: [] };
    fs.writeFileSync(path.join(evalsDir, 'incomplete.json'), JSON.stringify(incomplete));

    assert.throws(() => {
      loadEvals(skillPath);
    }, (err: any) => {
      return err instanceof ConfigError && err.message.includes('Invalid format in incomplete.json');
    });
  });
});
