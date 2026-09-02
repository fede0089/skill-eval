import { EvalSuite, InvalidReason, OptimizerProposal } from '../types/index.js';
import { RunnerFactory } from '../runners/index.js';
import { sanitizeJsonControlChars } from './evaluator.js';
import { parseStreamResult } from '../utils/ndjson.js';

/**
 * The contract of the optimizer role: what evidence it gets, what it may change,
 * and what it has to declare.
 *
 * It is given locations, not material: the report and the transcripts of the last
 * comparison are there to be read by the agent itself. And it is asked for one
 * hypothesis and for the expectations that hypothesis should improve, because a
 * proposal is not accepted for what the optimizer claims but for what the
 * evidence measures — and there is nothing to corroborate without a claim stated
 * in advance.
 */

export interface OptimizerPromptInput {
  /** Report of the latest comparison. */
  reportPath: string;
  /** Directory holding the trial transcripts of that comparison. */
  transcriptsDir: string;
  /** The skill implementation, the only thing the optimizer may edit. */
  skillImplPath: string;
  /** The skill's evals directory, which it may read but never change. */
  evalsPath: string;
  /** The expectations it can predict, listed so it can quote them exactly. */
  evalsSummary: string;
}

/** Renders the expectations of a frozen suite for the optimizer to quote. */
export function summarizeExpectations(suite: EvalSuite): string {
  return suite.tasks
    .filter(task => task.should_trigger !== false)
    .map(task => [
      `eval #${task.id}: ${task.prompt}`,
      ...(task.assertions ?? []).map(expectation => `  - ${expectation}`)
    ].join('\n'))
    .join('\n');
}

export function buildOptimizerPrompt(input: OptimizerPromptInput): string {
  return `You are improving an Agent Skill by proposing ONE change to its implementation.

The skill is measured by running evals against it and grading the result. A recent
comparison has already been run. Read its evidence yourself — nothing is pasted here:

- Report of the latest comparison: ${input.reportPath}
- Trial transcripts of that comparison: ${input.transcriptsDir}
- The skill implementation you may edit: ${input.skillImplPath}

WHAT YOU MAY CHANGE
- Only files under ${input.skillImplPath}.
- You MUST NOT modify anything under ${input.evalsPath}: those are the evals you are
  being measured with. You may read them.
- You MUST NOT modify any other file of the project, anywhere.
Everything you touch outside that boundary is reverted, and your proposal is
discarded without being measured.

WHAT TO DO
1. Read the report and the transcripts and work out why the skill fails where it fails.
2. Propose exactly ONE hypothesis and apply it by editing the implementation.
3. Declare which specific expectations your change should improve. Your change is
   accepted only if those expectations actually improve, so predict what you
   actually believe your change fixes — not everything you would like to be true.

THE EXPECTATIONS YOU CAN PREDICT
${input.evalsSummary}

HOW TO ANSWER
End your reply with a single JSON object, and nothing after it:

{"hypothesis": "one sentence saying what you changed and why", "predictions": [{"eval": 1, "expectation": "the exact text of an expectation above"}]}

An answer with no such object, or naming an expectation that does not exist, is
discarded without being measured.`;
}

export type DeclarationResult =
  | ({ declared: true } & OptimizerProposal)
  | { declared: false; reason: InvalidReason };

/**
 * Extracts the declaration from the optimizer's reply, with the same tolerance
 * the judge is read with: the block is looked for inside whatever prose came with
 * it, and control characters that JSON.parse rejects are repaired.
 */
export function parseOptimizerDeclaration(text: string): DeclarationResult {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { declared: false, reason: 'no-declaration' };

  let parsed: any;
  try {
    parsed = JSON.parse(sanitizeJsonControlChars(match[0]));
  } catch {
    return { declared: false, reason: 'unparsable-declaration' };
  }

  const hypothesis = typeof parsed?.hypothesis === 'string' ? parsed.hypothesis.trim() : '';
  const declared = Array.isArray(parsed?.predictions) ? parsed.predictions : undefined;

  if (hypothesis === '' || declared === undefined || declared.length === 0) {
    return { declared: false, reason: 'unparsable-declaration' };
  }

  const predictions = declared.map((entry: any) => ({
    evalId: Number(entry?.eval ?? entry?.evalId),
    expectation: typeof entry?.expectation === 'string' ? entry.expectation : ''
  }));

  if (predictions.some((p: any) => !Number.isFinite(p.evalId) || p.expectation === '')) {
    return { declared: false, reason: 'unparsable-declaration' };
  }

  return { declared: true, hypothesis, predictions };
}

export interface OptimizerRunInput {
  agent: string;
  /**
   * Where the agent runs: the root of the skill's own repository, so it inherits
   * the agent configuration the author really uses. The optimizer's configuration
   * is not measuring apparatus, so it is deliberately not part of the frozen evals.
   */
  cwd: string;
  prompt: string;
  logPath?: string;
  /** The same limit the trials get; the optimizer gets no budget of its own. */
  timeoutMs?: number;
}

export type OptimizerRunResult =
  | { ok: true; text: string }
  | { ok: false; reason: InvalidReason };

/** Invokes the optimizer and returns its final text, or why the attempt is invalid. */
export async function runOptimizer(input: OptimizerRunInput): Promise<OptimizerRunResult> {
  const runner = RunnerFactory.create(input.agent);
  const transcript = await runner.runPrompt(input.prompt, input.cwd, undefined, input.logPath, undefined, input.timeoutMs);

  if (!transcript) return { ok: false, reason: 'agent-error' };
  if (transcript.error) {
    return { ok: false, reason: /timeout/i.test(transcript.error) ? 'timeout' : 'agent-error' };
  }

  const result = parseStreamResult(transcript.response || '');
  if (!result || 'error' in result) {
    const failed = result && 'error' in result ? result.error : '';
    return { ok: false, reason: /timeout/i.test(failed) ? 'timeout' : 'agent-error' };
  }

  return { ok: true, text: result.response };
}
