import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { EvalEnvironment } from '../core/environment.js';
import { EvalSuiteReport, TaskResult, EvalTrial } from '../types/index.js';
import { Logger } from '../utils/logger.js';
import { loadEvalSuite } from '../utils/eval-loader.js';
import { ListrEvalUI } from '../utils/ui.js';
import { EvalRunner } from '../core/eval-runner.js';

export async function functionalCommand(
  agent: string, 
  skillPath: string,
  concurrency: number = 5
): Promise<void> {
  const suite = loadEvalSuite(skillPath);

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
        baselineUI.addTask({
            id: `baseline-${i}`,
            title: `Baseline ${i + 1}/${tasks.length}: ${task.prompt.substring(0, 50)}${task.prompt.length > 50 ? '...' : ''}`,
            task: async (uiCtx) => {
                const trial = await baselineRunner.runFunctionalTask(task, i, uiCtx);
                baselineTrials[i] = trial;
                if (trial.trialPassed) baselineTasksPassedCount++;
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
        targetUI.addTask({
            id: `target-${i}`,
            title: `Target ${i + 1}/${tasks.length}: ${task.prompt.substring(0, 50)}${task.prompt.length > 50 ? '...' : ''}`,
            task: async (uiCtx) => {
                const trial = await targetRunner.runFunctionalTask(task, i, uiCtx);
                if (trial.trialPassed) targetTasksPassedCount++;

                const taskResult: TaskResult = {
                    taskId: task.id || `task-${i}`,
                    prompt: task.prompt,
                    score: trial.trialPassed ? 1.0 : 0.0,
                    trials: [trial],
                    baselineTrials: [baselineTrials[i]]
                };
                taskResults.push(taskResult);
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

    const baselineRateLine = `   Baseline Success Rate:   ${baselinePercentage}%  (${baselineTasksPassedCount}/${tasks.length})`;
    const targetRateLine   = `   Target Success Rate:     ${targetPercentage}% (${targetTasksPassedCount}/${tasks.length})`;

    Logger.write(`\nEVALUATION SUMMARY\n`);
    Logger.write(`──────────────────────────────────────────────────\n`);
    Logger.write(`${baselineRateLine}\n`);
    Logger.write(`${targetRateLine}\n`);
    Logger.write('\n');

  } finally {
    await env.teardown();
  }
}
