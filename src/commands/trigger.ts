import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { EvalEnvironment } from '../core/environment';
import { RunnerFactory } from '../core/runners';
import { TriggerGrader } from '../core/evaluator';
import { EvalSuiteReport, TaskResult, AgentTranscript, EvalTrial, AssertionResult } from '../types';
import { Logger, Spinner } from '../utils/logger';
import { loadEvalSuite } from '../utils/eval-loader';

export async function triggerCommand(
  agent: string, 
  skillPath: string
): Promise<void> {
  const suite = loadEvalSuite(skillPath);

  const { skill_name, tasks } = suite;

  Logger.debug(`\nStarting trigger evaluation for skill: ${skill_name}`);
  Logger.debug(`Agent: ${agent}`);
  Logger.debug(`Found ${tasks.length} tasks.\n`);

  // Setup Environment
  const env = new EvalEnvironment({ skillPath });
  const grader = new TriggerGrader(skill_name);

  const runner = RunnerFactory.create(agent);

  await env.setup();

  // Setup Artifacts Directory
  const startTime = new Date();
  const timestamp = startTime.toISOString().replace(/[:.]/g, '-');
  const runDir = path.resolve(process.cwd(), '.project-skill-evals', 'runs', timestamp);
  fs.mkdirSync(runDir, { recursive: true });
  Logger.debug(`[Artifacts] Saving to: ${runDir}\n`);

  const taskResults: TaskResult[] = [];
  let tasksPassedCount = 0;

  try {
    Logger.write(`\n${chalk.bold(`TRIGGER EVALUATION: ${skillPath}`)}\n`);
    Logger.write(`\n--- Trigger Pass ---\n`);
    Logger.write(`──────────────────────────────────────────────────\n`);

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const resultFileName = `task_${i}_${task.id || 'unnamed'}.json`;
      const resultPath = path.join(runDir, resultFileName);

      let worktreePath: string | undefined;
      let transcript: AgentTranscript | null = null;
      const logFileName = `task_${i}_${task.id || 'unnamed'}_gemini.log`;
      const logPath = path.join(runDir, logFileName);

      try {
        // Create isolated worktree for this task
        worktreePath = env.createWorktree(`task-${i}`);
        await env.linkSkill(worktreePath);

        // Run agent strictly inside the worktree
        const spinner = new Spinner(`Running Task ${i + 1}/${tasks.length}...`);
        spinner.start();

        try {
          transcript = await runner.runPrompt(task.prompt, worktreePath, (log) => {
            if (spinner) spinner.updateLog(log);
          }, logPath);
        } finally {
          spinner.stopAndClear();
        }
      } finally {
        // Cleanup worktree immediately after run
        if (worktreePath) {
          env.removeWorktree(worktreePath);
        }
      }

      let triggered = false;
      const assertionResults: AssertionResult[] = [];

      if (transcript && !transcript.error) {
        triggered = grader.gradeTrigger(transcript);
        
        assertionResults.push({
          assertion: 'Skill was triggered',
          passed: triggered,
          reason: triggered ? 'Detected skill activation in transcript' : 'No skill activation detected in transcript',
          graderType: 'programmatic'
        });

        // Persist the transcript
        fs.writeFileSync(resultPath, JSON.stringify(transcript, null, 2), 'utf-8');
      } else {
        const errorMsg = transcript?.error || 'Error: No transcript was produced';
        assertionResults.push({
          assertion: 'Skill was triggered',
          passed: false,
          reason: errorMsg,
          graderType: 'programmatic'
        });
        fs.writeFileSync(resultPath, JSON.stringify({ error: errorMsg, raw_output: transcript?.raw_output }, null, 2), 'utf-8');
      }

      const trial: EvalTrial = {
        id: 'trial-1',
        transcript: transcript || { error: 'No transcript produced' },
        assertionResults: assertionResults,
        trialPassed: triggered
      };

      const taskResult: TaskResult = {
        taskId: task.id || `task-${i}`,
        prompt: task.prompt,
        score: triggered ? 1.0 : 0.0,
        trials: [trial]
      };

      taskResults.push(taskResult);

      if (triggered) {
        tasksPassedCount++;
        Logger.write(`✅ [${i + 1}/${tasks.length}] "${task.prompt}"\n`);
        Logger.write(`      ${chalk.green('✓')} ${chalk.gray(`Skill triggered`)}\n`);
      } else {
        let resultStatus = 'NOT TRIGGERED';
        if (transcript?.error) {
          if (transcript.raw_output?.includes('Opening authentication page')) {
            resultStatus = 'AUTH REQUIRED';
          } else {
            resultStatus = 'ERROR';
          }
        }
        Logger.write(`❌ [${i + 1}/${tasks.length}] "${task.prompt}"\n`);
        Logger.write(`      ${chalk.red('✗')} ${chalk.gray(`Skill triggered`)}\n`);
        Logger.write(`        ↳ ${chalk.gray(`Result: ${resultStatus}`)}\n`);
      }
      Logger.write('\n');
    }

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
