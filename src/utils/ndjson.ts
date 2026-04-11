/**
 * Parses Newline-Delimited JSON (NDJSON) output into an array of events.
 * Each non-empty line is parsed as a complete JSON value.
 * Lines that are not valid JSON (e.g. ANSI codes, status text) are skipped silently.
 */
export function parseNdjsonEvents(output: string): any[] {
  const events: any[] = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      // Non-JSON line — skip silently
    }
  }
  return events;
}
