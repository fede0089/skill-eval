import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { EvalEnvironment } from '../core/environment.js';
import { TriggerGrader } from '../core/evaluator.js';
import { EvalSuiteReport, TaskResult, AssertionResult, EvalSuite } from '../types/index.js';
import { Logger } from '../utils/logger.js';
import * as evalLoader from '../utils/eval-loader.js';
import { ListrEvalUI } from '../utils/ui.js';
import { EvalRunner } from '../core/eval-runner.js';

export async function triggerCommand(
  agent: string, 
  skillPath: string,
  concurrency: number = 5,
  injectedSuite?: EvalSuite
): Promise<void> {
  const suite = injectedSuite || evalLoader.loadEvalSuite(skillPath);

  const { skill_name, tasks } = suite;

  Logger.debug(`\nStarting trigger evaluation for skill: ${skill_name}`);
  Logger.debug(`Agent: ${agent}`);
  Logger.debug(`Found ${tasks.length} tasks.\n`);

  // Setup Environment (global setup)
  const env = new EvalEnvironment({ skillPath });
  await env.setup();

  // Setup Artifacts Directory
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
    runDir
  });

  const ui = new ListrEvalUI();

  try {
    Logger.write(`\n${chalk.bold(`TRIGGER EVALUATION: ${skillPath}`)}\n`);
    Logger.write(`\n--- Trigger Pass ---\n`);
    Logger.write(`──────────────────────────────────────────────────\n`);

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      ui.addTask({
        id: task.id || `task-${i}`,
        title: `Task ${i + 1}/${tasks.length}: ${task.prompt.substring(0, 50)}${task.prompt.length > 50 ? '...' : ''}`,
        task: async (uiCtx) => {
          const trial = await runner.runTriggerTask(task, i, uiCtx);
          
          const taskResult: TaskResult = {
            taskId: task.id || `task-${i}`,
            prompt: task.prompt,
            score: trial.trialPassed ? 1.0 : 0.0,
            trials: [trial]
          };

          taskResults.push(taskResult);
          if (trial.trialPassed) {
            tasksPassedCount++;
          }
        }
      });
    }

    await ui.run(concurrency);

    // Final Report Rendering (outside of UI)
    const percentage = Math.round((tasksPassedCount / tasks.length) * 100);

    const report: EvalSuiteReport = {
      timestamp: startTime.toISOString(),
      skill_name,
      agent,
      metrics: {
        targetScore: `${percentage}%`,
        passedCount: tasksPassedCount,
        totalCount: tasks.length
      },
      results: taskResults
    };

    fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf-8');

    const triggerRateLine = `   Trigger Success Rate:   ${percentage}% (${tasksPassedCount}/${tasks.length})`;

    Logger.write(`\nEVALUATION SUMMARY\n`);
    Logger.write(`──────────────────────────────────────────────────\n`);
    Logger.write(`${triggerRateLine}\n`);
    Logger.write('\n');

  } finally {
    await env.teardown();
  }
}
