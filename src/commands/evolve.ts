import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import {
  EvalSuite,
  EvalSuiteReport,
  InvalidReason,
  PredictedExpectation,
  ProposalRecord,
  SessionBalance
} from '../types/index.js';
import { ConfigError, ExecutionError } from '../core/errors.js';
import { decide, effectiveness, isInconclusive, parseDeclaredPrediction, resolvePredictions } from '../core/evolution.js';
import {
  buildOptimizerPrompt,
  parseOptimizerDeclaration,
  runOptimizer,
  summarizeExpectations
} from '../core/optimizer.js';
import { resolveOutputDir } from '../core/output-location.js';
import { preflight } from '../core/preflight.js';
import { EVALS_DIRNAME, freezeEvals } from '../core/skill-parts.js';
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
  /** Agent that reads the evidence and proposes the change. */
  optimizerAgent: string;
  workspace: string;
  skillPath: string;
  maxAgents?: number;
  numTrials?: number;
  /** Ceiling of optimizer invocations. Every proposal consumes one, valid or not. */
  proposals?: number;
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

/** What the terminal says about an attempt that never reached a comparison. */
function describeInvalid(reason: InvalidReason, reverted: string[]): string {
  switch (reason) {
    case 'timeout':
      return 'the optimizer ran out of time';
    case 'agent-error':
      return 'the optimizer failed to produce an answer';
    case 'no-declaration':
      return 'the optimizer declared no prediction';
    case 'unparsable-declaration':
      return 'the declaration could not be read';
    case 'unknown-expectation':
      return 'the declared expectations do not exist in the frozen evals';
    case 'out-of-scope':
      return `the optimizer changed ${reverted.length} path(s) outside the implementation: ${reverted.join(', ')}`;
    case 'no-change':
      return 'the optimizer changed nothing';
  }
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
 * once, and every round measures the candidate against the committed version
 * under them, committing the implementation or restoring it — never touching the
 * evals, never touching anything the author has pending outside the skill.
 */
export async function evolveCommand(options: EvolveOptions): Promise<void> {
  const {
    executorAgent, judgeAgent, optimizerAgent, workspace, skillPath,
    maxAgents = 4, numTrials = 5, proposals = 3, timeoutMs, output, predict = []
  } = options;

  preflight(executorAgent, workspace, skillPath, judgeAgent, optimizerAgent);

  const absoluteSkillPath = path.resolve(workspace, skillPath);
  const repo = resolveSkillRepo(absoluteSkillPath);
  const skillGit = new SkillGit(repo);

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

  const declared = predict.map(parseDeclaredPrediction);
  const dirty = skillGit.hasImplementationChanges();
  // The uncommitted state is a proposal of its own, and it does not spend the
  // optimizer's budget: the ceiling the author asked for is invocations of the
  // optimizer, whatever else the session does.
  const totalProposals = (dirty ? 1 : 0) + proposals;

  renderEvolveHeader({
    skillName: suite.skill_name,
    executorAgent,
    judgeAgent,
    optimizerAgent,
    // A session only ever measures functionally, so a trigger-only eval is
    // frozen with the rest but never counted: saying otherwise promises the
    // author a comparison over evals that will not take part in one.
    evals: suite.tasks.filter(task => task.should_trigger !== false).length,
    trials: numTrials,
    maxAgents,
    proposals: totalProposals,
    timeoutMs,
    sessionDir
  });

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

  /**
   * Measures one candidate against the version in effect and acts on the verdict:
   * accepted, the implementation is committed and becomes the incumbent;
   * rejected, it is restored from that same version.
   */
  const settle = async (record: ProposalRecord): Promise<void> => {
    const { report, runDir } = await evaluate(['HEAD']);
    record.runDir = runDir;

    if (isInconclusive(report, [CANDIDATE, INCUMBENT])) {
      skillGit.restoreImplementation();
      throw new ExecutionError(
        `The comparison produced no comparable metric: a variant was left without a counted trial in some eval. ` +
        `Nothing was committed and the skill implementation was restored. Evidence: ${runDir}`
      );
    }

    record.decision = decide({
      report, candidate: CANDIDATE, incumbent: INCUMBENT, predictions: record.predictions
    });

    if (record.decision.verdict === 'accepted') {
      const message = buildCommitMessage(record, {
        skillName: suite.skill_name, executorAgent, judgeAgent, optimizerAgent
      });
      record.sha = skillGit.shortSha(skillGit.commitImplementation(message));
    } else {
      skillGit.restoreImplementation();
    }

    records.push(record);
    renderProposalOutcome(record);
  };

  let failure: unknown;
  /** Evidence the next optimizer invocation reads: the latest comparison. */
  let lastEvidence: string | undefined;

  try {
    if (dirty) {
      const predictions: PredictedExpectation[] = resolvePredictions(suite, declared);
      const record: ProposalRecord = { number: 1, total: totalProposals, origin: 'working-tree', predictions };
      await settle(record);
      lastEvidence = record.runDir;
    } else if (proposals > 0) {
      // Nothing to decide: the run establishes the evidence the first round reads.
      const { runDir } = await evaluate([]);
      lastEvidence = runDir;
      Logger.write(chalk.dim(`\n   Starting evidence measured at ${runDir}\n`));
    }

    const evalsSummary = summarizeExpectations(suite);

    for (let round = 1; round <= proposals; round++) {
      const record: ProposalRecord = {
        number: records.length + 1, total: totalProposals, origin: 'optimizer', predictions: []
      };

      // Everything the optimizer does is judged against the tree as it stands
      // now, so what the author already had pending outside the skill is never
      // mistaken for something the optimizer wrote.
      const before = skillGit.snapshotWorkingTree();

      Logger.write(chalk.dim(`\n   Asking the optimizer for proposal ${record.number}/${totalProposals}…\n`));
      const run = await runOptimizer({
        agent: optimizerAgent,
        cwd: repo.repoRoot,
        prompt: buildOptimizerPrompt({
          reportPath: path.join(lastEvidence!, 'report.html'),
          transcriptsDir: lastEvidence!,
          skillImplPath: absoluteSkillPath,
          evalsPath: path.join(absoluteSkillPath, EVALS_DIRNAME),
          evalsSummary
        }),
        logPath: path.join(sessionDir, `optimizer-${round}.log`),
        timeoutMs
      });

      let invalid: InvalidReason | undefined;

      if (!run.ok) {
        invalid = run.reason;
      } else {
        const declaration = parseOptimizerDeclaration(run.text);
        if (!declaration.declared) {
          invalid = declaration.reason;
        } else {
          record.hypothesis = declaration.hypothesis;
          try {
            record.predictions = resolvePredictions(suite, declaration.predictions);
          } catch {
            invalid = 'unknown-expectation';
          }
        }
      }

      // Checked after every invocation, whatever the answer looked like.
      const reverted = skillGit.revertOutOfScope(before);
      if (!invalid && reverted.length > 0) invalid = 'out-of-scope';
      if (!invalid && !skillGit.hasImplementationChanges()) invalid = 'no-change';

      if (invalid) {
        // Every overstep is treated alike: what fell outside is reverted, the
        // candidate is not measured, the proposal is consumed, and the session
        // goes on. The implementation goes back to the version in effect too,
        // since the tree may only hold a candidate that is being measured.
        record.invalidReason = describeInvalid(invalid, reverted);
        skillGit.restoreImplementation();
        records.push(record);
        renderProposalOutcome(record);
        continue;
      }

      await settle(record);
      lastEvidence = record.runDir;
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
