import * as fs from 'fs';
import * as path from 'path';
import { executor } from '../utils/exec.js';
import { EvalEnvironment } from './environment.js';
import { RunnerFactory, AgentRunner } from '../runners/index.js';
import { AgentTranscript, EvalTask, EvalTrial, AssertionResult } from '../types/index.js';
import { TriggerGrader, ModelBasedGrader } from './evaluator.js';
import { EvalTaskContext } from '../utils/ui.js';
import { parseNdjsonEvents, parseStreamResult, parseTokenStats } from '../utils/ndjson.js';
import { Logger } from '../utils/logger.js';

export interface EvalRunOptions {
  agent: string;
  workspace: string;
  skillPath: string;
  skillName: string;
  runDir: string;
  isBaseline?: boolean;
  debug?: boolean;
  timeoutMs?: number;
  judgeRetryDelayMs?: number;
}


export class EvalRunner {
  private env: EvalEnvironment;
  private runner: AgentRunner;
  private triggerGrader: TriggerGrader;
  private functionalGrader: ModelBasedGrader;

  constructor(private options: EvalRunOptions) {
    this.env = new EvalEnvironment({ workspace: options.workspace });
    this.runner = RunnerFactory.create(options.agent);
    this.triggerGrader = new TriggerGrader(options.skillName, this.runner.skillDispatchToolName);
    // Inject the same runner for judging so swapping the agent backend works end-to-end
    this.functionalGrader = new ModelBasedGrader(options.skillName, this.runner);
  }

  async runTriggerTask(task: EvalTask, index: number, trialId: number, uiCtx: EvalTaskContext, attempt = 0): Promise<EvalTrial> {
    const logFileName = `task_${task.id}_trial_${trialId}.log`;
    const logPath = this.options.debug ? path.join(this.options.runDir, logFileName) : undefined;

    let worktreePath: string | undefined;
    let transcript: AgentTranscript | null = null;
    let durationMs: number | undefined;

    const worktreeId = attempt > 0 ? `task-${task.id}-trial-${trialId}-r${attempt}` : `task-${task.id}-trial-${trialId}`;
    if (attempt > 0) {
      const prevId = attempt === 1
        ? `task-${task.id}-trial-${trialId}`
        : `task-${task.id}-trial-${trialId}-r${attempt - 1}`;
      this.env.removeWorktree(path.resolve(this.options.workspace, '.project-skill-evals', 'worktrees', prevId));
    }
    try {
      uiCtx.updateLog('Setting up…');
      worktreePath = this.env.createWorktree(worktreeId);
      await this.runner.linkSkill(path.resolve(this.options.workspace, this.options.skillPath), worktreePath);
      this.runner.applyRunnerConfig(path.resolve(this.options.workspace, this.options.skillPath, 'evals', 'config'), worktreePath);

      uiCtx.updateLog('Executing prompt…');
      const startMs = Date.now();
      transcript = await this.runner.runPrompt(task.prompt, worktreePath, undefined, logPath, undefined, this.options.timeoutMs);
      durationMs = Date.now() - startMs;
    } finally {
      if (worktreePath) {
        this.env.removeWorktree(worktreePath);
      }
    }

    // Propagate stream-json errors: when the agent fails, Gemini CLI still
    // writes a {"type":"result","status":"error",...} event to stdout so transcript.error
    // is never set by the runner. Parse it here so the grading path is skipped correctly.
    if (transcript && !transcript.error) {
      const streamResult = parseStreamResult(transcript.response || '');
      if (streamResult && 'error' in streamResult) {
        transcript.error = streamResult.error;
      }
    }

    // Extract token stats from the agent's NDJSON stream (never from the judge).
    const tokenStats = transcript
      ? parseTokenStats(transcript.response || '') ?? undefined
      : undefined;

    let triggered = false;
    const assertionResults: AssertionResult[] = [];

    if (transcript && !transcript.error) {
      uiCtx.updateLog('Grading…');
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
      return {
        id: trialId,
        transcript: transcript || { error: 'No transcript produced' },
        assertionResults,
        trialPassed: false,
        isError: true,
        tokenStats,
        durationMs
      };
    }

    return {
      id: trialId,
      transcript: transcript || { error: 'No transcript produced' },
      assertionResults: assertionResults,
      trialPassed: triggered,
      tokenStats,
      durationMs
    };
  }

