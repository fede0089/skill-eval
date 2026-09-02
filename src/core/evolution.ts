import {
  EvalSuite,
  EvalSuiteReport,
  EvalTrial,
  ExpectationOutcome,
  PredictedExpectation,
  ProposalDecision,
  TaskResult
} from '../types/index.js';
import { ValidationError } from './errors.js';
import { aggregateAssertionPassRate } from './statistics.js';
import { isCounted } from './trial-utils.js';

/**
 * The acceptance rule of an evolution session, resolved programmatically over
 * the results an evaluation already produces.
 *
 * A candidate is accepted if and only if the three conditions hold at once: its
 * aggregate effectiveness beats the incumbent's, every expectation its author
 * declared actually improved, and no expectation the incumbent passed
 * consistently fails in all of the candidate's trials. Nothing here asks an
 * agent whether its own idea worked.
 */

/** A prediction as declared, before it is resolved against the frozen evals. */
export type DeclaredPrediction =
  | { evalId: number; index: number }
  | { evalId: number; expectation: string };

/** Identity of an expectation: the eval it belongs to and its exact text. */
export function expectationKey(evalId: number, expectation: string): string {
  return `${evalId}\u0000${expectation}`;
}

/**
 * What a variant did with each expectation.
 *
 * The denominator is every counted trial of the eval, not only the trials that
 * mention the expectation: a trial that never activated the skill carries one
 * synthetic assertion instead of the expectations, and it still counts. Leaving
 * it out of the denominator would let a variant that fails to activate measure
 * like one that activates and gets the expectation right.
 */
export interface VariantExpectations {
  /** Counted trials of each eval. */
  counted: Map<number, number>;
  /** Trials in which each expectation passed. */
  passed: Map<string, number>;
  /** The eval and text behind each expectation key. */
  expectations: Map<string, PredictedExpectation>;
}

function trialsOf(result: TaskResult, variant: string): EvalTrial[] {
  return result.skillTrials[variant] ?? [];
}

/** Aggregate effectiveness of a variant: the assertion pass rate, unrounded. */
export function effectiveness(report: EvalSuiteReport, variant: string): number {
  return aggregateAssertionPassRate(report.results, r => trialsOf(r, variant));
}

export function expectationRates(report: EvalSuiteReport, variant: string): VariantExpectations {
  const counted = new Map<number, number>();
  const passed = new Map<string, number>();
  const expectations = new Map<string, PredictedExpectation>();

  for (const result of report.results) {
    const trials = trialsOf(result, variant).filter(isCounted);
    counted.set(result.taskId, trials.length);

    for (const trial of trials) {
      for (const assertion of trial.assertionResults) {
        const key = expectationKey(result.taskId, assertion.assertion);
        expectations.set(key, { evalId: result.taskId, expectation: assertion.assertion });
        if (assertion.passed) passed.set(key, (passed.get(key) ?? 0) + 1);
      }
    }
  }

  return { counted, passed, expectations };
}

/** Share of the variant's counted trials in which an expectation passed. */
function rateOf(outcomes: VariantExpectations, evalId: number, expectation: string): number {
  const counted = outcomes.counted.get(evalId) ?? 0;
  if (counted === 0) return 0;
  return (outcomes.passed.get(expectationKey(evalId, expectation)) ?? 0) / counted;
}

/**
 * Reads one `--predict` value in its `<evalId>#<n>` form, where n is the
 * position of the expectation inside that eval.
 *
 * @throws ValidationError if the value is not in that form.
 */
