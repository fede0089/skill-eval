import * as fs from 'fs';
import * as path from 'path';
import { ConfigError } from './errors.js';
import type { ReportFormat } from '../types/index.js';

export interface SkillEvalConfig {
  agent?: string;
  concurrency?: number;
  trials?: number;
  report?: ReportFormat;
  skill?: string;
}

const CONFIG_FILE = '.skill-eval.json';

/**
 * Loads configuration from a `.skill-eval.json` file in the given directory.
 * Returns an empty object if the file does not exist (config is optional).
 *
 * CLI flags always take precedence over config file values — this function
 * only provides defaults for flags not explicitly passed on the command line.
 *
 * @throws ConfigError on malformed JSON or type mismatches.
 */
export function loadConfig(cwd: string): SkillEvalConfig {
  const configPath = path.join(cwd, CONFIG_FILE);

  if (!fs.existsSync(configPath)) {
    return {};
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (err) {
    throw new ConfigError(
      `Failed to parse ${CONFIG_FILE}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ConfigError(`${CONFIG_FILE} must be a JSON object.`);
  }

  const config = raw as Record<string, unknown>;
  const result: SkillEvalConfig = {};

  if ('agent' in config) {
    if (typeof config.agent !== 'string') throw new ConfigError(`${CONFIG_FILE}: 'agent' must be a string.`);
    result.agent = config.agent;
  }
  if ('concurrency' in config) {
    if (typeof config.concurrency !== 'number') throw new ConfigError(`${CONFIG_FILE}: 'concurrency' must be a number.`);
    result.concurrency = config.concurrency;
  }
  if ('trials' in config) {
    if (typeof config.trials !== 'number') throw new ConfigError(`${CONFIG_FILE}: 'trials' must be a number.`);
    result.trials = config.trials;
  }
  if ('report' in config) {
    if (config.report !== 'html' && config.report !== 'json') {
      throw new ConfigError(`${CONFIG_FILE}: 'report' must be 'html' or 'json'.`);
    }
    result.report = config.report as ReportFormat;
  }
  if ('skill' in config) {
    if (typeof config.skill !== 'string') throw new ConfigError(`${CONFIG_FILE}: 'skill' must be a string.`);
    result.skill = config.skill;
  }

  return result;
}
