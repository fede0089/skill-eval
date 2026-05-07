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
import { renderFunctionalTable, renderRunHeader } from '../utils/table-renderer.js';
import type { Reporter } from '../reporters/index.js';
import { JsonReporter } from '../reporters/index.js';

import chalk from 'chalk';
import { git } from '../utils/git.js';

export async function functionalCommand(
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
      workspace: refDir, // Run inside extracted repo
      skillPath: path.join(refDir, path.relative(workspace, skillPath)), // Same relative path
      skillName: skill_name,
      runDir,
      isBaseline: false,
      debug,
      timeoutMs
    }));
  }

  // 3. Baseline Runner
  const withoutSkillRunner = new EvalRunner({
    agent, workspace, skillPath, skillName: skill_name, runDir, isBaseline: true, debug, timeoutMs
  });

  const taskResults: TaskResult[] = [];
  let withSkillTasksAllPassedCount = 0;
  let baselineTasksAllPassedCount = 0;

  const pool = new AgentPool(maxAgents);
  const ui = new ListrEvalUI();

  // Barrier chain: each prompt waits until the previous prompt's trials have all acquired slots.
  let barrier = Promise.resolve();

  // Subtask labels
  const skillVersions = Array.from(variantRunners.keys());
  const subtaskLabels = [
    ...Array.from({ length: numTrials }, (_, i) => `Without Skill ${i + 1}`),
    ...skillVersions.flatMap(v => Array.from({ length: numTrials }, (_, i) => `${v} ${i + 1}`))
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

          // 1. Without Skill trials
          const baselineTrialPromises: Promise<EvalTrial>[] = [];
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
                const passedCount = trial.assertionResults.filter(r => r.passed).length;
                const totalCount = trial.assertionResults.length;
                multi.markTrialComplete(trialId, trial.trialPassed, reason, trial.isError, passedCount, totalCount);
              }
              return trial;
            }).finally(release);
            baselineTrialPromises.push(p);
          }

          // 2. Skill variants trials
          const variantTrialsPromises: Record<string, Promise<EvalTrial>[]> = {};
          let currentSubtaskIdx = numTrials;

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
                  runner.runFunctionalTask(task, i, runnerTrialId, trialCtx, attempt)
                    .catch((error): EvalTrial => ({
                      id: runnerTrialId,
                      transcript: { error: error instanceof Error ? error.message : String(error) },
                      assertionResults: [{ assertion: `${version} Execution`, passed: false, reason: String(error) }],
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

          // All slots for this prompt have been acquired — signal the next prompt.
          resolveBarrier();

          const [woTrials, ...versionsTrials] = await Promise.all([
            Promise.all(baselineTrialPromises),
            ...Object.values(variantTrialsPromises).map(ps => Promise.all(ps))
          ]);

          const woPassedCount = woTrials.filter(t => t.trialPassed).length;
          if (woPassedCount === woTrials.length) baselineTasksAllPassedCount++;

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
                withSkillTasksAllPassedCount++;
              } else {
                localAllPassed = false;
              }
            }
          }

          const taskResult: TaskResult = {
            taskId: task.id,
            prompt: task.prompt,
            baselineTrials: woTrials.map(t => ({ ...t, transcript: undefined as any })),
            skillTrials: taskSkillTrials
          };
          taskResults.push(taskResult);

          if (!localAllPassed && !multi) {
             const failureReason = taskSkillTrials['local'].find(t => !t.trialPassed)?.assertionResults.find(r => !r.passed)?.reason || 'With Skill failed';
             throw new Error(failureReason);
          }
        }
      });
    }

    await ui.run(tasks.length);

    // ==== REPORTING ====
    const allSkillVersions = taskResults.length > 0 ? Object.keys(taskResults[0].skillTrials) : ['local'];
    const allVersions = ['baseline', ...allSkillVersions];
    
    const scores: Record<string, string> = {};
    const passAtK: Record<string, number> = {};
    const assertionPassRate: Record<string, number> = {};
    const tokenStats: Record<string, any> = {};
    const durationStats: Record<string, any> = {};

    // 1. Baseline Metrics
    const { passAtK: woPassAtK } = aggregatePassAtK(taskResults, numTrials, r => r.baselineTrials);
    const woAssertionPassRate = aggregateAssertionPassRate(taskResults, r => r.baselineTrials);
    const woPercentage = Math.round(woAssertionPassRate * 100);
    
    scores['baseline'] = `${woPercentage}%`;
    passAtK['baseline'] = Math.round(woPassAtK * 1000) / 1000;
    assertionPassRate['baseline'] = Math.round(woAssertionPassRate * 1000) / 1000;
    const woTokens = aggregateTokenStats(taskResults.flatMap(r => r.baselineTrials));
    if (woTokens) tokenStats['baseline'] = woTokens;
    const woDuration = aggregateDurationStats(taskResults.flatMap(r => r.baselineTrials));
    if (woDuration) durationStats['baseline'] = woDuration;

    // 2. Skill Variants Metrics
    for (const version of allSkillVersions) {
      const { passAtK: wiPassAtK } = aggregatePassAtK(taskResults, numTrials, r => r.skillTrials[version] || []);
      const wiAssertionPassRate = aggregateAssertionPassRate(taskResults, r => r.skillTrials[version] || []);
      const wiPercentage = Math.round(wiAssertionPassRate * 100);

      scores[version] = `${wiPercentage}%`;
      passAtK[version] = Math.round(wiPassAtK * 1000) / 1000;
      assertionPassRate[version] = Math.round(wiAssertionPassRate * 1000) / 1000;
      const wiTokens = aggregateTokenStats(taskResults.flatMap(r => r.skillTrials[version] || []));
      if (wiTokens) tokenStats[version] = wiTokens;
      const wiDuration = aggregateDurationStats(taskResults.flatMap(r => r.skillTrials[version] || []));
      if (wiDuration) durationStats[version] = wiDuration;
    }

    const report: EvalSuiteReport = {
      timestamp: startTime.toISOString(),
      skill_name,
      agent,
      metrics: {
        passedCount: withSkillTasksAllPassedCount,
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
    renderFunctionalTable(report);

    Logger.write('\n');
    new JsonReporter().generate(report, runDir);
    reporter.generate(report, runDir);

  } finally {
    process.off('SIGINT', cleanup);
    process.off('SIGTERM', cleanup);
    await env.teardown();
  }
}
