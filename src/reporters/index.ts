import type { ReportFormat } from '../types/index.js';
import { HtmlReporter } from './html-reporter.js';
import { JsonReporter } from './json-reporter.js';
import type { Reporter } from './reporter.js';

export { HtmlReporter } from './html-reporter.js';
export { JsonReporter } from './json-reporter.js';
export type { Reporter } from './reporter.js';

// ---------------------------------------------------------------------------
// Reporter registry — add new report formats here.
//
// To add a new reporter:
//   1. Create src/reporters/<format>-reporter.ts implementing Reporter
//   2. Add a case below and export the class
//   3. Add the new format to ReportFormat in src/types/index.ts
// ---------------------------------------------------------------------------

export function createReporter(format: ReportFormat): Reporter {
  if (format === 'html') return new HtmlReporter();
  return new JsonReporter();
}