export function parseDeclaredPrediction(value: string): DeclaredPrediction {
  const match = value.trim().match(/^(\d+)#(\d+)$/);
  if (!match) {
    throw new ValidationError(
      `Prediction '${value}' is not in the '<evalId>#<n>' form (e.g. 1#3 for the third expectation of eval 1).`
    );
  }
  return { evalId: parseInt(match[1], 10), index: parseInt(match[2], 10) };
}

/**
 * Resolves declared predictions against the frozen evals, by position or by
 * exact text. A prediction that does not name an existing expectation is not a
 * prediction: the change behind it cannot be corroborated and is not evaluated.
 *
 * @throws ValidationError if nothing was declared or a declaration does not resolve.
 */
export function resolvePredictions(suite: EvalSuite, declared: DeclaredPrediction[]): PredictedExpectation[] {
  if (declared.length === 0) {
    throw new ValidationError('No expectation was declared. A change with no declared prediction is not evaluated.');
  }

  return declared.map(entry => {
    const task = suite.tasks.find(t => t.id === entry.evalId);
    if (!task) {
      const available = suite.tasks.map(t => `#${t.id}`).join(', ');
      throw new ValidationError(`Eval #${entry.evalId} does not exist in the frozen evals. Available: ${available}.`);
    }

    const expectations = task.assertions ?? [];

    if ('index' in entry) {
      const expectation = expectations[entry.index - 1];
      if (expectation === undefined) {
        throw new ValidationError(
          `Eval #${entry.evalId} has ${expectations.length} expectation(s), so '${entry.evalId}#${entry.index}' names none of them.`
        );
      }
      return { evalId: entry.evalId, expectation };
    }

    if (!expectations.includes(entry.expectation)) {
      throw new ValidationError(
        `'${entry.expectation}' is not an expectation of eval #${entry.evalId}.`
      );
    }
    return { evalId: entry.evalId, expectation: entry.expectation };
  });
}

/**
 * Whether a comparison failed to produce comparable metrics.
 *
 * Effectiveness averages per eval, so an eval where a variant has no counted
 * trial at all contributes a zero that is an infrastructure failure rather than
 * a measurement. Deciding a commit on that number would treat a broken run as a
 * regression.
 */
export function isInconclusive(report: EvalSuiteReport, variants: string[]): boolean {
  if (report.results.length === 0) return true;

  return report.results.some(result =>
    variants.some(variant => trialsOf(result, variant).filter(isCounted).length === 0)
  );
}

export interface DecisionInput {
  report: EvalSuiteReport;
  /** Variant holding the proposed implementation. */
  candidate: string;
  /** Variant holding the version currently in effect. */
  incumbent: string;
  predictions: PredictedExpectation[];
}

/**
 * Applies the acceptance rule to one comparison. Pure: it reads a report and
 * returns a verdict, without touching Git or the filesystem.
 */
export function decide(input: DecisionInput): ProposalDecision {
  const { report, candidate, incumbent, predictions } = input;

  const candidateEffectiveness = effectiveness(report, candidate);
  const incumbentEffectiveness = effectiveness(report, incumbent);

  const candidateOutcomes = expectationRates(report, candidate);
  const incumbentOutcomes = expectationRates(report, incumbent);

  const predictionsMet: ExpectationOutcome[] = predictions.map(prediction => {
    const candidateRate = rateOf(candidateOutcomes, prediction.evalId, prediction.expectation);
    const incumbentRate = rateOf(incumbentOutcomes, prediction.evalId, prediction.expectation);
    return { prediction, candidateRate, incumbentRate, improved: candidateRate > incumbentRate };
  });

  // An expectation has collapsed only under the strict reading: the incumbent
  // passed it in every one of its counted trials and the candidate fails it in
  // every one of its own. Partial drops are tolerated on purpose — with
  // non-deterministic agents, blocking on any drop accepts nothing ever.
  const collapsed: PredictedExpectation[] = [];
  for (const [key, expectation] of incumbentOutcomes.expectations) {
    const incumbentCounted = incumbentOutcomes.counted.get(expectation.evalId) ?? 0;
    const candidateCounted = candidateOutcomes.counted.get(expectation.evalId) ?? 0;
    if (incumbentCounted === 0 || candidateCounted === 0) continue;
    if ((incumbentOutcomes.passed.get(key) ?? 0) !== incumbentCounted) continue;
    if ((candidateOutcomes.passed.get(key) ?? 0) !== 0) continue;
    collapsed.push(expectation);
  }

  const base = { candidateEffectiveness, incumbentEffectiveness, predictionsMet, collapsed };

  if (!(candidateEffectiveness > incumbentEffectiveness)) return { verdict: 'not-better', ...base };
  if (predictionsMet.some(outcome => !outcome.improved)) return { verdict: 'unattributable', ...base };
  if (collapsed.length > 0) return { verdict: 'total-regression', ...base };

  return { verdict: 'accepted', ...base };
}
