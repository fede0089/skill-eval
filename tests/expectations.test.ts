import { test } from 'node:test';
import assert from 'node:assert';
import { validateExpectation } from '../src/core/evaluator'; // This doesn't exist yet

test('validateExpectation should return true for valid contains expectation', () => {
  const expectation = { type: 'contains', value: 'hello' } as const;
  const actualOutput = 'hello world';
  assert.strictEqual(validateExpectation(expectation, actualOutput), true);
});

test('validateExpectation should return false for invalid contains expectation', () => {
  const expectation = { type: 'contains', value: 'hello' } as const;
  const actualOutput = 'hi world';
  assert.strictEqual(validateExpectation(expectation, actualOutput), false);
});

test('validateExpectation should return true for valid not_contains expectation', () => {
  const expectation = { type: 'not_contains', value: 'error' } as const;
  const actualOutput = 'success';
  assert.strictEqual(validateExpectation(expectation, actualOutput), true);
});

test('validateExpectation should return true for valid regex expectation', () => {
  const expectation = { type: 'regex', value: 'he[l]{2}o' } as const;
  const actualOutput = 'hello world';
  assert.strictEqual(validateExpectation(expectation, actualOutput), true);
});

test('validateExpectation should return true for valid json expectation', () => {
  const expectation = { type: 'json', value: '' } as const;
  const actualOutput = '{"status": "ok"}';
  assert.strictEqual(validateExpectation(expectation, actualOutput), true);
});

test('validateExpectation should return false for invalid json expectation', () => {
  const expectation = { type: 'json', value: '' } as const;
  const actualOutput = 'not a json';
  assert.strictEqual(validateExpectation(expectation, actualOutput), false);
});
