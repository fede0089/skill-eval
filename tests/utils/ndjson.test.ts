import { test } from 'node:test';
import assert from 'node:assert';
import { parseNdjsonEvents } from '../../src/utils/ndjson.js';

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
  assert.deepStrictEqual(events[0].parameters.options.nested.deep, {});
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
