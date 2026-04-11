import type { ReportFormat } from '../../types/index.js';
import { HtmlReporter } from './html-reporter.js';
import { JsonReporter } from './json-reporter.js';
import type { Reporter } from './reporter.js';

export { HtmlReporter } from './html-reporter.js';
export { JsonReporter } from './json-reporter.js';
export type { Reporter } from './reporter.js';

export function createReporter(format: ReportFormat): Reporter {
  if (format === 'html') return new HtmlReporter();
  return new JsonReporter();
}
