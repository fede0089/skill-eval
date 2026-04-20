import { NdjsonEvent, NdjsonResultEvent, TrialTokenStats } from '../types/index.js';

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

/**
 * Parses a Gemini CLI stream-json stdout blob into a clean result.
 * Returns { error } if the result event signals failure.
 * Returns { response } with joined assistant text on success.
 * Returns null if no result event is present (non-stream output).
 */
export function parseStreamResult(output: string): { error: string } | { response: string } | null {
  let deltaBuffer = '';
  const completedParts: string[] = [];
  let resultEvent: NdjsonResultEvent | null = null;

  for (const event of parseNdjsonEvents(output)) {
    if (event.type === 'message' && event.role === 'assistant' && typeof event.content === 'string') {
      if (event.delta) {
        // Streaming fragment — concatenate directly, no separator
        deltaBuffer += event.content;
      } else {
        // Complete message turn — flush delta buffer first, then add as a separate turn
        if (deltaBuffer) {
          completedParts.push(deltaBuffer);
          deltaBuffer = '';
        }
        completedParts.push(event.content);
      }
    } else if (event.type === 'result') {
      resultEvent = event;
    }
  }

  // Flush any trailing delta fragments
  if (deltaBuffer) {
    completedParts.push(deltaBuffer);
  }

  if (!resultEvent) return null;
  if (resultEvent.status === 'error') {
    const msg = resultEvent.error?.message || 'Agent run failed';
    return { error: msg };
  }
  const text = completedParts.join('\n').trim() ||
    (typeof resultEvent.response === 'string' ? resultEvent.response : '');
  return { response: text };
}

/**
 * Extracts token consumption stats from a Gemini CLI stream-json stdout blob.
 * Looks for a result event with a stats.total_tokens field.
 * Returns null if no such event is found or stats are absent.
 */
export function parseTokenStats(output: string): TrialTokenStats | null {
  for (const event of parseNdjsonEvents(output)) {
    if (event.type === 'result' && event.stats) {
      const s = event.stats;
      if (typeof s.total_tokens === 'number') {
        return {
          total_tokens: s.total_tokens,
          input_tokens:  typeof s.input_tokens  === 'number' ? s.input_tokens  : 0,
          output_tokens: typeof s.output_tokens === 'number' ? s.output_tokens : 0,
          cached_tokens: typeof s.cached        === 'number' ? s.cached        : 0,
        };
      }
    }
  }
  return null;
}
