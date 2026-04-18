import * as fs from 'fs';
import * as path from 'path';
import { EvalEnvironment } from '../core/environment.js';
import { EvalSuiteReport, TaskResult, EvalTrial, EvalSuite } from '../types/index.js';
import { Logger } from '../utils/logger.js';
import * as evalLoader from '../utils/eval-loader.js';
import { ListrEvalUI } from '../utils/ui.js';
import { EvalRunner } from '../core/eval-runner.js';
import { aggregatePassAtK } from '../core/statistics.js';
import { preflight } from '../core/preflight.js';
import { withRetry } from '../core/trial-utils.js';
import { renderTriggerTable, renderRunHeader } from '../utils/table-renderer.js';
import type { Reporter } from '../reporters/index.js';
import { JsonReporter } from '../reporters/index.js';

export async function triggerCommand(
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

  // Setup Environment (global setup)
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

  const taskResults: TaskResult[] = [];
  let tasksPassedCount = 0;

  const runner = new EvalRunner({
    agent,
    workspace,
    skillPath,
    skillName: skill_name,
    runDir,
    debug,
    timeoutMs
  });

  const ui = new ListrEvalUI();

  try {
    renderRunHeader({ command: 'trigger', skillName: skill_name, agent, workspace, tasks: tasks.length, trials: numTrials, concurrency, timeoutMs: timeoutMs ?? 600000, runDir, evalId });
    Logger.write(`--- Trigger Pass ---\n`);
    Logger.write(`──────────────────────────────────────────────────\n`);

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const promptSnippet = `${task.prompt.substring(0, 50)}${task.prompt.length > 50 ? '...' : ''}`;
      const taskLabel = `${promptSnippet} (#${task.id})`;
      ui.addTask({
        id: task.id,
        title: taskLabel,
        numTrials,
        task: async (uiCtx, multi) => {
          let completed = 0;
          const trials = await Promise.all(
            Array.from({ length: numTrials }, (_, idx) => {
              const trialId = idx + 1;
              const trialCtx = multi?.getTrialCtx(trialId) ?? uiCtx;
              return withRetry((attempt) =>
                runner.runTriggerTask(task, i, trialId, trialCtx, attempt)
                  .catch((error): EvalTrial => ({
                    id: trialId,
                    transcript: { error: error instanceof Error ? error.message : String(error) },
                    assertionResults: [{
                      assertion: 'Runner Execution',
                      passed: false,
                      reason: error instanceof Error ? error.message : String(error)
                    }],
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

          const taskResult: TaskResult = {
            taskId: task.id,
            prompt: task.prompt,
            score,
            trials: trials.map(t => ({ ...t, transcript: undefined as any }))
          };
          taskResults.push(taskResult);

          if (passedCount === trials.length) {
            tasksPassedCount++;
          } else if (!multi) {
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

    Logger.write(`\nEVALUATION SUMMARY\n`);
    Logger.write(`──────────────────────────────────────────────────\n`);
    renderTriggerTable(report);
    Logger.write('\n\n');
    reporter.generate(report, runDir);

  } finally {
    process.off('SIGINT', cleanup);
    process.off('SIGTERM', cleanup);
    await env.teardown();
  }
}
