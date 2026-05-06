import * as fs from 'fs';
import * as path from 'path';
import { EvalEnvironment } from '../core/environment.js';
import { EvalSuiteReport, TaskResult, EvalTrial, EvalSuite } from '../types/index.js';
import { Logger } from '../utils/logger.js';
import * as evalLoader from '../utils/eval-loader.js';
import { ListrEvalUI } from '../utils/ui.js';
import { EvalRunner } from '../core/eval-runner.js';
import { AgentPool } from '../core/agent-pool.js';
import { aggregatePassAtK, aggregateAssertionPassRate, aggregateTokenStats, aggregateDurationStats } from '../core/statistics.js';
import { preflight } from '../core/preflight.js';
import { withRetry } from '../core/trial-utils.js';
import { renderTriggerTable, renderRunHeader } from '../utils/table-renderer.js';
import { JsonReporter } from '../reporters/index.js';
import chalk from 'chalk';
import { git } from '../utils/git.js';
import type { Reporter } from '../reporters/index.js';

export async function triggerCommand(
  agent: string,
  workspace: string,
  skillPath: string,
  maxAgents: number = 4,
  injectedSuite?: EvalSuite,
  numTrials: number = 3,
  reporter: Reporter = new JsonReporter(),
  timeoutMs?: number,
  evalId?: number,
  compareRefs: string[] = []
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

  const refPathBase = path.resolve(workspace, '.project-skill-evals', 'skill-refs');
  const variantRunners = new Map<string, EvalRunner>();

  // 1. Local Runner
  variantRunners.set('local', new EvalRunner({
    agent, workspace, skillPath, skillName: skill_name, runDir, isBaseline: false, debug, timeoutMs
  }));

  // 2. Historical Runners
  for (const ref of compareRefs) {
    const refDir = path.join(refPathBase, ref);
    Logger.write(`   Extracting ref '${ref}'... `);
    git.extractSkillRef(skillPath, ref, refDir);
    Logger.write(chalk.green('Done\n'));
    
    variantRunners.set(`ref:${ref}`, new EvalRunner({
      agent,
      workspace: refDir,
      skillPath: path.join(refDir, path.relative(workspace, skillPath)),
      skillName: skill_name,
      runDir,
      isBaseline: false,
      debug,
      timeoutMs
    }));
  }

  const taskResults: TaskResult[] = [];
  let tasksPassedCount = 0;

  const pool = new AgentPool(maxAgents);
  const ui = new ListrEvalUI();

  // Barrier chain: each prompt waits until the previous prompt's trials have all acquired slots.
  let barrier = Promise.resolve();

  // Subtask labels
  const skillVersions = Array.from(variantRunners.keys());
  const subtaskLabels = skillVersions.flatMap(v => Array.from({ length: numTrials }, (_, i) => `${v} ${i + 1}`));

  try {
    renderRunHeader({ command: 'trigger', skillName: skill_name, agent, workspace, tasks: tasks.length, trials: numTrials, maxAgents, timeoutMs, runDir, evalId });
    Logger.write(`--- Trigger Pass ---\n`);
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

          const variantTrialsPromises: Record<string, Promise<EvalTrial>[]> = {};
          let currentSubtaskIdx = 0;

          for (const [version, runner] of variantRunners.entries()) {
            variantTrialsPromises[version] = [];
            for (let idx = 0; idx < numTrials; idx++) {
              currentSubtaskIdx++;
              const subtaskId = currentSubtaskIdx;
              const runnerTrialId = idx + 1;
              const trialCtx = multi?.getTrialCtx(subtaskId) ?? uiCtx;
              const release = await pool.acquire();
              const p = withRetry(
                (attempt) =>
                  runner.runTriggerTask(task, i, runnerTrialId, trialCtx, attempt)
                    .catch((error): EvalTrial => ({
                      id: runnerTrialId,
                      transcript: { error: error instanceof Error ? error.message : String(error) },
                      assertionResults: [{
                        assertion: `${version} Execution`,
                        passed: false,
                        reason: error instanceof Error ? error.message : String(error)
                      }],
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
                  const passedCount = trial.assertionResults.filter(r => r.passed).length;
                  const totalCount = trial.assertionResults.length;
                  multi.markTrialComplete(subtaskId, trial.trialPassed, reason, trial.isError, passedCount, totalCount);
                }
                return trial;
              }).finally(release);
              variantTrialsPromises[version].push(p);
            }
          }

          // All slots for this prompt have acquired a slot — signal the next prompt.
          resolveBarrier();

          const versionsTrials = await Promise.all(
            Object.values(variantTrialsPromises).map(ps => Promise.all(ps))
          );

          const taskSkillTrials: Record<string, EvalTrial[]> = {};
          const variantNames = Object.keys(variantTrialsPromises);
          
          let localAllPassed = true;
          for (let vIdx = 0; vIdx < variantNames.length; vIdx++) {
            const vName = variantNames[vIdx];
            const vTrials = versionsTrials[vIdx];
            taskSkillTrials[vName] = vTrials.map(t => ({ ...t, transcript: undefined as any }));
            
            if (vName === 'local') {
              const passedCount = vTrials.filter(t => t.trialPassed).length;
              if (passedCount === vTrials.length) {
                tasksPassedCount++;
              } else {
                localAllPassed = false;
              }
            }
          }

          const taskResult: TaskResult = {
            taskId: task.id,
            prompt: task.prompt,
            baselineTrials: [],
            skillTrials: taskSkillTrials
          };
          taskResults.push(taskResult);

          if (!localAllPassed && !multi) {
            const failureReason = taskSkillTrials['local'].find(t => t.trialPassed === false)?.assertionResults.find(r => !r.passed)?.reason || 'Task failed evaluation';
            throw new Error(failureReason);
          }
        }
      });
    }

    await ui.run(tasks.length);

    // Compute aggregate metrics and build report
    const allSkillVersions = taskResults.length > 0 ? Object.keys(taskResults[0].skillTrials) : ['local'];
    const scores: Record<string, string> = {};
    const passAtK: Record<string, number> = {};
    const assertionPassRate: Record<string, number> = {};
    const tokenStats: Record<string, any> = {};
    const durationStats: Record<string, any> = {};

    for (const version of allSkillVersions) {
      const { passAtK: vPassAtK } = aggregatePassAtK(taskResults, numTrials, r => r.skillTrials[version] || []);
      const percentage = Math.round(vPassAtK * 100);

      scores[version] = `${percentage}%`;
      passAtK[version] = Math.round(vPassAtK * 1000) / 1000;
      const vAssertionRate = aggregateAssertionPassRate(taskResults, r => r.skillTrials[version] || []);
      assertionPassRate[version] = Math.round(vAssertionRate * 1000) / 1000;

      const vTokens = aggregateTokenStats(taskResults.flatMap(r => r.skillTrials[version] || []));
      if (vTokens) tokenStats[version] = vTokens;
      const vDuration = aggregateDurationStats(taskResults.flatMap(r => r.skillTrials[version] || []));
      if (vDuration) durationStats[version] = vDuration;
    }

    const report: EvalSuiteReport = {
      timestamp: startTime.toISOString(),
      skill_name,
      agent,
      metrics: {
        passedCount: tasksPassedCount,
        totalCount: tasks.length,
        numTrials,
        scores,
        passAtK,
        assertionPassRate,
        tokenStats,
        durationStats
      },
      results: taskResults
    };

    Logger.write(`\nEVALUATION SUMMARY\n`);
    Logger.write(`──────────────────────────────────────────────────\n`);
    renderTriggerTable(report);
    Logger.write('\n\n');
    new JsonReporter().generate(report, runDir);
    reporter.generate(report, runDir);

  } finally {
    process.off('SIGINT', cleanup);
    process.off('SIGTERM', cleanup);
    await env.teardown();
  }
}
