import * as fs from 'fs';
import * as path from 'path';
import { ConfigError } from './errors.js';

/**
 * Directory that separates the two parts of a skill. Everything under it is the
 * benchmark — evals, expectations, fixtures and the evaluation config of both
 * measuring roles. Everything else in the skill is the implementation: what
 * tells the agent how to work, and the only part a trial ever sees.
 */
export const BENCHMARK_DIRNAME = 'evals';

/** Name of the frozen copy inside a run directory. */
const FROZEN_DIRNAME = 'benchmark';

export interface FrozenBenchmark {
  /** The frozen copy every variant of the run is measured with. */
  dir: string;
  /** The skill's benchmark directory the copy was taken from. */
  source: string;
  /** Eval files the frozen copy holds, sorted so the report reads the same twice. */
  evalFiles: string[];
}

/**
 * Copies the skill's benchmark into the run directory and returns the frozen copy.
 *
 * Every variant of the run is then measured with this copy — including the
 * evaluation config of the executor and judge roles — so a historical ref
 * contributes only its implementation and the numbers stay comparable even when
 * the benchmark changed between the two versions.
 *
 * The copy lives with the run's evidence and survives it: it is the record of
 * what the run actually measured.
 *
 * @throws ConfigError if the skill has no benchmark directory.
 */
export function freezeBenchmark(skillPath: string, runDir: string): FrozenBenchmark {
  const source = path.resolve(skillPath, BENCHMARK_DIRNAME);

  if (!fs.existsSync(source)) {
    throw new ConfigError(
      `No '${BENCHMARK_DIRNAME}/' directory found inside '${skillPath}'. ` +
      `Create an ${BENCHMARK_DIRNAME}/ directory with at least one JSON evaluation file.`
    );
  }

  const dir = path.resolve(runDir, FROZEN_DIRNAME);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(source, dir, { recursive: true });

  const evalFiles = fs.readdirSync(dir).filter(file => file.endsWith('.json')).sort();

  return { dir, source, evalFiles };
}

/**
 * Copies the skill's implementation — everything except its benchmark — under
 * `targetDir`, and returns where it landed.
 *
 * This is what the trial environment links, so the evaluated agent never finds
 * the expectations it is being graded with. It is also how a historical variant
 * reaches a trial: the extracted copy of the ref goes in, its implementation
 * comes out, and its benchmark is left behind.
 */
export function materializeImplementation(skillPath: string, targetDir: string): string {
  const source = path.resolve(skillPath);
  // Only the benchmark at the root of the skill is excluded. A nested directory
  // that happens to share the name belongs to the implementation.
  const benchmarkDir = path.join(source, BENCHMARK_DIRNAME);
  const target = path.resolve(targetDir, path.basename(source));

  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });
  fs.cpSync(source, target, {
    recursive: true,
    filter: (src) => path.resolve(src) !== benchmarkDir
  });

  return target;
}