  async runFunctionalTask(task: EvalTask, index: number, trialId: number, uiCtx: EvalTaskContext, attempt = 0): Promise<EvalTrial> {
    const skillDisabled = this.options.isBaseline;
    const evalModeLabel = skillDisabled ? 'without-skill' : 'with-skill';
    const promptToUse = skillDisabled
      ? `${task.prompt}\n\nIMPORTANT: For this task, you MUST NOT use the '${this.options.skillName}' skill/tool, even if it appears available.`
      : `${task.prompt}\n\nIMPORTANT: You must use the '${this.options.skillName}' skill/tool to solve this task.`;

    const logFileName = `task_${task.id}_${evalModeLabel}_trial_${trialId}.log`;
    const logPath = this.options.debug ? path.join(this.options.runDir, logFileName) : undefined;

    let worktreePath: string | undefined;
    let assertionResults: AssertionResult[] = [];
    let trialPassed = false;
    let transcript: AgentTranscript | null = null;
    let durationMs: number | undefined;

    const worktreeId = attempt > 0 ? `task-${task.id}-${evalModeLabel}-trial-${trialId}-r${attempt}` : `task-${task.id}-${evalModeLabel}-trial-${trialId}`;
    if (attempt > 0) {
      const prevId = attempt === 1
        ? `task-${task.id}-${evalModeLabel}-trial-${trialId}`
        : `task-${task.id}-${evalModeLabel}-trial-${trialId}-r${attempt - 1}`;
      this.env.removeWorktree(path.resolve(this.options.workspace, '.project-skill-evals', 'worktrees', prevId));
    }
    try {
      uiCtx.updateLog('Setting up…');
      worktreePath = this.env.createWorktree(worktreeId);
      if (!skillDisabled) {
        await this.runner.linkSkill(path.resolve(this.options.workspace, this.options.skillPath), worktreePath);
      }
      this.runner.applyRunnerConfig(path.resolve(this.options.workspace, this.options.skillPath, 'evals', 'config'), worktreePath);

      uiCtx.updateLog('Executing prompt…');
      if (logPath) fs.appendFileSync(logPath, `\n# SECTION: ${evalModeLabel.toUpperCase()} AGENT RUN\n`);
      const startMs = Date.now();
      transcript = await this.runner.runPrompt(promptToUse, worktreePath, undefined, logPath, undefined, this.options.timeoutMs);
      durationMs = Date.now() - startMs;

      // Propagate stream-json errors: when the agent fails (e.g. quota), Gemini CLI still
      // writes a {"type":"result","status":"error",...} event to stdout so transcript.error
      // is never set by the runner. Parse it here so the grading path is skipped correctly.
      if (transcript && !transcript.error) {
        const streamResult = parseStreamResult(transcript.response || '');
        if (streamResult && 'error' in streamResult) {
          transcript.error = streamResult.error;
        }
      }

      // Extract token stats from the agent's NDJSON stream (never from the judge).
      const tokenStats = transcript
        ? parseTokenStats(transcript.response || '') ?? undefined
        : undefined;

      if (transcript && !transcript.error) {
        if (skillDisabled && this.triggerGrader.detectSkillAttempt(transcript)) {
          return {
            id: trialId,
            transcript,
            assertionResults: [{
              assertion: 'Baseline must not invoke the restricted skill',
              passed: false,
              reason: `Invalid Without Skill: '${this.options.skillName}' activation detected during without-skill run`,
              graderType: 'programmatic'
            }],
            trialPassed: false,
            tokenStats,
            durationMs
          };
        }
        if (!skillDisabled && !this.triggerGrader.gradeTrigger(transcript)) {
          return {
            id: trialId,
            transcript,
            assertionResults: [{
              assertion: 'Target pass must invoke the skill',
              passed: false,
              reason: `Invalid With Skill: '${this.options.skillName}' was not successfully activated`,
              graderType: 'programmatic'
            }],
            trialPassed: false,
            tokenStats,
            durationMs
          };
        }

        let context = 'No changes detected or git not available.';
        try {
          if (worktreePath) {
            const diff = executor.execSync('git diff HEAD', { encoding: 'utf-8', cwd: worktreePath });
            const untracked = executor.execSync('git ls-files --others --exclude-standard', { encoding: 'utf-8', cwd: worktreePath });
            if (diff || untracked) {
              context = `[DIFF]\n${diff}\n\n[UNTRACKED FILES]\n${untracked}`;
            } else {
              context = 'No changes detected (clean workspace).';
            }
          }
        } catch (e) { }

        if (task.assertions && task.assertions.length > 0) {
          uiCtx.updateLog('Grading…');
          if (logPath) fs.appendFileSync(logPath, `\n# SECTION: ${evalModeLabel.toUpperCase()} JUDGE RUN\n`);
          // Use the already-parsed stream result to get clean text for the judge.
          const streamResult = parseStreamResult(transcript.response || '');
          const streamText = streamResult && 'response' in streamResult ? streamResult.response : '';
          const gradingTranscript = streamText ? { ...transcript, response: streamText } : transcript;

          // Retry only the judge on infrastructure failures (timeout, interactive prompt, etc.).
          // The agent has already run successfully — no need to re-run it.
          const MAX_JUDGE_RETRIES = 2;
          const judgeDelayMs = this.options.judgeRetryDelayMs ?? 1000;
          let judgeErrorAfterAllRetries: Error | null = null;
          for (let judgeAttempt = 0; judgeAttempt <= MAX_JUDGE_RETRIES; judgeAttempt++) {
            if (judgeAttempt > 0) {
              uiCtx.updateLog(`Judge error, retrying (${judgeAttempt}/${MAX_JUDGE_RETRIES})…`);
              await new Promise(r => setTimeout(r, judgeDelayMs * Math.pow(2, judgeAttempt - 1)));
            }
            try {
              assertionResults = await this.functionalGrader.gradeModelBased(
                task.prompt,
                gradingTranscript,
                task.assertions,
                context,
                (log) => { uiCtx.updateLog(`Grading: ${log}`); },
                logPath,
                worktreePath
              );
              judgeErrorAfterAllRetries = null;
              break;
            } catch (e) {
              judgeErrorAfterAllRetries = e instanceof Error ? e : new Error(String(e));
            }
          }

          if (judgeErrorAfterAllRetries) {
            // Judge exhausted all retries — return an inconclusive failure.
            // isError is intentionally NOT set so the outer withRetry does not
            // re-run the expensive agent for a judge infrastructure issue.
            const reason = judgeErrorAfterAllRetries.message;
            return {
              id: trialId,
              transcript: transcript || { error: 'No transcript produced' },
              assertionResults: task.assertions.map(a => ({
                assertion: a, passed: false, reason, graderType: 'model-based' as const
              })),
              trialPassed: false,
              tokenStats,
              durationMs
            };
          }

          trialPassed = assertionResults.every(r => r.passed);
        } else {
          trialPassed = true;
        }

        return {
          id: trialId,
          transcript: transcript || { error: 'No transcript produced' },
          assertionResults: assertionResults,
          trialPassed,
          tokenStats,
          durationMs
        };
      } else {
        const errorMsg = transcript?.error || 'Error: No transcript was produced';
        if (task.assertions) {
          assertionResults = task.assertions.map(a => ({
            assertion: a,
            passed: false,
            reason: `Agent execution failed: ${errorMsg}`,
            graderType: 'model-based' as const
          }));
        }
        // isError return — finally still runs cleanup
        return {
          id: trialId,
          transcript: { error: transcript?.error || 'No transcript produced' },
          assertionResults,
          trialPassed: false,
          isError: true,
          tokenStats,
          durationMs
        };
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      if (task.assertions) {
        assertionResults = task.assertions.map(a => ({
          assertion: a,
          passed: false,
          reason: `Execution failed: ${errorMsg}`,
          graderType: 'model-based' as const
        }));
      }
      // isError return — finally still runs cleanup
      return {
        id: trialId,
        transcript: { error: errorMsg },
        assertionResults,
        trialPassed: false,
        isError: true
      };
    } finally {
      if (worktreePath) {
        this.env.removeWorktree(worktreePath);
      }
    }

    // Unreachable: all paths above return explicitly.
    // This satisfies TypeScript's control-flow analysis.
    return {
      id: trialId,
      transcript: { error: 'No transcript produced' },
      assertionResults,
      trialPassed: false,
      isError: true
    };
  }
}
