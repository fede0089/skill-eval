import path from 'path';
import fs from 'fs';
import { executor } from './exec.js';
import { ExecutionError } from '../core/errors.js';

export const git = {
  /**
   * Extracts the skill's repository at `ref` into `targetDir` and returns where the
   * skill itself landed inside it.
   *
   * The archive is of the *skill's* repository, so the skill's location within
   * targetDir is relative to that repo root. Callers must not recompute it against
   * the workspace under evaluation: the two coincide only when the skill lives
   * inside the workspace, and when they diverge the path escapes targetDir and the
   * historical variant silently runs with no skill at all.
   */
  extractSkillRef(skillPath: string, ref: string, targetDir: string): string {
    // 1. Identify repo root
    let repoRoot: string;
    try {
      repoRoot = executor.execSync('git rev-parse --show-toplevel', { cwd: skillPath }).toString().trim();
    } catch (err) {
      throw new ExecutionError(`Path is not inside a git repository: ${skillPath}`);
    }

    // 2. Ask git where the skill sits inside its own repo, rather than subtracting two
    // paths in Node. On a case-insensitive filesystem the two sides can disagree on
    // spelling — git reports the on-disk casing while a caller-supplied path keeps its
    // own, and realpath does not reconcile them — and the difference yields a relative
    // path that climbs out of the extraction directory.
    const relativeSkillPath = executor
      .execSync('git rev-parse --show-prefix', { cwd: skillPath })
      .toString()
      .trim();

    // 3. Create target directory
    fs.mkdirSync(targetDir, { recursive: true });

    // 4. Extract via git archive
    try {
      const cmd = `git archive ${ref} | tar -x -C ${targetDir}`;
      executor.execSync(cmd, { cwd: repoRoot });
    } catch (err) {
      throw new ExecutionError(`Failed to extract git reference '${ref}': ${err instanceof Error ? err.message : String(err)}`);
    }

    return path.resolve(targetDir, relativeSkillPath);
  }
};

// Also keep named export for backward compatibility if needed
export const extractSkillRef = git.extractSkillRef;
