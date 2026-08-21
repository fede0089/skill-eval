import type { EvalSuiteReport } from '../types/index.js';

export interface Reporter {
  /** Writes the run's report into runDir. */
  generate(report: EvalSuiteReport, runDir: string): void;
}
