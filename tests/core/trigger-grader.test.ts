import { test } from 'node:test';
import assert from 'node:assert';
import { TriggerGrader } from '../../src/core/evaluator.js';
import { AgentTranscript } from '../../src/types/index.js';

test('TriggerGrader.gradeTrigger should pass for correct JSON stream sequence', () => {
  const grader = new TriggerGrader('mock-skill');
  const transcript: AgentTranscript = {
    response: 'mock response',
    raw_output: JSON.stringify({ type: 'tool_use', tool_id: '1', tool_name: 'activate_skill', parameters: { name: 'mock-skill' } }) + '\n' +
                JSON.stringify({ type: 'tool_result', tool_id: '1', status: 'success' })
  };

  assert.strictEqual(grader.gradeTrigger(transcript), true);
});

test('TriggerGrader.gradeTrigger should pass for case-insensitive skill name', () => {
  const grader = new TriggerGrader('mock-skill');
  const transcript: AgentTranscript = {
    response: 'mock response',
    raw_output: JSON.stringify({ type: 'tool_use', tool_id: '1', tool_name: 'activate_skill', parameters: { name: 'Mock-Skill' } }) + '\n' +
                JSON.stringify({ type: 'tool_result', tool_id: '1', status: 'success' })
  };

  assert.strictEqual(grader.gradeTrigger(transcript), true);
});

test('TriggerGrader.gradeTrigger should fail if tool_name is not activate_skill', () => {
  const grader = new TriggerGrader('mock-skill');
  const transcript: AgentTranscript = {
    response: 'mock response',
    raw_output: JSON.stringify({ type: 'tool_use', tool_id: '1', tool_name: 'other_tool', parameters: { name: 'mock-skill' } }) + '\n' +
                JSON.stringify({ type: 'tool_result', tool_id: '1', status: 'success' })
  };

  assert.strictEqual(grader.gradeTrigger(transcript), false);
});

test('TriggerGrader.gradeTrigger should fail if skill name does not match', () => {
  const grader = new TriggerGrader('mock-skill');
  const transcript: AgentTranscript = {
    response: 'mock response',
    raw_output: JSON.stringify({ type: 'tool_use', tool_id: '1', tool_name: 'activate_skill', parameters: { name: 'wrong-skill' } }) + '\n' +
                JSON.stringify({ type: 'tool_result', tool_id: '1', status: 'success' })
  };

  assert.strictEqual(grader.gradeTrigger(transcript), false);
});

test('TriggerGrader.gradeTrigger should fail if tool_result status is not success', () => {
  const grader = new TriggerGrader('mock-skill');
  const transcript: AgentTranscript = {
    response: 'mock response',
    raw_output: JSON.stringify({ type: 'tool_use', tool_id: '1', tool_name: 'activate_skill', parameters: { name: 'mock-skill' } }) + '\n' +
                JSON.stringify({ type: 'tool_result', tool_id: '1', status: 'error' })
  };

  assert.strictEqual(grader.gradeTrigger(transcript), false);
});

test('TriggerGrader.gradeTrigger should fail if tool_id does not match', () => {
  const grader = new TriggerGrader('mock-skill');
  const transcript: AgentTranscript = {
    response: 'mock response',
    raw_output: JSON.stringify({ type: 'tool_use', tool_id: '1', tool_name: 'activate_skill', parameters: { name: 'mock-skill' } }) + '\n' +
                JSON.stringify({ type: 'tool_result', tool_id: '2', status: 'success' })
  };

  assert.strictEqual(grader.gradeTrigger(transcript), false);
});

test('TriggerGrader.gradeTrigger should fail if tool_result is missing', () => {
  const grader = new TriggerGrader('mock-skill');
  const transcript: AgentTranscript = {
    response: 'mock response',
    raw_output: JSON.stringify({ type: 'tool_use', tool_id: '1', tool_name: 'activate_skill', parameters: { name: 'mock-skill' } })
  };

  assert.strictEqual(grader.gradeTrigger(transcript), false);
});
