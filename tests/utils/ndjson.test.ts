import { test, describe } from 'node:test';
import assert from 'node:assert';
import { parseNdjsonEvents, parseStreamResult, parseTokenStats } from '../../src/utils/ndjson.js';

test('parseNdjsonEvents: parses a single JSON object', () => {
  const output = JSON.stringify({ type: 'result', status: 'success' });
  const events = parseNdjsonEvents(output);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'result');
});

test('parseNdjsonEvents: parses multiple JSON objects across lines', () => {
  const line1 = JSON.stringify({ type: 'message', content: 'hello' });
  const line2 = JSON.stringify({ type: 'result', status: 'success' });
  const events = parseNdjsonEvents(`${line1}\n${line2}`);
  assert.strictEqual(events.length, 2);
  assert.strictEqual(events[0].type, 'message');
  assert.strictEqual(events[1].type, 'result');
});

test('parseNdjsonEvents: skips empty lines', () => {
  const line = JSON.stringify({ type: 'result' });
  const events = parseNdjsonEvents(`\n${line}\n\n`);
  assert.strictEqual(events.length, 1);
});

test('parseNdjsonEvents: skips non-JSON lines silently', () => {
  const output = 'some log text\n' + JSON.stringify({ type: 'result' }) + '\nanother non-json line';
  const events = parseNdjsonEvents(output);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'result');
});

test('parseNdjsonEvents: handles JSON objects with deeply nested braces', () => {
  const nested = {
    type: 'tool_use',
    tool_id: '42',
    tool_name: 'activate_skill',
    parameters: { name: 'mock-skill', options: { nested: { deep: {} } } }
  };
  const events = parseNdjsonEvents(JSON.stringify(nested));
  assert.strictEqual(events.length, 1);
  // Cast to access non-standard nested properties — behavior test, not type test
  assert.deepStrictEqual((events[0] as any).parameters.options.nested.deep, {});
});

test('parseNdjsonEvents: unknown event types are parsed and returned without error', () => {
  const unknownEvent = JSON.stringify({ type: 'thinking', content: 'internal reasoning' });
  const knownEvent = JSON.stringify({ type: 'result', status: 'success' });
  const events = parseNdjsonEvents(`${unknownEvent}\n${knownEvent}`);
  assert.strictEqual(events.length, 2, 'Both known and unknown event types should be included');
  assert.strictEqual(events[0].type, 'thinking');
  assert.strictEqual(events[1].type, 'result');
});

test('parseNdjsonEvents: handles empty string', () => {
  const events = parseNdjsonEvents('');
  assert.strictEqual(events.length, 0);
});

test('parseNdjsonEvents: trims whitespace from lines', () => {
  const output = '  ' + JSON.stringify({ type: 'result' }) + '  ';
  const events = parseNdjsonEvents(output);
  assert.strictEqual(events.length, 1);
});

// ---------------------------------------------------------------------------
// parseStreamResult
// ---------------------------------------------------------------------------

function makeNdjson(...events: object[]): string {
  return events.map(e => JSON.stringify(e)).join('\n');
}

