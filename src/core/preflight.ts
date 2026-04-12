import * as fs from 'fs';
import * as path from 'path';
import { executor } from '../utils/exec.js';
import { ConfigError, ExecutionError } from './errors.js';
import { RUNNER_REGISTRY } from '../runners/registry.js';

/**
 * Validates that the environment is ready to run an evaluation before any
 * worktrees are created or trials are started.
 *
 * Checks:
 * 1. The agent binary is installed and on PATH.
 * 2. The skill path exists and contains an `evals/` subdirectory.
 *
 * @throws ExecutionError if the agent binary is not found.
 * @throws ConfigError if the skill path or its evals/ directory is missing.
 */
export function preflight(agent: string, workspace: string, skillPath: string): void {
  const binary = RUNNER_REGISTRY[agent]?.binary ?? agent;

  try {
    executor.execSync(`which ${binary}`, { stdio: 'ignore' });
  } catch {
    throw new ExecutionError(
      `Agent binary '${binary}' not found on PATH. ` +
      `Please install it before running an evaluation (agent: '${agent}').`
    );
  }

  const absoluteSkillPath = path.resolve(workspace, skillPath);

  if (!fs.existsSync(absoluteSkillPath)) {
    throw new ConfigError(
      `Skill path '${skillPath}' does not exist. ` +
      `Provide the path to a directory containing a SKILL.md and an evals/ subdirectory.`
    );
  }

  const evalsDir = path.join(absoluteSkillPath, 'evals');
  if (!fs.existsSync(evalsDir)) {
    throw new ConfigError(
      `No 'evals/' directory found inside '${skillPath}'. ` +
      `Create an evals/ directory with at least one JSON evaluation file.`
    );
  }
}
