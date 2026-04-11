import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { EvalEnvironment } from '../core/environment.js';
import { EvalSuiteReport, TaskResult, EvalTrial, EvalSuite } from '../types/index.js';
import { Logger } from '../utils/logger.js';
import * as evalLoader from '../utils/eval-loader.js';
import { ListrEvalUI } from '../utils/ui.js';
import { EvalRunner } from '../core/eval-runner.js';
import { computePassAtK } from '../core/statistics.js';

export async function functionalCommand(
  agent: string,
  skillPath: string,
  concurrency: number = 5,
  injectedSuite?: EvalSuite,
  numTrials: number = 3
): Promise<void> {
  const suite = injectedSuite || evalLoader.loadEvalSuite(skillPath);

  const { skill_name, tasks } = suite;

  Logger.debug(`\nStarting functional evaluation for skill: ${skill_name}`);
  Logger.debug(`Agent: ${agent}`);
  Logger.debug(`Found ${tasks.length} tasks.\n`);

  const env = new EvalEnvironment({ skillPath });
  await env.setup();

  const verbose = !!process.env.DEBUG;
  const startTime = new Date();
  const timestamp = startTime.toISOString().replace(/[:.]/g, '-');
  const runDir = verbose
    ? path.resolve(process.cwd(), '.project-skill-evals', 'runs', timestamp)
    : '';
  if (verbose) {
    fs.mkdirSync(runDir, { recursive: true });
    Logger.debug(`[Artifacts] Saving to: ${runDir}\n`);
  }

  const taskResults: TaskResult[] = [];
  let targetTasksPassedCount = 0;
  let baselineTasksPassedCount = 0;

  // Per-task trial storage, indexed by task.id
  const baselineTrialsByTask = new Map<number, EvalTrial[]>();

  const baselineRunner = new EvalRunner({
    agent,
    skillPath,
    skillName: skill_name,
    runDir,
    isBaseline: true,
    verbose
  });

  const targetRunner = new EvalRunner({
    agent,
    skillPath,
    skillName: skill_name,
    runDir,
    isBaseline: false,
    verbose
  });

  try {
    Logger.write(`\n${chalk.bold(`FUNCTIONAL EVALUATION: ${skillPath}`)}\n`);

    // ==== BASELINE RUN ====
    Logger.write(`\n--- Baseline Pass (No Skill) ---\n`);
    Logger.write(`──────────────────────────────────────────────────\n`);
    const baselineUI = new ListrEvalUI();

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const promptSnippet = `${task.prompt.substring(0, 50)}${task.prompt.length > 50 ? '...' : ''}`;
      const taskLabel = `${promptSnippet} (#${task.id})`;
      baselineUI.addTask({
        id: `baseline-${task.id}`,
        title: `Baseline ${taskLabel}`,
        task: async (uiCtx) => {
          const trials: EvalTrial[] = [];

          for (let trialId = 1; trialId <= numTrials; trialId++) {
            if (numTrials > 1) uiCtx.updateLog(`Trial ${trialId}/${numTrials}...`);
            try {
              const trial = await baselineRunner.runFunctionalTask(task, i, trialId, uiCtx);
              trials.push(trial);
            } catch (error) {
              trials.push({
                id: trialId,
                transcript: { error: error instanceof Error ? error.message : String(error) },
                assertionResults: [{ assertion: 'Baseline Execution', passed: false, reason: String(error) }],
                trialPassed: false
              });
              break;
            }
          }

          // Pad aborted trials so totals always reflect the requested numTrials
          while (trials.length < numTrials) {
            trials.push({
              id: trials.length + 1,
              transcript: { error: 'Trial not executed (previous trial aborted)' },
              assertionResults: [{ assertion: 'Baseline Execution', passed: false, reason: 'Trial not executed (previous trial aborted)', graderType: 'programmatic' as const }],
              trialPassed: false
            });
          }

          baselineTrialsByTask.set(task.id, trials);

          const passedCount = trials.filter(t => t.trialPassed).length;
          if (passedCount === trials.length) {
            baselineTasksPassedCount++;
          } else {
            const failureReason = trials.find(t => !t.trialPassed)?.assertionResults.find(r => !r.passed)?.reason || 'Baseline failed';
            throw new Error(failureReason);
          }
        }
      });
    }

    await baselineUI.run(concurrency);

    // ==== TARGET RUN ====
    Logger.write(`\n--- Target Pass (w/Skill) ---\n`);
    Logger.write(`──────────────────────────────────────────────────\n`);

    const targetUI = new ListrEvalUI();

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const promptSnippet = `${task.prompt.substring(0, 50)}${task.prompt.length > 50 ? '...' : ''}`;
      const taskLabel = `${promptSnippet} (#${task.id})`;
      targetUI.addTask({
        id: `target-${task.id}`,
        title: `Target ${taskLabel}`,
        task: async (uiCtx) => {
          const trials: EvalTrial[] = [];

          for (let trialId = 1; trialId <= numTrials; trialId++) {
            if (numTrials > 1) uiCtx.updateLog(`Trial ${trialId}/${numTrials}...`);
            try {
              const trial = await targetRunner.runFunctionalTask(task, i, trialId, uiCtx);
              trials.push(trial);
            } catch (error) {
              trials.push({
                id: trialId,
                transcript: { error: error instanceof Error ? error.message : String(error) },
                assertionResults: [{ assertion: 'Target Execution', passed: false, reason: String(error) }],
                trialPassed: false
              });
              break;
            }
          }

          // Pad aborted trials so totals always reflect the requested numTrials
          while (trials.length < numTrials) {
            trials.push({
              id: trials.length + 1,
              transcript: { error: 'Trial not executed (previous trial aborted)' },
              assertionResults: [{ assertion: 'Target Execution', passed: false, reason: 'Trial not executed (previous trial aborted)', graderType: 'programmatic' as const }],
              trialPassed: false
            });
          }

          const passedCount = trials.filter(t => t.trialPassed).length;
          const score = trials.length > 0 ? passedCount / trials.length : 0;
          const baselineTrials = baselineTrialsByTask.get(task.id) ?? [];

          const taskResult: TaskResult = {
            taskId: task.id,
            prompt: task.prompt,
            score,
            trials: trials.map(t => ({ ...t, transcript: undefined as any })),
            baselineTrials: baselineTrials.map(t => ({ ...t, transcript: undefined as any }))
          };
          taskResults.push(taskResult);

          if (passedCount === trials.length) {
            targetTasksPassedCount++;
          } else {
            const failureReason = trials.find(t => !t.trialPassed)?.assertionResults.find(r => !r.passed)?.reason || 'Target failed';
            throw new Error(failureReason);
          }
        }
      });
    }

    await targetUI.run(concurrency);

    // ==== REPORTING ====
    // Aggregate pass@1 (average across tasks) used as the success rate
    const passAtK = taskResults.length > 0
      ? taskResults.reduce((sum, r) => sum + computePassAtK(r.trials, 1), 0) / taskResults.length
      : 0;
    const baselinePassAtK = taskResults.length > 0
      ? taskResults.reduce((sum, r) => sum + computePassAtK(r.baselineTrials ?? [], 1), 0) / taskResults.length
      : 0;

    const targetPercentage = Math.round(passAtK * 100);
    const baselinePercentage = Math.round(baselinePassAtK * 100);
    const skillUplift = targetPercentage - baselinePercentage;

    const report: EvalSuiteReport = {
      timestamp: startTime.toISOString(),
      skill_name,
      agent,
      metrics: {
        targetScore: `${targetPercentage}%`,
        baselineScore: `${baselinePercentage}%`,
        skillUplift: `${skillUplift > 0 ? '+' : ''}${skillUplift}%`,
        passedCount: targetTasksPassedCount,
        totalCount: tasks.length,
        numTrials,
        passAtK: Math.round(passAtK * 1000) / 1000,
        baselinePassAtK: Math.round(baselinePassAtK * 1000) / 1000
      },
      results: taskResults
    };

    if (verbose) {
      fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf-8');
    }

    Logger.write(`\nEVALUATION SUMMARY\n`);
    Logger.write(`──────────────────────────────────────────────────\n`);

    const tableData = [
      ['ID', 'Prompt', 'Baseline', 'Target']
    ];

    for (const result of taskResults) {
      const task = tasks.find(t => t.id === result.taskId);
      const promptSnippet = task ? `${task.prompt.substring(0, 40)}${task.prompt.length > 40 ? '...' : ''}` : '-';

      const baselineTrials = result.baselineTrials ?? [];
      const targetTrials = result.trials;

      const baselineStr = numTrials > 1
        ? `${baselineTrials.filter(t => t.trialPassed).length}/${baselineTrials.length}`
        : (baselineTrials[0]?.trialPassed ? 'PASS' : 'FAIL');
      const targetStr = numTrials > 1
        ? `${targetTrials.filter(t => t.trialPassed).length}/${targetTrials.length}`
        : (targetTrials[0]?.trialPassed ? 'PASS' : 'FAIL');

      const baselineStatus = baselineTrials.every(t => t.trialPassed) ? chalk.green(baselineStr) : chalk.red(baselineStr);
      const targetStatus = targetTrials.every(t => t.trialPassed) ? chalk.green(targetStr) : chalk.red(targetStr);
      tableData.push([result.taskId.toString(), promptSnippet, baselineStatus, targetStatus]);
    }

    Logger.table(tableData);

    const baselineRateLine = `\n   Baseline Success Rate:   ${baselinePercentage}%`;
    const targetRateLine   = `   Target Success Rate:     ${targetPercentage}%`;

    Logger.write(`${baselineRateLine}\n`);
    Logger.write(`${targetRateLine}\n`);
    Logger.write('\n');

  } finally {
    await env.teardown();
  }
}
