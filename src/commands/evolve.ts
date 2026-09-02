import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { EvalSuite, EvalSuiteReport, PredictedExpectation, ProposalRecord, SessionBalance } from '../types/index.js';
import { ConfigError, ExecutionError } from '../core/errors.js';
import { decide, effectiveness, isInconclusive, parseDeclaredPrediction, resolvePredictions } from '../core/evolution.js';
import { resolveOutputDir } from '../core/output-location.js';
import { preflight } from '../core/preflight.js';
import { freezeEvals } from '../core/skill-parts.js';
import { resolveSkillRepo, SkillGit } from '../core/skill-git.js';
import { loadEvalSuite } from '../utils/eval-loader.js';
import { Logger } from '../utils/logger.js';
import { renderEvolveHeader, renderProposalOutcome, renderSessionBalance } from '../utils/table-renderer.js';
import { functionalCommand, runDirFor } from './functional.js';
import { HtmlReporter } from '../reporters/index.js';

/** Variant holding the candidate: the skill as it stands in the working tree. */
const CANDIDATE = 'local';
/** Variant holding the version currently in effect. */
const INCUMBENT = 'ref:HEAD';

export interface EvolveOptions {
  executorAgent: string;
  judgeAgent: string;
  workspace: string;
  skillPath: string;
  maxAgents?: number;
  numTrials?: number;
  timeoutMs?: number;
  output?: string;
  /** Raw `--predict` values, in their `<evalId>#<n>` form. */
  predict?: string[];
}

/**
 * Lists the frozen expectations with the identifier `--predict` takes, so an
 * author who has to declare a prediction reads it off the error instead of
 * counting positions in a JSON file.
 */
function missingPredictionMessage(suite: EvalSuite): string {
  const catalog = suite.tasks
    .flatMap(task => (task.assertions ?? []).map((expectation, index) => `  ${task.id}#${index + 1}  ${expectation}`))
    .join('\n');

  return (
    `The skill implementation has uncommitted changes, so the session measures it as a proposal ` +
    `and needs to know what it should improve.\n` +
    `Declare it with --predict <evalId>#<n>, once per expectation (e.g. --predict 1#3).\n\n` +
    `Frozen expectations:\n${catalog}`
  );
}

export interface CommitContext {
  skillName: string;
  executorAgent: string;
  judgeAgent: string;
  /** Absent while the session runs no optimizer. */
  optimizerAgent?: string;
}

/** Git's conventional subject limit; the hypothesis is cut to fit under it. */
const SUBJECT_LIMIT = 72;

/**
 * The message an accepted proposal is committed with.
 *
 * It lands in the author's repository, not in this one, so it says what the
 * evidence was rather than imitating this project's own style: the hypothesis as
 * the subject, the two effectivenesses unrounded enough to be checkable, the
 * expectations that were predicted and did improve, and where to find the run
 * that measured them.
 */
export function buildCommitMessage(record: ProposalRecord, context: CommitContext): string {
  const headline = record.hypothesis ?? 'accept the working-tree change';
  const prefix = `evolve(${context.skillName}): `;
  const room = SUBJECT_LIMIT - prefix.length;
  const subject = prefix + (headline.length > room ? `${headline.slice(0, room - 1)}…` : headline);

  const roles = [
    `executor ${context.executorAgent}`,
    `judge ${context.judgeAgent}`,
    ...(context.optimizerAgent ? [`optimizer ${context.optimizerAgent}`] : [])
  ].join(' · ');

  const measured = record.decision
    ? [
        `Effectiveness ${record.decision.incumbentEffectiveness.toFixed(4)} → ` +
        `${record.decision.candidateEffectiveness.toFixed(4)} under the evals frozen for the session.`,
        ''
      ]
    : [];

  const body = [
    ...measured,
    'Predicted and corroborated:',
    ...record.predictions.map(p => `- eval #${p.evalId} · ${p.expectation}`),
    '',
    `Measured by: ${record.runDir ?? 'unknown'}`,
    `Roles: ${roles}`
  ];

  return `${subject}\n\n${body.join('\n')}\n`;
}

/**
 * Runs one evolution session.
 *
 * The committed version of the skill is always the best accepted version and the
 * working tree is the candidate under evaluation. The session freezes the evals
 * once, measures the candidate against the committed version under them, and
 * either commits the implementation or restores it — never touching the evals,
 * never touching anything the author has pending outside the skill.
 */
