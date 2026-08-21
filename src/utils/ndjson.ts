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
 * Counts tool invocations and reads the terminal status from a stream-json blob.
 * Both are needed to tell a legitimate short answer apart from an agent that
 * stopped early or degenerated: a trial with tool calls and a 'success' status
 * that still produced two characters of text is a very different failure from
 * one that never started.
 * Returns toolCalls: 0 and an undefined status when the blob carries no events.
 */
export function parseStreamStats(output: string): { toolCalls: number; status?: string } {
  let toolCalls = 0;
  let status: string | undefined;
  for (const event of parseNdjsonEvents(output)) {
    if (event.type === 'tool_use') toolCalls += 1;
    else if (event.type === 'result') status = event.status;
  }
  return { toolCalls, status };
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
          totalTokens:  s.total_tokens,
          inputTokens:  typeof s.input_tokens  === 'number' ? s.input_tokens  : 0,
          outputTokens: typeof s.output_tokens === 'number' ? s.output_tokens : 0,
          cachedTokens: typeof s.cached        === 'number' ? s.cached        : 0,
        };
      }
    }
  }
  return null;
}
