import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { EvalEnvironment } from '../core/environment.js';
import { EvalSuiteReport, TaskResult, EvalTrial, EvalSuite } from '../types/index.js';
import { Logger } from '../utils/logger.js';
import * as evalLoader from '../utils/eval-loader.js';
import { ListrEvalUI } from '../utils/ui.js';
import { EvalRunner } from '../core/eval-runner.js';

export async function functionalCommand(
  agent: string, 
  skillPath: string,
  concurrency: number = 5,
  injectedSuite?: EvalSuite
): Promise<void> {
  const suite = injectedSuite || evalLoader.loadEvalSuite(skillPath);

  const { skill_name, tasks } = suite;

  Logger.debug(`\nStarting functional evaluation for skill: ${skill_name}`);
  Logger.debug(`Agent: ${agent}`);
  Logger.debug(`Found ${tasks.length} tasks.\n`);

  const env = new EvalEnvironment({ skillPath });
  await env.setup();

  const startTime = new Date();
  const timestamp = startTime.toISOString().replace(/[:.]/g, '-');
  const runDir = path.resolve(process.cwd(), '.project-skill-evals', 'runs', timestamp);
  fs.mkdirSync(runDir, { recursive: true });
  Logger.debug(`[Artifacts] Saving to: ${runDir}\n`);

  const taskResults: TaskResult[] = [];
  let targetTasksPassedCount = 0;
  let baselineTasksPassedCount = 0;

  const baselineRunner = new EvalRunner({
    agent,
    skillPath,
    skillName: skill_name,
    runDir,
    isBaseline: true
  });

  const targetRunner = new EvalRunner({
    agent,
    skillPath,
    skillName: skill_name,
    runDir,
    isBaseline: false
  });

  try {
    Logger.write(`\n${chalk.bold(`FUNCTIONAL EVALUATION: ${skillPath}`)}\n`);
    
    // ==== BASELINE RUN ====
    Logger.write(`\n--- Baseline Pass (No Skill) ---\n`);
    Logger.write(`──────────────────────────────────────────────────\n`);
    const baselineTrials: EvalTrial[] = new Array(tasks.length);
    const baselineUI = new ListrEvalUI();

    for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        const promptSnippet = `${task.prompt.substring(0, 50)}${task.prompt.length > 50 ? '...' : ''}`;
        const taskLabel = `${promptSnippet} (#${task.id})`;
        baselineUI.addTask({
            id: `baseline-${task.id}`,
            title: `Baseline ${taskLabel}`,
            task: async (uiCtx) => {
                let trial;
                try {
                    trial = await baselineRunner.runFunctionalTask(task, i, uiCtx);
                } catch (error) {
                    baselineTrials[i] = {
                        id: 1,
                        transcript: { error: error instanceof Error ? error.message : String(error) },
                        assertionResults: [{ assertion: 'Baseline Execution', passed: false, reason: String(error) }],
                        trialPassed: false
                    };
                    throw error;
                }
                baselineTrials[i] = trial;
                if (trial.trialPassed) {
                    baselineTasksPassedCount++;
                } else {
                    const failureReason = trial.assertionResults.find(r => !r.passed)?.reason || 'Baseline failed';
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
                let trial;
                try {
                    trial = await targetRunner.runFunctionalTask(task, i, uiCtx);
                } catch (error) {
                    const taskResult: TaskResult = {
                        taskId: task.id,
                        prompt: task.prompt,
                        score: 0.0,
                        trials: [{
                            id: 1,
                            transcript: { error: error instanceof Error ? error.message : String(error) },
                            assertionResults: [{ assertion: 'Target Execution', passed: false, reason: String(error) }],
                            trialPassed: false
                        }],
                        baselineTrials: [
                            { ...baselineTrials[i], transcript: undefined as any }
                        ]
                    };
                    taskResults.push(taskResult);
                    throw error;
                }
                
                const taskResult: TaskResult = {
                    taskId: task.id,
                    prompt: task.prompt,
                    score: trial.trialPassed ? 1.0 : 0.0,
                    trials: [
                        { ...trial, transcript: undefined as any }
                    ],
                    baselineTrials: [
                        { ...baselineTrials[i], transcript: undefined as any }
                    ]
                };
                taskResults.push(taskResult);

                if (trial.trialPassed) {
                    targetTasksPassedCount++;
                } else {
                    const failureReason = trial.assertionResults.find(r => !r.passed)?.reason || 'Target failed';
                    throw new Error(failureReason);
                }
            }
        });
    }

    await targetUI.run(concurrency);

    // ==== REPORTING ====
    const targetPercentage = Math.round((targetTasksPassedCount / tasks.length) * 100);
    const baselinePercentage = Math.round((baselineTasksPassedCount / tasks.length) * 100);
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
        totalCount: tasks.length
      },
      results: taskResults
    };

    fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf-8');

    Logger.write(`\nEVALUATION SUMMARY\n`);
    Logger.write(`──────────────────────────────────────────────────\n`);

    const tableData = [
      ['ID', 'Prompt', 'Baseline', 'Target']
    ];

    for (const result of taskResults) {
      const task = tasks.find(t => t.id === result.taskId);
      const promptSnippet = task ? `${task.prompt.substring(0, 40)}${task.prompt.length > 40 ? '...' : ''}` : '-';
      const baselineStatus = result.baselineTrials?.[0].trialPassed ? chalk.green('PASS') : chalk.red('FAIL');
      const targetStatus = result.trials?.[0].trialPassed ? chalk.green('PASS') : chalk.red('FAIL');
      tableData.push([result.taskId.toString(), promptSnippet, baselineStatus, targetStatus]);
    }

    Logger.table(tableData);

    const baselineRateLine = `\n   Baseline Success Rate:   ${baselinePercentage}%  (${baselineTasksPassedCount}/${tasks.length})`;
    const targetRateLine   = `   Target Success Rate:     ${targetPercentage}% (${targetTasksPassedCount}/${tasks.length})`;

    Logger.write(`${baselineRateLine}\n`);
    Logger.write(`${targetRateLine}\n`);
    Logger.write('\n');

  } finally {
    await env.teardown();
  }
}
