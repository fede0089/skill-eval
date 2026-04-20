import fs from 'fs';
import path from 'path';
import type { EvalSuiteReport } from '../types/index.js';
import { Logger } from '../utils/logger.js';
import type { Reporter } from './reporter.js';

export class JsonReporter implements Reporter {
  generate(report: EvalSuiteReport, runDir: string): void {
    const jsonPath = path.join(runDir, 'summary.json');
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8');
    Logger.write(`\n   Report: file://${jsonPath}\n`);
  }
}
