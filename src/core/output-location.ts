import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigError } from './errors.js';

/** Root under the user's home directory used when --output is not given. */
export const DEFAULT_OUTPUT_ROOT = '.skill-eval';

export interface OutputLocationOptions {
  /** Value of --output, or undefined to fall back to the user directory. */
  output?: string;
  /** Skill name declared by the eval suite; names the per-skill subdirectory. */
  skillName: string;
  workspace: string;
  skillPath: string;
}

/**
 * Replaces characters that are unsafe in a path segment so a skill name like
 * 'my/skill' cannot escape the artifacts root.
 */
function slugifySkillName(name: string): string {
  const slug = name.replace(/[^a-zA-Z0-9_.-]+/g, '-').replace(/^[-.]+|-+$/g, '');
  return slug || 'skill';
}

/**
 * Resolves symlinks as far up the path as it exists, so a location that only
 * looks outside the workspace cannot slip past the containment check.
 */
function canonicalize(target: string): string {
  let existing = path.resolve(target);
  const trailing: string[] = [];

  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) return path.resolve(target);
    trailing.unshift(path.basename(existing));
    existing = parent;
  }

  try {
    return path.join(fs.realpathSync(existing), ...trailing);
  } catch {
    return path.resolve(target);
  }
}

/** True when `child` is `parent` itself or lives underneath it. */
function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Resolves the root under which every artifact of a run is written — the run
 * directory with its report and trial logs, the isolated trial worktrees and
 * the extracted copies of historical refs.
 *
 * Nothing the tool generates may land inside the workspace under evaluation or
 * inside the skill: the evaluated agent explores both, and finding reports or
 * transcripts from earlier runs there contaminates the measurement.
 *
 * @throws ConfigError if the resolved root is inside the workspace or the skill.
 */
export function resolveOutputDir(options: OutputLocationOptions): string {
  const { output, skillName, workspace, skillPath } = options;

  const root = output !== undefined
    ? path.resolve(output)
    : path.join(os.homedir(), DEFAULT_OUTPUT_ROOT);

  const artifactsDir = path.join(root, slugifySkillName(skillName));

  const canonicalArtifacts = canonicalize(artifactsDir);
  const canonicalWorkspace = canonicalize(workspace);
  const canonicalSkill = canonicalize(path.resolve(workspace, skillPath));

  if (isInside(canonicalArtifacts, canonicalWorkspace)) {
    throw new ConfigError(
      `Output location '${artifactsDir}' resolves inside the workspace under evaluation (${canonicalWorkspace}). ` +
      `Artifacts must live outside the workspace and outside the skill so the evaluated agent never finds them. ` +
      `Pass --output with a path outside both, or omit it to use ~/${DEFAULT_OUTPUT_ROOT}.`
    );
  }

  if (isInside(canonicalArtifacts, canonicalSkill)) {
    throw new ConfigError(
      `Output location '${artifactsDir}' resolves inside the skill (${canonicalSkill}). ` +
      `Artifacts must live outside the workspace and outside the skill so the evaluated agent never finds them. ` +
      `Pass --output with a path outside both, or omit it to use ~/${DEFAULT_OUTPUT_ROOT}.`
    );
  }

  return artifactsDir;
}
