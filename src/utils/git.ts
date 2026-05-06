import path from 'path';
import fs from 'fs';
import { executor } from './exec.js';
import { ExecutionError } from '../core/errors.js';

/**
 * Extracts a skill reference from a git repository to a target directory.
 * @param skillPath Path to the skill directory (must be inside a git repo)
 * @param ref Git reference (branch, tag, commit SHA)
 * @param targetDir Target directory to extract to
 */
export function extractSkillRef(skillPath: string, ref: string, targetDir: string): void {
  // 1. Identify repo root
  let repoRoot: string;
  try {
    repoRoot = executor.execSync('git rev-parse --show-toplevel', { cwd: skillPath }).toString().trim();
  } catch (err) {
    throw new ExecutionError(`Path is not inside a git repository: ${skillPath}`);
  }

  // 2. Resolve relative path of skill within repo
  const relativeSkillPath = path.relative(repoRoot, path.resolve(skillPath));

  // 3. Create target directory
  fs.mkdirSync(targetDir, { recursive: true });

  // 4. Extract via git archive
  try {
    const cmd = `git archive ${ref} | tar -x -C ${targetDir}`;
    executor.execSync(cmd, { cwd: repoRoot });
  } catch (err) {
    throw new ExecutionError(`Failed to extract git reference '${ref}': ${err instanceof Error ? err.message : String(err)}`);
  }
}
