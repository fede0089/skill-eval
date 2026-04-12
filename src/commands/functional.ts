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
import { padAbortedTrials } from '../core/trial-utils.js';
import { preflight } from '../core/preflight.js';
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
  reporter: Reporter = new JsonReporter()
): Promise<void> {
  if (!injectedSuite) preflight(agent, workspace, skillPath);
  const suite = injectedSuite || evalLoader.loadEvalSuite(skillPath);

  const { skill_name, tasks } = suite;

  Logger.debug(`\nStarting functional evaluation for skill: ${skill_name}`);
  Logger.debug(`Agent: ${agent}`);
  Logger.debug(`Found ${tasks.length} tasks.\n`);

  const env = new EvalEnvironment({ workspace, skillPath });
  await env.setup();

  // Setup Artifacts Directory (Always create, even if not verbose, for 'show' command)
  const verbose = !!process.env.DEBUG;
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
    verbose
  });

  const withSkillRunner = new EvalRunner({
    agent,
    workspace,
    skillPath,
    skillName: skill_name,
    runDir,
    isBaseline: false,
    verbose
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
        task: async (uiCtx) => {
          const trials: EvalTrial[] = [];

          for (let trialId = 1; trialId <= numTrials; trialId++) {
            if (numTrials > 1) uiCtx.updateLog(`Trial ${trialId}/${numTrials}...`);
            try {
              const trial = await withoutSkillRunner.runFunctionalTask(task, i, trialId, uiCtx);
              trials.push(trial);
            } catch (error) {
              trials.push({
                id: trialId,
                transcript: { error: error instanceof Error ? error.message : String(error) },
                assertionResults: [{ assertion: 'Without Skill Execution', passed: false, reason: String(error) }],
                trialPassed: false
              });
              break;
            }
          }

          padAbortedTrials(trials, numTrials, 'Without Skill Execution');

          withoutSkillTrialsByTask.set(task.id, trials);

          const passedCount = trials.filter(t => t.trialPassed).length;
          if (passedCount === trials.length) {
            withoutSkillTasksPassedCount++;
          } else {
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
        task: async (uiCtx) => {
          const trials: EvalTrial[] = [];

          for (let trialId = 1; trialId <= numTrials; trialId++) {
            if (numTrials > 1) uiCtx.updateLog(`Trial ${trialId}/${numTrials}...`);
            try {
              const trial = await withSkillRunner.runFunctionalTask(task, i, trialId, uiCtx);
              trials.push(trial);
            } catch (error) {
              trials.push({
                id: trialId,
                transcript: { error: error instanceof Error ? error.message : String(error) },
                assertionResults: [{ assertion: 'With Skill Execution', passed: false, reason: String(error) }],
                trialPassed: false
              });
              break;
            }
          }

          padAbortedTrials(trials, numTrials, 'With Skill Execution');

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
          } else {
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
    reporter.generate(report, runDir);

    Logger.write(`\nEVALUATION SUMMARY\n`);
    Logger.write(`──────────────────────────────────────────────────\n`);
    renderFunctionalTable(report);

    const upliftSign = skillUplift > 0 ? '+' : '';
    Logger.write(`\n   Skill Uplift:            ${upliftSign}${skillUplift}%\n`);
    Logger.write('\n');

  } finally {
    await env.teardown();
  }
}