describe('parseStreamResult', () => {
  test('returns null when no result event is present', () => {
    const input = makeNdjson({ type: 'message', role: 'assistant', content: 'hi', delta: true });
    assert.strictEqual(parseStreamResult(input), null);
  });

  test('returns error when result status is error', () => {
    const input = makeNdjson(
      { type: 'message', role: 'assistant', content: 'partial', delta: true },
      { type: 'result', status: 'error', error: { message: 'quota exceeded' } }
    );
    const result = parseStreamResult(input);
    assert.deepStrictEqual(result, { error: 'quota exceeded' });
  });

  test('returns generic error message when error object lacks message', () => {
    const input = makeNdjson({ type: 'result', status: 'error' });
    const result = parseStreamResult(input);
    assert.deepStrictEqual(result, { error: 'Agent run failed' });
  });

  test('single delta fragment is returned as-is', () => {
    const input = makeNdjson(
      { type: 'message', role: 'assistant', content: 'Hello world', delta: true },
      { type: 'result', status: 'success' }
    );
    const result = parseStreamResult(input);
    assert.deepStrictEqual(result, { response: 'Hello world' });
  });

  test('multiple delta fragments are concatenated WITHOUT separator', () => {
    // Simulates the bug: a JSON key split across two delta events
    const input = makeNdjson(
      { type: 'message', role: 'assistant', content: '{"passed"', delta: true },
      { type: 'message', role: 'assistant', content: ': true}', delta: true },
      { type: 'result', status: 'success' }
    );
    const result = parseStreamResult(input);
    assert.deepStrictEqual(result, { response: '{"passed": true}' });
  });

  test('multiple non-delta messages are joined with newline', () => {
    const input = makeNdjson(
      { type: 'message', role: 'assistant', content: 'first' },
      { type: 'message', role: 'assistant', content: 'second' },
      { type: 'result', status: 'success' }
    );
    const result = parseStreamResult(input);
    assert.deepStrictEqual(result, { response: 'first\nsecond' });
  });

  test('delta sequence followed by non-delta flushes buffer then adds newline', () => {
    const input = makeNdjson(
      { type: 'message', role: 'assistant', content: 'part1', delta: true },
      { type: 'message', role: 'assistant', content: 'part2', delta: true },
      { type: 'message', role: 'assistant', content: 'complete turn' },
      { type: 'result', status: 'success' }
    );
    const result = parseStreamResult(input);
    assert.deepStrictEqual(result, { response: 'part1part2\ncomplete turn' });
  });

  test('falls back to result.response when no message events present', () => {
    const input = makeNdjson({ type: 'result', status: 'success', response: 'fallback text' });
    const result = parseStreamResult(input);
    assert.deepStrictEqual(result, { response: 'fallback text' });
  });

  test('ignores messages with role other than assistant', () => {
    const input = makeNdjson(
      { type: 'message', role: 'user', content: 'user message', delta: false },
      { type: 'result', status: 'success', response: 'fallback' }
    );
    const result = parseStreamResult(input);
    assert.deepStrictEqual(result, { response: 'fallback' });
  });

  test('trims leading/trailing whitespace from assembled response', () => {
    const input = makeNdjson(
      { type: 'message', role: 'assistant', content: '  trimmed  ', delta: true },
      { type: 'result', status: 'success' }
    );
    const result = parseStreamResult(input);
    assert.deepStrictEqual(result, { response: 'trimmed' });
  });
});

// ---------------------------------------------------------------------------
// parseTokenStats
// ---------------------------------------------------------------------------

describe('parseTokenStats', () => {
  test('returns TrialTokenStats from a result event with stats', () => {
    const input = makeNdjson({
      type: 'result',
      status: 'success',
      stats: { total_tokens: 119002, input_tokens: 113266, output_tokens: 571, cached: 73501 }
    });
    const result = parseTokenStats(input);
    assert.deepStrictEqual(result, {
      total_tokens: 119002,
      input_tokens: 113266,
      output_tokens: 571,
      cached_tokens: 73501
    });
  });

  test('returns null when result event has no stats field', () => {
    const input = makeNdjson({ type: 'result', status: 'success' });
    assert.strictEqual(parseTokenStats(input), null);
  });

  test('returns null when result event stats lacks total_tokens', () => {
    const input = makeNdjson({
      type: 'result', status: 'success',
      stats: { input_tokens: 100 }
    });
    assert.strictEqual(parseTokenStats(input), null);
  });

  test('returns null for non-NDJSON output', () => {
    assert.strictEqual(parseTokenStats('plain text output'), null);
  });

  test('returns null for empty string', () => {
    assert.strictEqual(parseTokenStats(''), null);
  });

  test('defaults missing sub-fields to 0', () => {
    const input = makeNdjson({
      type: 'result', status: 'success',
      stats: { total_tokens: 500 }
    });
    const result = parseTokenStats(input);
    assert.deepStrictEqual(result, {
      total_tokens: 500,
      input_tokens: 0,
      output_tokens: 0,
      cached_tokens: 0
    });
  });

  test('ignores token stats from non-result events', () => {
    const input = makeNdjson(
      { type: 'message', role: 'assistant', content: 'hi', stats: { total_tokens: 999 } },
      { type: 'result', status: 'success' }
    );
    assert.strictEqual(parseTokenStats(input), null);
  });
});
