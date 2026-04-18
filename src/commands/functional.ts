import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { EvalEnvironment } from '../core/environment.js';
import { EvalSuiteReport, TaskResult, EvalTrial, EvalSuite } from '../types/index.js';
import { Logger } from '../utils/logger.js';
import * as evalLoader from '../utils/eval-loader.js';
import { ListrEvalUI } from '../utils/ui.js';
import { EvalRunner } from '../core/eval-runner.js';
import { aggregatePassAtK } from '../core/statistics.js';
import { preflight } from '../core/preflight.js';
import { withRetry } from '../core/trial-utils.js';
import { renderFunctionalTable } from '../utils/table-renderer.js';
import type { Reporter } from '../reporters/index.js';
import { JsonReporter } from '../reporters/index.js';

export async function functionalCommand(
  agent: string,
  workspace: string,
  skillPath: string,
  concurrency: number = 5,
  injectedSuite?: EvalSuite,
  numTrials: number = 3,
  reporter: Reporter = new JsonReporter(),
  timeoutMs?: number,
  evalId?: number
): Promise<void> {
  if (!injectedSuite) preflight(agent, workspace, skillPath);
  const suite = injectedSuite || evalLoader.loadEvalSuite(skillPath);

  if (evalId !== undefined) {
    suite.tasks = suite.tasks.filter(t => t.id === evalId);
    if (suite.tasks.length === 0) {
      console.error(`No eval found with id ${evalId}`);
      process.exit(1);
    }
  }

  const { skill_name, tasks } = suite;

  Logger.debug(`\nStarting functional evaluation for skill: ${skill_name}`);
  Logger.debug(`Agent: ${agent}`);
  Logger.debug(`Found ${tasks.length} tasks.\n`);

  const env = new EvalEnvironment({ workspace });
  await env.setup();

  // Ensure worktrees are cleaned up even when the process is interrupted (Ctrl+C).
  const cleanup = () => { env.teardown().finally(() => process.exit(1)); };
  process.once('SIGINT', cleanup);
  process.once('SIGTERM', cleanup);

  // Setup Artifacts Directory (Always create, even if not in debug mode, for 'show' command)
  const debug = !!process.env.DEBUG;
  const startTime = new Date();
  const timestamp = startTime.toISOString().replace(/[:.]/g, '-');
  const runDir = path.resolve(workspace, '.project-skill-evals', 'runs', timestamp);
  fs.mkdirSync(runDir, { recursive: true });
  Logger.debug(`[Artifacts] Saving to: ${runDir}\n`);

  const taskResults: TaskResult[] = [];
  let withSkillTasksPassedCount = 0;
  let withoutSkillTasksPassedCount = 0;

  // Per-task trial storage, indexed by task.id
  const withoutSkillTrialsByTask = new Map<number, EvalTrial[]>();

  const withoutSkillRunner = new EvalRunner({
    agent,
    workspace,
    skillPath,
    skillName: skill_name,
    runDir,
    isBaseline: true,
    debug,
    timeoutMs
  });

  const withSkillRunner = new EvalRunner({
    agent,
    workspace,
    skillPath,
    skillName: skill_name,
    runDir,
    isBaseline: false,
    debug,
    timeoutMs
  });

  try {
    Logger.write(`\n${chalk.bold(`FUNCTIONAL EVALUATION: ${skillPath}`)}\n`);

    // ==== WITHOUT SKILL RUN ====
    Logger.write(`\n--- Without Skill ---\n`);
    Logger.write(`──────────────────────────────────────────────────\n`);
    const withoutSkillUI = new ListrEvalUI();

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const promptSnippet = `${task.prompt.substring(0, 50)}${task.prompt.length > 50 ? '...' : ''}`;
      const taskLabel = `${promptSnippet} (#${task.id})`;
      withoutSkillUI.addTask({
        id: `without-skill-${task.id}`,
        title: `Without Skill: ${taskLabel}`,
        numTrials,
        task: async (uiCtx, multi) => {
          let completed = 0;
          const trials = await Promise.all(
            Array.from({ length: numTrials }, (_, idx) => {
              const trialId = idx + 1;
              const trialCtx = multi?.getTrialCtx(trialId) ?? uiCtx;
              return withRetry((attempt) =>
                withoutSkillRunner.runFunctionalTask(task, i, trialId, trialCtx, attempt)
                  .catch((error): EvalTrial => ({
                    id: trialId,
                    transcript: { error: error instanceof Error ? error.message : String(error) },
                    assertionResults: [{ assertion: 'Without Skill Execution', passed: false, reason: String(error) }],
                    trialPassed: false,
                    isError: true
                  }))
              ).then(trial => {
                  if (multi) {
                    const reason = trial.assertionResults.find(r => !r.passed)?.reason;
                    multi.markTrialComplete(trialId, trial.trialPassed, reason, trial.isError);
                  } else {
                    completed++;
                    if (numTrials > 1) uiCtx.updateLog(`${completed}/${numTrials} trials done`);
                  }
                  return trial;
                });
            })
          );

          withoutSkillTrialsByTask.set(task.id, trials);

          const passedCount = trials.filter(t => t.trialPassed).length;
          if (passedCount === trials.length) {
            withoutSkillTasksPassedCount++;
          } else if (!multi) {
            const failureReason = trials.find(t => !t.trialPassed)?.assertionResults.find(r => !r.passed)?.reason || 'Without Skill failed';
            throw new Error(failureReason);
          }
        }
      });
    }

    await withoutSkillUI.run(concurrency);

    // ==== WITH SKILL RUN ====
    Logger.write(`\n--- With Skill ---\n`);
    Logger.write(`──────────────────────────────────────────────────\n`);

    const withSkillUI = new ListrEvalUI();

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const promptSnippet = `${task.prompt.substring(0, 50)}${task.prompt.length > 50 ? '...' : ''}`;
      const taskLabel = `${promptSnippet} (#${task.id})`;
      withSkillUI.addTask({
        id: `with-skill-${task.id}`,
        title: `With Skill: ${taskLabel}`,
        numTrials,
        task: async (uiCtx, multi) => {
          let completed = 0;
          const trials = await Promise.all(
            Array.from({ length: numTrials }, (_, idx) => {
              const trialId = idx + 1;
              const trialCtx = multi?.getTrialCtx(trialId) ?? uiCtx;
              return withRetry((attempt) =>
                withSkillRunner.runFunctionalTask(task, i, trialId, trialCtx, attempt)
                  .catch((error): EvalTrial => ({
                    id: trialId,
                    transcript: { error: error instanceof Error ? error.message : String(error) },
                    assertionResults: [{ assertion: 'With Skill Execution', passed: false, reason: String(error) }],
                    trialPassed: false,
                    isError: true
                  }))
              ).then(trial => {
                  if (multi) {
                    const reason = trial.assertionResults.find(r => !r.passed)?.reason;
                    multi.markTrialComplete(trialId, trial.trialPassed, reason, trial.isError);
                  } else {
                    completed++;
                    if (numTrials > 1) uiCtx.updateLog(`${completed}/${numTrials} trials done`);
                  }
                  return trial;
                });
            })
          );

          const passedCount = trials.filter(t => t.trialPassed).length;
          const score = trials.length > 0 ? passedCount / trials.length : 0;
          const withoutSkillTrials = withoutSkillTrialsByTask.get(task.id) ?? [];

          const taskResult: TaskResult = {
            taskId: task.id,
            prompt: task.prompt,
            score,
            trials: trials.map(t => ({ ...t, transcript: undefined as any })),
            withoutSkillTrials: withoutSkillTrials.map(t => ({ ...t, transcript: undefined as any }))
          };
          taskResults.push(taskResult);

          if (passedCount === trials.length) {
            withSkillTasksPassedCount++;
          } else if (!multi) {
            const failureReason = trials.find(t => !t.trialPassed)?.assertionResults.find(r => !r.passed)?.reason || 'With Skill failed';
            throw new Error(failureReason);
          }
        }
      });
    }

    await withSkillUI.run(concurrency);

    // ==== REPORTING ====
    const { passAtK, passAtN } = aggregatePassAtK(taskResults, numTrials, r => r.trials);
    const { passAtK: withoutSkillPassAtK, passAtN: withoutSkillPassAtN } = aggregatePassAtK(taskResults, numTrials, r => r.withoutSkillTrials ?? []);

    const withSkillPercentage = Math.round(passAtK * 100);
    const withoutSkillPercentage = Math.round(withoutSkillPassAtK * 100);
    const skillUplift = withSkillPercentage - withoutSkillPercentage;

    const report: EvalSuiteReport = {
      timestamp: startTime.toISOString(),
      skill_name,
      agent,
      metrics: {
        withSkillScore: `${withSkillPercentage}%`,
        withoutSkillScore: `${withoutSkillPercentage}%`,
        skillUplift: `${skillUplift > 0 ? '+' : ''}${skillUplift}%`,
        passedCount: withSkillTasksPassedCount,
        totalCount: tasks.length,
        numTrials,
        passAtK: Math.round(passAtK * 1000) / 1000,
        passAtN: Math.round(passAtN * 1000) / 1000,
        withoutSkillPassAtK: Math.round(withoutSkillPassAtK * 1000) / 1000,
        withoutSkillPassAtN: Math.round(withoutSkillPassAtN * 1000) / 1000
      },
      results: taskResults
    };

    fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf-8');

    Logger.write(`\nEVALUATION SUMMARY\n`);
    Logger.write(`──────────────────────────────────────────────────\n`);
    renderFunctionalTable(report);

    const upliftSign = skillUplift > 0 ? '+' : '';
    Logger.write(`\n   Skill Uplift:            ${upliftSign}${skillUplift}%\n`);
    Logger.write('\n');
    reporter.generate(report, runDir);

  } finally {
    process.off('SIGINT', cleanup);
    process.off('SIGTERM', cleanup);
    await env.teardown();
  }
}
