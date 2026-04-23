import * as fs from 'fs';
import * as path from 'path';
import { EvalEnvironment } from '../core/environment.js';
import { EvalSuiteReport, TaskResult, EvalTrial, EvalSuite } from '../types/index.js';
import { Logger } from '../utils/logger.js';
import * as evalLoader from '../utils/eval-loader.js';
import { ListrEvalUI } from '../utils/ui.js';
import { EvalRunner } from '../core/eval-runner.js';
import { AgentPool } from '../core/agent-pool.js';
import { aggregatePassAtK, aggregateTokenStats } from '../core/statistics.js';
import { preflight } from '../core/preflight.js';
import { withRetry } from '../core/trial-utils.js';
import { renderFunctionalTable, renderRunHeader } from '../utils/table-renderer.js';
import type { Reporter } from '../reporters/index.js';
import { JsonReporter } from '../reporters/index.js';

export async function functionalCommand(
  agent: string,
  workspace: string,
  skillPath: string,
  maxAgents: number = 4,
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

  const pool = new AgentPool(maxAgents);
  const ui = new ListrEvalUI();

  // Barrier chain: each prompt waits until the previous prompt's trials have all acquired slots.
  let barrier = Promise.resolve();

  // Subtask labels: Without Skill 1..N then With Skill 1..N for each prompt
  const subtaskLabels = [
    ...Array.from({ length: numTrials }, (_, i) => `Without Skill ${i + 1}`),
    ...Array.from({ length: numTrials }, (_, i) => `With Skill ${i + 1}`)
  ];

  try {
    renderRunHeader({ command: 'functional', skillName: skill_name, agent, workspace, tasks: tasks.length, trials: numTrials, maxAgents, timeoutMs, runDir, evalId });
    Logger.write(`──────────────────────────────────────────────────\n`);

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const promptSnippet = `${task.prompt.substring(0, 50)}${task.prompt.length > 50 ? '...' : ''}`;
      const taskLabel = `${promptSnippet} (#${task.id})`;

      const thisBarrier = barrier;
      let resolveBarrier!: () => void;
      barrier = new Promise<void>(r => { resolveBarrier = r; });

      ui.addTask({
        id: task.id,
        title: taskLabel,
        subtaskLabels,
        task: async (uiCtx, multi) => {
          await thisBarrier;

          // ── Without Skill trials (subtask IDs 1..numTrials) ──────────────
          const woPromises: Promise<EvalTrial>[] = [];
          for (let idx = 0; idx < numTrials; idx++) {
            const trialId = idx + 1;
            const trialCtx = multi?.getTrialCtx(trialId) ?? uiCtx;
            const release = await pool.acquire();
            const p = withRetry(
              (attempt) =>
                withoutSkillRunner.runFunctionalTask(task, i, trialId, trialCtx, attempt)
                  .catch((error): EvalTrial => ({
                    id: trialId,
                    transcript: { error: error instanceof Error ? error.message : String(error) },
                    assertionResults: [{ assertion: 'Without Skill Execution', passed: false, reason: String(error) }],
                    trialPassed: false,
                    isError: true
                  })),
              2,
              1000,
              (nextAttempt, lastTrial) => {
                const reason = lastTrial.assertionResults[0]?.reason ?? 'infrastructure error';
                trialCtx.updateLog(`Retry ${nextAttempt}/2 — ${reason.substring(0, 50)}`);
              }
            ).then(trial => {
              if (multi) {
                const reason = trial.assertionResults.find(r => !r.passed)?.reason;
                multi.markTrialComplete(trialId, trial.trialPassed, reason, trial.isError);
              }
              return trial;
            }).finally(release);
            woPromises.push(p);
          }

          // ── With Skill trials (subtask IDs numTrials+1..2*numTrials) ─────
          const wiPromises: Promise<EvalTrial>[] = [];
          for (let idx = 0; idx < numTrials; idx++) {
            const subtaskId = numTrials + idx + 1;   // Listr subtask position
            const runnerTrialId = idx + 1;            // 1-based trial number within WI pass
            const trialCtx = multi?.getTrialCtx(subtaskId) ?? uiCtx;
            const release = await pool.acquire();
            const p = withRetry(
              (attempt) =>
                withSkillRunner.runFunctionalTask(task, i, runnerTrialId, trialCtx, attempt)
                  .catch((error): EvalTrial => ({
                    id: runnerTrialId,
                    transcript: { error: error instanceof Error ? error.message : String(error) },
                    assertionResults: [{ assertion: 'With Skill Execution', passed: false, reason: String(error) }],
                    trialPassed: false,
                    isError: true
                  })),
              2,
              1000,
              (nextAttempt, lastTrial) => {
                const reason = lastTrial.assertionResults[0]?.reason ?? 'infrastructure error';
                trialCtx.updateLog(`Retry ${nextAttempt}/2 — ${reason.substring(0, 50)}`);
              }
            ).then(trial => {
              if (multi) {
                const reason = trial.assertionResults.find(r => !r.passed)?.reason;
                multi.markTrialComplete(subtaskId, trial.trialPassed, reason, trial.isError);
              }
              return trial;
            }).finally(release);
            wiPromises.push(p);
          }

          // All WO + WI slots for this prompt have been acquired — signal the next prompt.
          resolveBarrier();

          const [woTrials, wiTrials] = await Promise.all([
            Promise.all(woPromises),
            Promise.all(wiPromises)
          ]);

          withoutSkillTrialsByTask.set(task.id, woTrials);

          const woPassedCount = woTrials.filter(t => t.trialPassed).length;
          if (woPassedCount === woTrials.length) withoutSkillTasksPassedCount++;

          const wiPassedCount = wiTrials.filter(t => t.trialPassed).length;
          const score = wiTrials.length > 0 ? wiPassedCount / wiTrials.length : 0;
          const withoutSkillTrials = withoutSkillTrialsByTask.get(task.id) ?? [];

          const taskResult: TaskResult = {
            taskId: task.id,
            prompt: task.prompt,
            score,
            trials: wiTrials.map(t => ({ ...t, transcript: undefined as any })),
            withoutSkillTrials: withoutSkillTrials.map(t => ({ ...t, transcript: undefined as any }))
          };
          taskResults.push(taskResult);

          if (wiPassedCount === wiTrials.length) {
            withSkillTasksPassedCount++;
          } else if (!multi) {
            const failureReason = wiTrials.find(t => !t.trialPassed)?.assertionResults.find(r => !r.passed)?.reason || 'With Skill failed';
            throw new Error(failureReason);
          }
        }
      });
    }

    await ui.run(tasks.length);

    // ==== REPORTING ====
    const { passAtK } = aggregatePassAtK(taskResults, numTrials, r => r.trials);
    const { passAtK: withoutSkillPassAtK } = aggregatePassAtK(taskResults, numTrials, r => r.withoutSkillTrials ?? []);

    const withSkillPercentage = Math.round(passAtK * 100);
    const withoutSkillPercentage = Math.round(withoutSkillPassAtK * 100);
    const skillUplift = withSkillPercentage - withoutSkillPercentage;

    const withSkillTokenStats    = aggregateTokenStats(taskResults.flatMap(r => r.trials)) ?? undefined;
    const withoutSkillTokenStats = aggregateTokenStats(taskResults.flatMap(r => r.withoutSkillTrials ?? [])) ?? undefined;

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
        withoutSkillPassAtK: Math.round(withoutSkillPassAtK * 1000) / 1000,
        tokenStats: (withSkillTokenStats || withoutSkillTokenStats)
          ? { withSkill: withSkillTokenStats, withoutSkill: withoutSkillTokenStats }
          : undefined
      },
      results: taskResults
    };

    Logger.write(`\nEVALUATION SUMMARY\n`);
    Logger.write(`──────────────────────────────────────────────────\n`);
    renderFunctionalTable(report);

    const upliftSign = skillUplift > 0 ? '+' : '';
    Logger.write(`\n   Skill Uplift:            ${upliftSign}${skillUplift}%\n`);
    Logger.write('\n');
    new JsonReporter().generate(report, runDir);
    reporter.generate(report, runDir);

  } finally {
    process.off('SIGINT', cleanup);
    process.off('SIGTERM', cleanup);
    await env.teardown();
  }
}
