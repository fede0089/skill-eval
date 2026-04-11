import type { EvalSuiteReport } from '../../types/index.js';

export interface Reporter {
  /** Generate the human-facing report artifact. summary.json is already written by the caller. */
  generate(report: EvalSuiteReport, runDir: string): void;
}
