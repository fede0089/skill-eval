import * as fs from 'fs';
import * as path from 'path';
import { EvalFile, Eval } from '../types';
import { ConfigError } from '../core/errors';

/**
 * Loads and merges all JSON evaluation files from a skill's evals directory.
 * Following Anthropic's recommendation to split evals by capability/regression.
 */
export function loadEvals(skillPath: string): EvalFile {
  const evalsDir = path.resolve(skillPath, 'evals');

  if (!fs.existsSync(evalsDir)) {
    throw new ConfigError(`Could not find evals directory at ${evalsDir}`);
  }

  const files = fs.readdirSync(evalsDir).filter(file => file.endsWith('.json'));

  if (files.length === 0) {
    throw new ConfigError(`No JSON evaluation files found in ${evalsDir}`);
  }

  let mergedSkillName = '';
  const mergedEvals: Eval[] = [];

  for (const file of files) {
    const filePath = path.join(evalsDir, file);
    let config: EvalFile;

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      config = JSON.parse(raw);
    } catch (err) {
      throw new ConfigError(`Failed to parse ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }

    const { skill_name, evals } = config;

    if (!skill_name || !Array.isArray(evals)) {
      throw new ConfigError(`Invalid format in ${file}. Expected 'skill_name' and 'evals' array.`);
    }

    if (!mergedSkillName) {
      mergedSkillName = skill_name;
    } else if (mergedSkillName !== skill_name) {
      throw new ConfigError(
        `Skill name mismatch in ${file}. Expected '${mergedSkillName}' but found '${skill_name}'.`
      );
    }

    mergedEvals.push(...evals);
  }

  if (mergedEvals.length === 0) {
    throw new ConfigError(`No evaluations found in any of the JSON files in ${evalsDir}`);
  }

  return {
    skill_name: mergedSkillName,
    evals: mergedEvals
  };
}
