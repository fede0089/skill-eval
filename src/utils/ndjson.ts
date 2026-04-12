import { NdjsonEvent } from '../types/index.js';

/**
 * Parses Newline-Delimited JSON (NDJSON) output into an array of events.
 * Each non-empty line is parsed as a complete JSON value.
 * Lines that are not valid JSON (e.g. ANSI codes, status text) are skipped silently.
 * Unknown event types (not in NdjsonEvent union) are cast and silently ignored by callers.
 */
export function parseNdjsonEvents(output: string): NdjsonEvent[] {
  const events: NdjsonEvent[] = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as NdjsonEvent);
    } catch {
      // Non-JSON line — skip silently
    }
  }
  return events;
}
