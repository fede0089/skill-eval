import { test } from 'node:test';
import * as assert from 'node:assert';
import { buildOptimizerPrompt, parseOptimizerDeclaration, summarizeExpectations } from '../../src/core/optimizer.js';
import { EvalSuite } from '../../src/types/index.js';

const SUITE: EvalSuite = {
  skill_name: 'evolving-skill',
  tasks: [
    { id: 1, prompt: 'do the thing', assertions: ['A holds', 'B holds'] },
    { id: 2, prompt: 'never trigger', assertions: ['C holds'], should_trigger: false }
  ]
};

test('the prompt hands over locations and the boundary, not the material', () => {
  const prompt = buildOptimizerPrompt({
    reportPath: '/evidence/runs/latest/report.html',
    transcriptsDir: '/evidence/runs/latest',
    skillImplPath: '/repo/my-skill',
    evalsPath: '/repo/my-skill/evals',
    evalsSummary: summarizeExpectations(SUITE)
  });

  assert.match(prompt, /\/evidence\/runs\/latest\/report\.html/);
  assert.match(prompt, /Trial transcripts of that comparison: \/evidence\/runs\/latest/);
  assert.match(prompt, /Only files under \/repo\/my-skill\./);
  assert.match(prompt, /MUST NOT modify anything under \/repo\/my-skill\/evals/);
  assert.match(prompt, /exactly ONE hypothesis/);
  assert.match(prompt, /A holds/, 'the expectations are listed so they can be quoted exactly');
  assert.ok(
    !prompt.includes('C holds'),
    'a trigger-only eval never takes part in a comparison, so it cannot be predicted'
  );
});

test('a declaration surrounded by prose is still read', () => {
  const result = parseOptimizerDeclaration(
    'I looked at the transcripts and the year is being dropped.\n\n' +
    '{"hypothesis": "spell out the year rule", "predictions": [{"eval": 1, "expectation": "A holds"}]}\n'
  );

  assert.deepStrictEqual(result, {
    declared: true,
    hypothesis: 'spell out the year rule',
    predictions: [{ evalId: 1, expectation: 'A holds' }]
  });
});

test('an answer with no declaration, a broken one, or one with no predictions is invalid', () => {
  assert.deepStrictEqual(
    parseOptimizerDeclaration('I improved the skill, trust me.'),
    { declared: false, reason: 'no-declaration' }
  );
  assert.deepStrictEqual(
    parseOptimizerDeclaration('{"hypothesis": "oops", "predictions": [}'),
    { declared: false, reason: 'unparsable-declaration' }
  );
  assert.deepStrictEqual(
    parseOptimizerDeclaration('{"hypothesis": "did something", "predictions": []}'),
    { declared: false, reason: 'unparsable-declaration' }
  );
  assert.deepStrictEqual(
    parseOptimizerDeclaration('{"predictions": [{"eval": 1, "expectation": "A holds"}]}'),
    { declared: false, reason: 'unparsable-declaration' }
  );
});
