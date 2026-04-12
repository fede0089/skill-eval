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
import type { Reporter } from '../core/reporters/index.js';
import { JsonReporter } from '../core/reporters/index.js';

export async function functionalCommand(
  agent: string,
  skillPath: string,
  concurrency: number = 5,
  injectedSuite?: EvalSuite,
  numTrials: number = 3,
  reporter: Reporter = new JsonReporter()
): Promise<void> {
  const suite = injectedSuite || evalLoader.loadEvalSuite(skillPath);

  const { skill_name, tasks } = suite;

  Logger.debug(`\nStarting functional evaluation for skill: ${skill_name}`);
  Logger.debug(`Agent: ${agent}`);
  Logger.debug(`Found ${tasks.length} tasks.\n`);

  const env = new EvalEnvironment({ skillPath });
  await env.setup();

  // Setup Artifacts Directory (Always create, even if not verbose, for 'show' command)
  const verbose = !!process.env.DEBUG;
  const startTime = new Date();
  const timestamp = startTime.toISOString().replace(/[:.]/g, '-');
  const runDir = path.resolve(process.cwd(), '.project-skill-evals', 'runs', timestamp);
  fs.mkdirSync(runDir, { recursive: true });
  Logger.debug(`[Artifacts] Saving to: ${runDir}\n`);

  const taskResults: TaskResult[] = [];
  let withSkillTasksPassedCount = 0;
  let withoutSkillTasksPassedCount = 0;

  // Per-task trial storage, indexed by task.id
  const withoutSkillTrialsByTask = new Map<number, EvalTrial[]>();

  const withoutSkillRunner = new EvalRunner({
    agent,
    skillPath,
    skillName: skill_name,
    runDir,
    isBaseline: true,
    verbose
  });

  const withSkillRunner = new EvalRunner({
    agent,
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

          // Pad aborted trials so totals always reflect the requested numTrials
          while (trials.length < numTrials) {
            trials.push({
              id: trials.length + 1,
              transcript: { error: 'Trial not executed (previous trial aborted)' },
              assertionResults: [{ assertion: 'Without Skill Execution', passed: false, reason: 'Trial not executed (previous trial aborted)', graderType: 'programmatic' as const }],
              trialPassed: false
            });
          }

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

          // Pad aborted trials so totals always reflect the requested numTrials
          while (trials.length < numTrials) {
            trials.push({
              id: trials.length + 1,
              transcript: { error: 'Trial not executed (previous trial aborted)' },
              assertionResults: [{ assertion: 'With Skill Execution', passed: false, reason: 'Trial not executed (previous trial aborted)', graderType: 'programmatic' as const }],
              trialPassed: false
            });
          }

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
    // Aggregate pass@1 and pass@n (average across tasks)
    const passAtK = taskResults.length > 0
      ? taskResults.reduce((sum, r) => sum + computePassAtK(r.trials, 1), 0) / taskResults.length
      : 0;
    const passAtN = taskResults.length > 0
      ? taskResults.reduce((sum, r) => sum + computePassAtK(r.trials, numTrials), 0) / taskResults.length
      : 0;
    const withoutSkillPassAtK = taskResults.length > 0
      ? taskResults.reduce((sum, r) => sum + computePassAtK(r.withoutSkillTrials ?? [], 1), 0) / taskResults.length
      : 0;
    const withoutSkillPassAtN = taskResults.length > 0
      ? taskResults.reduce((sum, r) => sum + computePassAtK(r.withoutSkillTrials ?? [], numTrials), 0) / taskResults.length
      : 0;

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

    const tableData = numTrials > 1
      ? [['ID', 'Prompt', 'W/o p@1', `W/o p@${numTrials}`, 'W/ p@1', `W/ p@${numTrials}`]]
      : [['ID', 'Prompt', 'W/o Skill', 'W/ Skill']];

    for (const result of taskResults) {
      const task = tasks.find(t => t.id === result.taskId);
      const promptSnippet = task ? `${task.prompt.substring(0, 40)}${task.prompt.length > 40 ? '...' : ''}` : '-';

      const withoutSkillTrials = result.withoutSkillTrials ?? [];
      const withSkillTrials = result.trials;

      if (numTrials > 1) {
        const bp1 = `${Math.round(computePassAtK(withoutSkillTrials, 1) * 100)}%`;
        const bpn = `${Math.round(computePassAtK(withoutSkillTrials, numTrials) * 100)}%`;
        const tp1 = `${Math.round(computePassAtK(withSkillTrials, 1) * 100)}%`;
        const tpn = `${Math.round(computePassAtK(withSkillTrials, numTrials) * 100)}%`;
        const bColor = withoutSkillTrials.every(t => t.trialPassed) ? chalk.green : chalk.red;
        const tColor = withSkillTrials.every(t => t.trialPassed) ? chalk.green : chalk.red;
        tableData.push([result.taskId.toString(), promptSnippet, bColor(bp1), bColor(bpn), tColor(tp1), tColor(tpn)]);
      } else {
        const withoutSkillStr = withoutSkillTrials[0]?.trialPassed ? 'PASS' : 'FAIL';
        const withSkillStr = withSkillTrials[0]?.trialPassed ? 'PASS' : 'FAIL';
        const withoutSkillStatus = withoutSkillTrials.every(t => t.trialPassed) ? chalk.green(withoutSkillStr) : chalk.red(withoutSkillStr);
        const withSkillStatus = withSkillTrials.every(t => t.trialPassed) ? chalk.green(withSkillStr) : chalk.red(withSkillStr);
        tableData.push([result.taskId.toString(), promptSnippet, withoutSkillStatus, withSkillStatus]);
      }
    }

    Logger.table(tableData);

    const withoutSkillRateLine = numTrials > 1
      ? `\n   Without Skill Rate:   pass@1: ${withoutSkillPercentage}%   pass@${numTrials}: ${Math.round(withoutSkillPassAtN * 100)}%`
      : `\n   Without Skill Rate:   ${withoutSkillPercentage}%`;
    const withSkillRateLine = numTrials > 1
      ? `   With Skill Rate:      pass@1: ${withSkillPercentage}%   pass@${numTrials}: ${Math.round(passAtN * 100)}%`
      : `   With Skill Rate:      ${withSkillPercentage}%`;

    const upliftSign = skillUplift > 0 ? '+' : '';
    const upliftLine = `   Skill Uplift:            ${upliftSign}${skillUplift}%`;

    Logger.write(`${withoutSkillRateLine}\n`);
    Logger.write(`${withSkillRateLine}\n`);
    Logger.write(`${upliftLine}\n`);
    Logger.write('\n');

  } finally {
    await env.teardown();
  }
}
