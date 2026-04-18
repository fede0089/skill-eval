import { test, mock } from 'node:test';
import * as assert from 'node:assert';
import { ModelBasedGrader } from '../../src/core/evaluator.js';
import type { AgentRunner } from '../../src/runners/runner.interface.js';

/** Wraps a plain-text response in Gemini CLI stream-json NDJSON format. */
function makeNdjsonResponse(text: string): string {
  const messageEvent = JSON.stringify({ type: 'message', role: 'assistant', content: text });
  const resultEvent = JSON.stringify({ type: 'result', status: 'success' });
  return `${messageEvent}\n${resultEvent}`;
}

function makeJudgeRunner(responseText: string): AgentRunner {
  return {
    skillDispatchToolName: 'activate_skill',
    runPrompt: mock.fn(async () => ({ response: makeNdjsonResponse(responseText) })),
    linkSkill: mock.fn(async () => {}),
    applyRunnerConfig: mock.fn(() => {}),
  };
}

test('ModelBasedGrader.gradeModelBased uses the injected judgeRunner', async () => {
  const judgeResponse = JSON.stringify([
    { assertion: 'Output contains LICENSE', passed: true, reason: 'File was created' }
  ]);
  const judgeRunner = makeJudgeRunner(judgeResponse);

  const grader = new ModelBasedGrader('mock-skill', judgeRunner);
  const results = await grader.gradeModelBased(
    'Generate a license',
    { response: 'I created LICENSE.md' },
    ['Output contains LICENSE'],
    'No workspace changes',
    undefined, undefined, undefined
  );

  assert.strictEqual(results.length, 1, 'Should return one assertion result');
  assert.strictEqual(results[0].passed, true);
  assert.strictEqual(results[0].assertion, 'Output contains LICENSE');

  const runPromptCalls = (judgeRunner.runPrompt as ReturnType<typeof mock.fn>).mock.callCount();
  assert.strictEqual(runPromptCalls, 1, 'Should call judgeRunner.runPrompt exactly once');
});

test('ModelBasedGrader.gradeModelBased returns failed results when judge returns no response', async () => {
  const judgeRunner: AgentRunner = {
    skillDispatchToolName: 'activate_skill',
    runPrompt: mock.fn(async () => null),
    linkSkill: mock.fn(async () => {}),
    applyRunnerConfig: mock.fn(() => {}),
  };

  const grader = new ModelBasedGrader('mock-skill', judgeRunner);
  const results = await grader.gradeModelBased(
    'Generate a license',
    { response: 'done' },
    ['Output contains LICENSE'],
    'No changes',
    undefined, undefined, undefined
  );

  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].passed, false);
  assert.ok(results[0].reason.includes('failed to produce'), `Unexpected reason: ${results[0].reason}`);
});

test('ModelBasedGrader.gradeModelBased returns empty array for empty assertions', async () => {
  const judgeRunner = makeJudgeRunner('[]');
  const grader = new ModelBasedGrader('mock-skill', judgeRunner);

  const results = await grader.gradeModelBased(
    'Generate a license', { response: 'done' }, [], 'No changes',
    undefined, undefined, undefined
  );

  assert.strictEqual(results.length, 0, 'Should return empty array for no assertions');
  const runPromptCalls = (judgeRunner.runPrompt as ReturnType<typeof mock.fn>).mock.callCount();
  assert.strictEqual(runPromptCalls, 0, 'Should not call judgeRunner when there are no assertions');
});

test('ModelBasedGrader.gradeModelBased handles judge JSON with literal newlines in reason field', async () => {
  // Simulate an LLM judge that embeds literal newlines inside a JSON string value,
  // which JSON.parse rejects as "Bad control character in string literal".
  const judgeResponseWithNewlines = `[
  {
    "assertion": "Output contains LICENSE",
    "passed": true,
    "reason": "The file was created\nand its content is correct"
  }
]`;
  const judgeRunner = makeJudgeRunner(judgeResponseWithNewlines);
  const grader = new ModelBasedGrader('mock-skill', judgeRunner);
  const results = await grader.gradeModelBased(
    'Generate a license',
    { response: 'I created LICENSE.md' },
    ['Output contains LICENSE'],
    'No workspace changes',
    undefined, undefined, undefined
  );

  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].passed, true);
  assert.strictEqual(results[0].assertion, 'Output contains LICENSE');
});
