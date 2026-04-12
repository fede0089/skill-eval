import path from 'path';
import type { EvalSuiteReport } from '../types/index.js';
import { Logger } from '../utils/logger.js';
import type { Reporter } from './reporter.js';

export class JsonReporter implements Reporter {
  generate(_report: EvalSuiteReport, runDir: string): void {
    Logger.write(`\n   Report: file://${path.join(runDir, 'summary.json')}\n`);
  }
}
