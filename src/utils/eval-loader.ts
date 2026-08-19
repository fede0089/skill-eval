import * as fs from 'fs';
import * as path from 'path';
import { EvalSuite, EvalTask } from '../types/index.js';
import { ConfigError } from '../core/errors.js';

/**
 * Normalizes an --eval-file value to the bare file name used inside the evals directory.
 * Accepts 'edge-cases', 'edge-cases.json' and 'path/to/evals/edge-cases.json' alike.
 */
function normalizeEvalFileName(evalFile: string): string {
  const base = path.basename(evalFile.trim());
  return base.endsWith('.json') ? base : `${base}.json`;
}

/**
 * Loads and merges all JSON evaluation files from a skill's evals directory.
 * Aligned with Anthropic's recommendation to split evals by capability/regression.
 * Supports legacy 'tasks' and 'assertions' internally while maintaining 'evals' and 'expectations' in files.
 * When 'evalFile' is given, only that file is loaded instead of the whole suite.
 */
export function loadEvalSuite(skillPath: string, evalFile?: string): EvalSuite {
  const evalsDir = path.resolve(skillPath, 'evals');

  if (!fs.existsSync(evalsDir)) {
    throw new ConfigError(`Could not find evals directory at ${evalsDir}`);
  }

  let files = fs.readdirSync(evalsDir).filter(file => file.endsWith('.json'));

  if (files.length === 0) {
    throw new ConfigError(`No JSON evaluation files found in ${evalsDir}`);
  }

  if (evalFile !== undefined) {
    const wanted = normalizeEvalFileName(evalFile);
    if (!files.includes(wanted)) {
      throw new ConfigError(
        `Eval file '${wanted}' not found in ${evalsDir}. Available: ${[...files].sort().join(', ')}.`
      );
    }
    files = [wanted];
  }

  let mergedSkillName = '';
  const mergedTasks: EvalTask[] = [];

  for (const file of files) {
    const filePath = path.join(evalsDir, file);
    let config: any;

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      config = JSON.parse(raw);
    } catch (err) {
      throw new ConfigError(`Failed to parse ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }

    const skill_name = config.skill_name;
    // Standard input uses 'evals' key
    const rawEvals = config.evals || config.tasks;

    if (!skill_name || !Array.isArray(rawEvals)) {
      throw new ConfigError(`Invalid format in ${file}. Expected 'skill_name' and 'evals' array.`);
    }

    if (!mergedSkillName) {
      mergedSkillName = skill_name;
    } else if (mergedSkillName !== skill_name) {
      throw new ConfigError(
        `Skill name mismatch in ${file}. Expected '${mergedSkillName}' but found '${skill_name}'.`
      );
    }

    // Map input fields to internal terminology
    const mappedTasks: EvalTask[] = rawEvals.map((e: any) => {
      if (e.id === undefined || typeof e.id !== 'number') {
        throw new ConfigError(`Invalid task ID in ${file}. ID must be a number.`);
      }
      if (e.should_trigger !== undefined && typeof e.should_trigger !== 'boolean') {
        throw new ConfigError(`Invalid 'should_trigger' for eval ${e.id} in ${file}. Must be a boolean.`);
      }
      return {
        id: e.id,
        prompt: e.prompt,
        expected_output: e.expected_output,
        assertions: e.expectations || e.assertions,
        files: e.files,
        should_trigger: e.should_trigger
      };
    });

    mergedTasks.push(...mappedTasks);
  }

  if (mergedTasks.length === 0) {
    const scope = evalFile !== undefined ? `${files[0]} in ${evalsDir}` : `any of the JSON files in ${evalsDir}`;
    throw new ConfigError(`No evaluations found in ${scope}`);
  }

  return {
    skill_name: mergedSkillName,
    tasks: mergedTasks
  };
}

// Backwards compatibility alias
export const loadEvals = loadEvalSuite;
