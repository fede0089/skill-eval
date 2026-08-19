import { test, describe, it } from 'node:test';
import * as assert from 'node:assert';
// @ts-ignore - plain .mjs helper script, no type declarations
import { parseArgs } from '../../scripts/run-mock-eval.mjs';

describe('run-mock-eval parseArgs', () => {
  it('defaults to gemini-cli when no runner is given', () => {
    assert.deepStrictEqual(parseArgs([]), { runner: 'gemini-cli', extraArgs: [] });
  });

  it('takes a leading bare argument as the runner', () => {
    assert.deepStrictEqual(parseArgs(['codex']), { runner: 'codex', extraArgs: [] });
    assert.deepStrictEqual(
      parseArgs(['codex', '--trials', '1']),
      { runner: 'codex', extraArgs: ['--trials', '1'] }
    );
  });

  it('supports --runner in both forms', () => {
    assert.deepStrictEqual(parseArgs(['--runner', 'codex']), { runner: 'codex', extraArgs: [] });
    assert.deepStrictEqual(parseArgs(['--runner=codex']), { runner: 'codex', extraArgs: [] });
  });

  it('does not steal a flag value as the runner', () => {
    for (const [flag, value] of [
      ['--compare-ref', 'HEAD~1'],
      ['--eval-file', 'negative-triggers.json'],
      ['--eval-id', '3'],
      ['--trials', '5']
    ]) {
      assert.deepStrictEqual(
        parseArgs([flag, value]),
        { runner: 'gemini-cli', extraArgs: [flag, value] },
        `stole the value of ${flag}`
      );
    }
  });

  it('keeps the runner and a flag value apart when both are present', () => {
    assert.deepStrictEqual(
      parseArgs(['codex', '--compare-ref', 'HEAD~1', 'HEAD~2']),
      { runner: 'codex', extraArgs: ['--compare-ref', 'HEAD~1', 'HEAD~2'] }
    );
  });
});