export async function evolveCommand(options: EvolveOptions): Promise<void> {
  const {
    executorAgent, judgeAgent, workspace, skillPath,
    maxAgents = 4, numTrials = 5, timeoutMs, output, predict = []
  } = options;

  preflight(executorAgent, workspace, skillPath, judgeAgent);

  const absoluteSkillPath = path.resolve(workspace, skillPath);
  const skillGit = new SkillGit(resolveSkillRepo(absoluteSkillPath));

  // The artifacts root is named after the skill, which only the suite declares.
  const artifactsDir = resolveOutputDir({
    output, skillName: loadEvalSuite(absoluteSkillPath).skill_name, workspace, skillPath
  });

  const sessionDir = path.resolve(artifactsDir, 'evolve', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(sessionDir, { recursive: true });

  // Frozen once, here, for the whole session: every comparison of every round is
  // measured with this copy, so the only thing that differs between two variants
  // is the skill implementation.
  const frozenEvals = freezeEvals(absoluteSkillPath, sessionDir);
  const suite = loadEvalSuite(sessionDir);

  renderEvolveHeader({
    skillName: suite.skill_name,
    executorAgent,
    judgeAgent,
    // A session only ever measures functionally, so a trigger-only eval is
    // frozen with the rest but never counted: saying otherwise promises the
    // author a comparison over evals that will not take part in one.
    evals: suite.tasks.filter(task => task.should_trigger !== false).length,
    trials: numTrials,
    maxAgents,
    timeoutMs,
    sessionDir
  });

  const declared = predict.map(parseDeclaredPrediction);
  const dirty = skillGit.hasImplementationChanges();

  if (!dirty && declared.length > 0) {
    throw new ConfigError(
      `--predict declares what an uncommitted change should improve, but the skill implementation is clean. ` +
      `There is no proposal to measure.`
    );
  }
  if (dirty && declared.length === 0) {
    throw new ConfigError(missingPredictionMessage(suite));
  }

  // Before anything can be discarded irreversibly: whatever the author already
  // had in the tree stays recoverable under the session directory.
  const backup = skillGit.backupWorkingTree(path.join(sessionDir, 'backup'));
  if (backup) Logger.write(chalk.dim(`   Working tree preserved at ${backup}\n\n`));

  const initialSha = skillGit.headSha();
  const records: ProposalRecord[] = [];

  const restoreOnSignal = () => {
    try {
      skillGit.restoreImplementation();
    } catch (err) {
      Logger.warn(`Failed to restore the skill implementation on interrupt: ${err instanceof Error ? err.message : String(err)}`);
    }
    process.exit(1);
  };
  process.once('SIGINT', restoreOnSignal);
  process.once('SIGTERM', restoreOnSignal);

  const evaluate = async (compareRefs: string[]): Promise<{ report: EvalSuiteReport; runDir: string }> => {
    const report = await functionalCommand(
      executorAgent, judgeAgent, workspace, skillPath, maxAgents, undefined, numTrials,
      new HtmlReporter(), timeoutMs, undefined, compareRefs, false, undefined, output,
      { frozenEvalsDir: frozenEvals.dir }
    );
    return { report, runDir: runDirFor(artifactsDir, report.timestamp) };
  };

  let failure: unknown;

  try {
    if (dirty) {
      const predictions: PredictedExpectation[] = resolvePredictions(suite, declared);
      const { report, runDir } = await evaluate(['HEAD']);

      if (isInconclusive(report, [CANDIDATE, INCUMBENT])) {
        skillGit.restoreImplementation();
        throw new ExecutionError(
          `The comparison produced no comparable metric: a variant was left without a counted trial in some eval. ` +
          `Nothing was committed and the skill implementation was restored. Evidence: ${runDir}`
        );
      }

      const decision = decide({ report, candidate: CANDIDATE, incumbent: INCUMBENT, predictions });
      const record: ProposalRecord = {
        number: 1, total: 1, origin: 'working-tree', predictions, decision, runDir
      };

      if (decision.verdict === 'accepted') {
        const message = buildCommitMessage(record, { skillName: suite.skill_name, executorAgent, judgeAgent });
        record.sha = skillGit.shortSha(skillGit.commitImplementation(message));
      } else {
        skillGit.restoreImplementation();
      }

      records.push(record);
      renderProposalOutcome(record);
    } else {
      // Nothing to decide: the run establishes the evidence a later round starts from.
      const { runDir } = await evaluate([]);
      Logger.write(chalk.dim(`\n   Starting evidence measured at ${runDir}\n`));
    }
  } catch (err) {
    failure = err;
  } finally {
    process.off('SIGINT', restoreOnSignal);
    process.off('SIGTERM', restoreOnSignal);
  }

  const finalSha = skillGit.headSha();
  const balance: SessionBalance = {
    proposals: records.length,
    accepted: records.filter(r => r.decision?.verdict === 'accepted').length,
    rejected: records.filter(r => r.decision && r.decision.verdict !== 'accepted').length,
    invalid: records.filter(r => !r.decision).length,
    initialSha: skillGit.shortSha(initialSha),
    finalSha: skillGit.shortSha(finalSha)
  };

  // The end-to-end number is the one the author will cite, so it is measured
  // fresh between the session's first and last version instead of composed from
  // the rounds, which would carry the bias of every acceptance. Nothing accepted
  // means nothing to compare.
  if (!failure && finalSha !== initialSha) {
    Logger.write(chalk.dim('\n   Measuring the session end to end…\n'));
    const { report } = await evaluate([initialSha]);
    balance.endToEnd = {
      initial: effectiveness(report, `ref:${initialSha}`),
      final: effectiveness(report, CANDIDATE)
    };
  }

  // The balance closes the session even when it ended on an error: the author
  // still needs to read where the skill was left.
  renderSessionBalance(balance);

  if (failure) throw failure;
}
