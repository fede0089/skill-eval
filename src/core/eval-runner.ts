import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { EvalEnvironment } from './environment.js';
import { RunnerFactory, AgentRunner } from './runners/index.js';
import { AgentTranscript, EvalTask, EvalTrial, AssertionResult } from '../types/index.js';
import { TriggerGrader, ModelBasedGrader } from './evaluator.js';
import { EvalTaskContext } from '../utils/ui.js';

export interface EvalRunOptions {
  agent: string;
  skillPath: string;
  skillName: string;
  runDir: string;
  isBaseline?: boolean;
}

export class EvalRunner {
  private env: EvalEnvironment;
  private runner: AgentRunner;
  private triggerGrader: TriggerGrader;
  private functionalGrader: ModelBasedGrader;

  constructor(private options: EvalRunOptions) {
    this.env = new EvalEnvironment({ skillPath: options.skillPath });
    this.runner = RunnerFactory.create(options.agent);
    this.triggerGrader = new TriggerGrader(options.skillName);
    this.functionalGrader = new ModelBasedGrader(options.skillName);
  }

  async runTriggerTask(task: EvalTask, index: number, uiCtx: EvalTaskContext): Promise<EvalTrial> {
    const logFileName = `task_${index}_${task.id || 'unnamed'}_gemini.log`;
    const logPath = path.join(this.options.runDir, logFileName);

    let worktreePath: string | undefined;
    let transcript: AgentTranscript | null = null;

    try {
      worktreePath = this.env.createWorktree(`task-${index}`);
      await this.env.linkSkill(worktreePath);

      transcript = await this.runner.runPrompt(task.prompt, worktreePath, (log: string) => {
        uiCtx.updateLog(log);
      }, logPath);
    } finally {
      if (worktreePath) {
        this.env.removeWorktree(worktreePath);
      }
    }

    let triggered = false;
    const assertionResults: AssertionResult[] = [];

    if (transcript && !transcript.error) {
      triggered = this.triggerGrader.gradeTrigger(transcript);
      assertionResults.push({
        assertion: 'Skill was triggered',
        passed: triggered,
        reason: triggered ? 'Detected skill activation in transcript' : 'No skill activation detected in transcript',
        graderType: 'programmatic'
      });
    } else {
      const errorMsg = transcript?.error || 'Error: No transcript was produced';
      assertionResults.push({
        assertion: 'Skill was triggered',
        passed: false,
        reason: errorMsg,
        graderType: 'programmatic'
      });
    }

    return {
      id: 'trial-1',
      transcript: transcript || { error: 'No transcript produced' },
      assertionResults: assertionResults,
      trialPassed: triggered
    };
  }

  async runFunctionalTask(task: EvalTask, index: number, uiCtx: EvalTaskContext): Promise<EvalTrial> {
    const isBaseline = this.options.isBaseline;
    const passName = isBaseline ? 'baseline' : 'target';
    const promptToUse = isBaseline 
      ? task.prompt 
      : `${task.prompt}\n\nIMPORTANT: You must use the '${this.options.skillName}' skill/tool to solve this task.`;

    const logFileName = `task_${index}_${task.id || 'unnamed'}_${passName}_gemini.log`;
    const logPath = path.join(this.options.runDir, logFileName);

    let worktreePath: string | undefined;
    let transcript: AgentTranscript | null = null;

    try {
      worktreePath = this.env.createWorktree(`task-${index}-${passName}`);
      if (!isBaseline) {
        await this.env.linkSkill(worktreePath);
      }

      transcript = await this.runner.runPrompt(promptToUse, worktreePath, (log: string) => {
        uiCtx.updateLog(log);
      }, logPath);
    } catch (e) {
      // Error handled below via transcript being null
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
        const judgeLogFileName = `task_${index}_${task.id || 'unnamed'}_${passName}_judge_gemini.log`;
        const judgeLogPath = path.join(this.options.runDir, judgeLogFileName);
        assertionResults = await this.functionalGrader.gradeModelBased(
          task.prompt,
          transcript,
          task.assertions,
          context,
          (log) => { uiCtx.updateLog(`Grading: ${log}`); },
          judgeLogPath
        );
        trialPassed = assertionResults.every(r => r.passed);
      } else {
        trialPassed = true;
      }

      return {
        id: `trial-1-${passName}`,
        transcript: transcript || { error: 'No transcript produced' },
        assertionResults: assertionResults,
        trialPassed
      };
    } else {
      const errorMsg = transcript?.error || 'Error: No transcript was produced';
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
      this.env.removeWorktree(worktreePath);
    }

    return {
      id: `trial-1-${passName}`,
      transcript: { error: transcript?.error || 'No transcript produced' },
      assertionResults: assertionResults,
      trialPassed
    };
  }
}
