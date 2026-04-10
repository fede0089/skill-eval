import { test } from 'node:test';
import * as assert from 'node:assert';
import { validateAssertion } from '../src/core/evaluator';

test('validateAssertion should return true for valid contains assertion', () => {
  const assertion = { type: 'contains', value: 'hello' } as const;
  const actualOutput = 'well hello there';
  assert.strictEqual(validateAssertion(assertion, actualOutput), true);
});

test('validateAssertion should return false for invalid contains assertion', () => {
  const assertion = { type: 'contains', value: 'hello' } as const;
  const actualOutput = 'well hi there';
  assert.strictEqual(validateAssertion(assertion, actualOutput), false);
});

test('validateAssertion should return true for valid not_contains assertion', () => {
  const assertion = { type: 'not_contains', value: 'error' } as const;
  const actualOutput = 'success message';
  assert.strictEqual(validateAssertion(assertion, actualOutput), true);
});

test('validateAssertion should return true for valid regex assertion', () => {
  const assertion = { type: 'regex', value: 'he[l]{2}o' } as const;
  const actualOutput = 'hello world';
  assert.strictEqual(validateAssertion(assertion, actualOutput), true);
});

test('validateAssertion should return true for valid json assertion', () => {
  const assertion = { type: 'json', value: '' } as const;
  const actualOutput = '{"key": "value"}';
  assert.strictEqual(validateAssertion(assertion, actualOutput), true);
});

test('validateAssertion should return false for invalid json assertion', () => {
  const assertion = { type: 'json', value: '' } as const;
  const actualOutput = 'not a json';
  assert.strictEqual(validateAssertion(assertion, actualOutput), false);
});
