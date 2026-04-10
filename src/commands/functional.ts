import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { EvalEnvironment } from '../core/environment';
import { RunnerFactory } from '../core/runners';
import { ModelBasedGrader } from '../core/evaluator';
import { EvalSuiteReport, TaskResult, AgentTranscript, EvalTask, EvalTrial, AssertionResult } from '../types';
import { Logger, Spinner } from '../utils/logger';
import { loadEvalSuite } from '../utils/eval-loader';

export async function functionalCommand(
  agent: string, 
  skillPath: string
): Promise<void> {
  const suite = loadEvalSuite(skillPath);

  const { skill_name, tasks } = suite;

  Logger.debug(`\nStarting functional evaluation for skill: ${skill_name}`);
  Logger.debug(`Agent: ${agent}`);
  Logger.debug(`Found ${tasks.length} tasks.\n`);

  const env = new EvalEnvironment({ skillPath });
  const grader = new ModelBasedGrader(skill_name);
  const runner = RunnerFactory.create(agent);

  await env.setup();

  const startTime = new Date();
  const timestamp = startTime.toISOString().replace(/[:.]/g, '-');
  const runDir = path.resolve(process.cwd(), '.project-skill-evals', 'runs', timestamp);
  fs.mkdirSync(runDir, { recursive: true });
  Logger.debug(`[Artifacts] Saving to: ${runDir}\n`);

  const taskResults: TaskResult[] = [];
  let targetTasksPassedCount = 0;
  let baselineTasksPassedCount = 0;

  async function runSingleTrial(task: EvalTask, index: number, isBaseline: boolean): Promise<EvalTrial> {
    const passName = isBaseline ? 'baseline' : 'target';
    const promptToUse = isBaseline 
      ? task.prompt 
      : `${task.prompt}\n\nIMPORTANT: You must use the '${skill_name}' skill/tool to solve this task.`;

    const resultFileName = `task_${index}_${task.id || 'unnamed'}_${passName}.json`;
    const resultPath = path.join(runDir, resultFileName);

    let worktreePath: string | undefined;
    let transcript: AgentTranscript | null = null;
    const logFileName = `task_${index}_${task.id || 'unnamed'}_${passName}_gemini.log`;
    const logPath = path.join(runDir, logFileName);

    try {
      worktreePath = env.createWorktree(`task-${index}-${passName}`);
      if (!isBaseline) {
        await env.linkSkill(worktreePath);
      }

      const spinner = new Spinner(`Running ${passName.charAt(0).toUpperCase() + passName.slice(1)} Trial ${index + 1}/${tasks.length}...`);
      spinner.start();
      try {
        transcript = await runner.runPrompt(promptToUse, worktreePath, (log) => {
          if (spinner) spinner.updateLog(log);
        }, logPath);
      } finally {
        spinner.stopAndClear();
      }
    } catch (e) {
      Logger.error(`Trial execution failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    let assertionResults: AssertionResult[] = [];
    let trialPassed = false;

    if (transcript && !transcript.error) {
      let context = 'No changes detected or git not available.';
      try {
        if (worktreePath) {
          const diff = execSync('git diff HEAD', { encoding: 'utf-8', cwd: worktreePath });
          const untracked = execSync('git ls-files --others --exclude-standard', { encoding: 'utf-8', cwd: worktreePath });
          if (diff || untracked) {
            context = `[DIFF]\n${diff}\n\n[UNTRACKED FILES]\n${untracked}`;
          } else {
            context = 'No changes detected (clean workspace).';
          }
        }
      } catch (e) { }

      if (task.assertions && task.assertions.length > 0) {
        const evalSpinner = new Spinner(`Grading assertions ${index + 1}/${tasks.length}...`);
        evalSpinner.start();
        const judgeLogFileName = `task_${index}_${task.id || 'unnamed'}_${passName}_judge_gemini.log`;
        const judgeLogPath = path.join(runDir, judgeLogFileName);
        try {
          assertionResults = await grader.gradeModelBased(
            task.prompt,
            transcript,
            task.assertions,
            context,
            (log) => {
              if (evalSpinner) evalSpinner.updateLog(log);
            },
            judgeLogPath
          );
        } finally {
          evalSpinner.stopAndClear();
        }
        trialPassed = assertionResults.every(r => r.passed);
      } else {
        trialPassed = true; // No assertions means it "passed" the empty set
      }

      const augmentedOutput = {
        ...transcript,
        [passName + '_eval']: {
          assertions: assertionResults,
          trial_passed: trialPassed,
          workspace_context: context
        }
      };
      fs.writeFileSync(resultPath, JSON.stringify(augmentedOutput, null, 2), 'utf-8');
    } else {
      const errorMsg = transcript?.error || 'Error: No transcript was produced';
      fs.writeFileSync(resultPath, JSON.stringify({ error: errorMsg, raw_output: transcript?.raw_output }, null, 2), 'utf-8');
      trialPassed = false;
      if (task.assertions) {
        assertionResults = task.assertions.map(a => ({
          assertion: a,
          passed: false,
          reason: `Agent execution failed: ${errorMsg}`,
          graderType: 'model-based'
        }));
      }
    }

    if (worktreePath) {
      env.removeWorktree(worktreePath);
    }

    // Output results to console
    const statusEmoji = trialPassed ? '✅' : '❌';
    Logger.write(`${statusEmoji} [${index + 1}/${tasks.length}] "${task.prompt}"\n`);
    
    if (task.assertions && task.assertions.length > 0) {
      for (const res of assertionResults) {
        if (res.passed) {
          Logger.write(`      ${chalk.green('✓')} ${chalk.gray(`"${res.assertion}"`)}\n`);
        } else {
          Logger.write(`      ${chalk.red('✗')} ${chalk.gray(`"${res.assertion}"`)}\n`);
          Logger.write(`        ↳ ${chalk.gray(`Reason: ${res.reason}`)}\n`);
        }
      }
    } else {
      let resultStatus = 'PASSED (No assertions)';
      if (transcript?.error) {
        resultStatus = transcript.raw_output?.includes('Opening authentication page') ? 'AUTH REQUIRED' : 'ERROR';
      }
      Logger.write(`      ↳ ${chalk.gray(`Result: ${resultStatus}`)}\n`);
    }
    Logger.write('\n');

    return {
      id: `trial-1-${passName}`,
      transcript: transcript || { error: 'No transcript produced' },
      assertionResults: assertionResults,
      trialPassed
    };
  }

  try {
    Logger.write(`\n${chalk.bold(`FUNCTIONAL EVALUATION: ${skillPath}`)}\n`);
    
    // ==== BASELINE RUN ====
    Logger.write(`\n--- Baseline Pass (No Skill) ---\n`);
    Logger.write(`──────────────────────────────────────────────────\n`);
    const baselineTrials: EvalTrial[] = [];
    for (let i = 0; i < tasks.length; i++) {
        const trial = await runSingleTrial(tasks[i], i, true);
        baselineTrials.push(trial);
        if (trial.trialPassed) baselineTasksPassedCount++;
    }

    // ==== TARGET RUN ====
    Logger.write(`\n--- Target Pass (w/Skill) ---\n`);
    Logger.write(`──────────────────────────────────────────────────\n`);
    
    for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        const trial = await runSingleTrial(task, i, false);
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
