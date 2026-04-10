import * as fs from 'fs';
import * as path from 'path';
import { EvalSuite, EvalTask } from '../types/index.js';
import { ConfigError } from '../core/errors.js';

/**
 * Loads and merges all JSON evaluation files from a skill's evals directory.
 * Aligned with Anthropic's recommendation to split evals by capability/regression.
 * Supports legacy 'tasks' and 'assertions' internally while maintaining 'evals' and 'expectations' in files.
 */
export function loadEvalSuite(skillPath: string): EvalSuite {
  const evalsDir = path.resolve(skillPath, 'evals');

  if (!fs.existsSync(evalsDir)) {
    throw new ConfigError(`Could not find evals directory at ${evalsDir}`);
  }

  const files = fs.readdirSync(evalsDir).filter(file => file.endsWith('.json'));

  if (files.length === 0) {
    throw new ConfigError(`No JSON evaluation files found in ${evalsDir}`);
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
    const mappedTasks: EvalTask[] = rawEvals.map((e: any) => ({
      id: e.id,
      prompt: e.prompt,
      expected_output: e.expected_output,
      assertions: e.expectations || e.assertions,
      files: e.files
    }));

    mergedTasks.push(...mappedTasks);
  }

  if (mergedTasks.length === 0) {
    throw new ConfigError(`No evaluations found in any of the JSON files in ${evalsDir}`);
  }

  return {
    skill_name: mergedSkillName,
    tasks: mergedTasks
  };
}

// Backwards compatibility alias
export const loadEvals = loadEvalSuite;
