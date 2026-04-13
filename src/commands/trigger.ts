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
import { renderTriggerTable } from '../utils/table-renderer.js';
import type { Reporter } from '../reporters/index.js';
import { JsonReporter } from '../reporters/index.js';

export async function triggerCommand(
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

  Logger.debug(`\nStarting trigger evaluation for skill: ${skill_name}`);
  Logger.debug(`Agent: ${agent}`);
  Logger.debug(`Found ${tasks.length} tasks.\n`);

  // Setup Environment (global setup)
  const env = new EvalEnvironment({ workspace });
  await env.setup();

  // Setup Artifacts Directory (Always create, even if not in debug mode, for 'show' command)
  const debug = !!process.env.DEBUG;
  const startTime = new Date();
  const timestamp = startTime.toISOString().replace(/[:.]/g, '-');
  const runDir = path.resolve(workspace, '.project-skill-evals', 'runs', timestamp);
  fs.mkdirSync(runDir, { recursive: true });
  Logger.debug(`[Artifacts] Saving to: ${runDir}\n`);

  const taskResults: TaskResult[] = [];
  let tasksPassedCount = 0;

  const runner = new EvalRunner({
    agent,
    workspace,
    skillPath,
    skillName: skill_name,
    runDir,
    debug
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

          padAbortedTrials(trials, numTrials, 'Runner Execution');

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

    // Compute aggregate metrics and build report
    const { passAtK, passAtN } = aggregatePassAtK(taskResults, numTrials, r => r.trials);
    const percentage = Math.round(passAtK * 100);

    const report: EvalSuiteReport = {
      timestamp: startTime.toISOString(),
      skill_name,
      agent,
      metrics: {
        withSkillScore: `${percentage}%`,
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
    renderTriggerTable(report);
    Logger.write('\n\n');

  } finally {
    await env.teardown();
  }
}
