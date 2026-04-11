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

export async function triggerCommand(
  agent: string,
  skillPath: string,
  concurrency: number = 5,
  injectedSuite?: EvalSuite,
  numTrials: number = 3,
  reporter: Reporter = new JsonReporter()
): Promise<void> {
  const suite = injectedSuite || evalLoader.loadEvalSuite(skillPath);

  const { skill_name, tasks } = suite;

  Logger.debug(`\nStarting trigger evaluation for skill: ${skill_name}`);
  Logger.debug(`Agent: ${agent}`);
  Logger.debug(`Found ${tasks.length} tasks.\n`);

  // Setup Environment (global setup)
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
  let tasksPassedCount = 0;

  const runner = new EvalRunner({
    agent,
    skillPath,
    skillName: skill_name,
    runDir,
    verbose
  });

  const ui = new ListrEvalUI();

  try {
    Logger.write(`\n${chalk.bold(`TRIGGER EVALUATION: ${skillPath}`)}\n`);
    Logger.write(`\n--- Trigger Pass ---\n`);
    Logger.write(`──────────────────────────────────────────────────\n`);

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const promptSnippet = `${task.prompt.substring(0, 50)}${task.prompt.length > 50 ? '...' : ''}`;
      const taskLabel = `${promptSnippet} (#${task.id})`;
      ui.addTask({
        id: task.id,
        title: taskLabel,
        task: async (uiCtx) => {
          const trials: EvalTrial[] = [];

          for (let trialId = 1; trialId <= numTrials; trialId++) {
            if (numTrials > 1) uiCtx.updateLog(`Trial ${trialId}/${numTrials}...`);
            try {
              const trial = await runner.runTriggerTask(task, i, trialId, uiCtx);
              trials.push(trial);
            } catch (error) {
              trials.push({
                id: trialId,
                transcript: { error: error instanceof Error ? error.message : String(error) },
                assertionResults: [{
                  assertion: 'Runner Execution',
                  passed: false,
                  reason: error instanceof Error ? error.message : String(error)
                }],
                trialPassed: false
              });
              // Abort remaining trials on execution error
              break;
            }
          }

          // Pad aborted trials so totals always reflect the requested numTrials
          while (trials.length < numTrials) {
            trials.push({
              id: trials.length + 1,
              transcript: { error: 'Trial not executed (previous trial aborted)' },
              assertionResults: [{
                assertion: 'Runner Execution',
                passed: false,
                reason: 'Trial not executed (previous trial aborted)',
                graderType: 'programmatic'
              }],
              trialPassed: false
            });
          }

          const passedCount = trials.filter(t => t.trialPassed).length;
          const score = trials.length > 0 ? passedCount / trials.length : 0;

          const taskResult: TaskResult = {
            taskId: task.id,
            prompt: task.prompt,
            score,
            trials: trials.map(t => ({ ...t, transcript: undefined as any }))
          };
          taskResults.push(taskResult);

          if (passedCount === trials.length) {
            tasksPassedCount++;
          } else {
            const failureReason = trials.find(t => !t.trialPassed)?.assertionResults.find(r => !r.passed)?.reason || 'Task failed evaluation';
            throw new Error(failureReason);
          }
        }
      });
    }

    await ui.run(concurrency);

    // Final Report Rendering (outside of UI)
    // Compute aggregate pass@1 and pass@n (average across tasks)
    const passAtK = taskResults.length > 0
      ? taskResults.reduce((sum, r) => sum + computePassAtK(r.trials, 1), 0) / taskResults.length
      : 0;
    const passAtN = taskResults.length > 0
      ? taskResults.reduce((sum, r) => sum + computePassAtK(r.trials, numTrials), 0) / taskResults.length
      : 0;

    const percentage = Math.round(passAtK * 100);

    const report: EvalSuiteReport = {
      timestamp: startTime.toISOString(),
      skill_name,
      agent,
      metrics: {
        targetScore: `${percentage}%`,
        passedCount: tasksPassedCount,
        totalCount: tasks.length,
        numTrials,
        passAtK: Math.round(passAtK * 1000) / 1000,
        passAtN: Math.round(passAtN * 1000) / 1000
      },
      results: taskResults
    };

    fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf-8');
    reporter.generate(report, runDir);

    Logger.write(`\nEVALUATION SUMMARY\n`);
    Logger.write(`──────────────────────────────────────────────────\n`);

    const tableData = numTrials > 1
      ? [['ID', 'Prompt', 'Trials', 'pass@1', `pass@${numTrials}`]]
      : [['ID', 'Prompt', 'Status']];

    for (const result of taskResults) {
      const task = tasks.find(t => t.id === result.taskId);
      const promptSnippet = task ? `${task.prompt.substring(0, 40)}${task.prompt.length > 40 ? '...' : ''}` : '-';
      if (numTrials > 1) {
        const trialsStr = `${result.trials.filter(t => t.trialPassed).length}/${result.trials.length}`;
        const trials = result.score === 1.0 ? chalk.green(trialsStr) : chalk.red(trialsStr);
        const p1 = `${Math.round(computePassAtK(result.trials, 1) * 100)}%`;
        const pn = `${Math.round(computePassAtK(result.trials, numTrials) * 100)}%`;
        tableData.push([result.taskId.toString(), promptSnippet, trials, p1, pn]);
      } else {
        const statusStr = result.score === 1.0 ? 'PASS' : 'FAIL';
        const status = result.score === 1.0 ? chalk.green(statusStr) : chalk.red(statusStr);
        tableData.push([result.taskId.toString(), promptSnippet, status]);
      }
    }

    Logger.table(tableData);

    const triggerRateLine = numTrials > 1
      ? `\n   Trigger Success Rate:   pass@1: ${percentage}%   pass@${numTrials}: ${Math.round(passAtN * 100)}%`
      : `\n   Trigger Success Rate:   ${percentage}%`;
    Logger.write(`${triggerRateLine}\n\n`);

  } finally {
    await env.teardown();
  }
}
