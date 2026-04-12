import * as fs from 'fs';
import * as path from 'path';
import { executor } from '../utils/exec.js';
import { EvalEnvironment } from './environment.js';
import { RunnerFactory, AgentRunner } from './runners/index.js';
import { AgentTranscript, EvalTask, EvalTrial, AssertionResult, NdjsonResultEvent } from '../types/index.js';
import { TriggerGrader, ModelBasedGrader } from './evaluator.js';
import { EvalTaskContext } from '../utils/ui.js';
import { parseNdjsonEvents } from '../utils/ndjson.js';
import { Logger } from '../utils/logger.js';

export interface EvalRunOptions {
  agent: string;
  workspace: string;
  skillPath: string;
  skillName: string;
  runDir: string;
  isBaseline?: boolean;
  verbose?: boolean;
}

/**
 * Parses the Gemini CLI stream-json result event from stdout.
 * Returns { error } if the run failed, or { response } with the clean text on success.
 * Returns null if no result event is found (non-stream output).
 */
function parseStreamResult(output: string): { error: string } | { response: string } | null {
  const parts: string[] = [];
  let resultEvent: NdjsonResultEvent | null = null;

  for (const event of parseNdjsonEvents(output)) {
    if (event.type === 'message' && event.role === 'assistant' && typeof event.content === 'string') {
      parts.push(event.content);
    } else if (event.type === 'result') {
      resultEvent = event;
    }
  }

  if (!resultEvent) return null;
  if (resultEvent.status === 'error') {
    const msg = resultEvent.error?.message || 'Agent run failed';
    return { error: msg };
  }
  // Success: prefer collected assistant messages, fall back to result.response
  const text = parts.join('\n').trim() || (typeof resultEvent.response === 'string' ? resultEvent.response : '');
  return { response: text };
}

export class EvalRunner {
  private env: EvalEnvironment;
  private runner: AgentRunner;
  private triggerGrader: TriggerGrader;
  private functionalGrader: ModelBasedGrader;

  constructor(private options: EvalRunOptions) {
    this.env = new EvalEnvironment({ workspace: options.workspace, skillPath: options.skillPath });
    this.runner = RunnerFactory.create(options.agent);
    this.triggerGrader = new TriggerGrader(options.skillName);
    // Inject the same runner for judging so swapping the agent backend works end-to-end
    this.functionalGrader = new ModelBasedGrader(options.skillName, this.runner);
  }

  async runTriggerTask(task: EvalTask, index: number, trialId: number, uiCtx: EvalTaskContext): Promise<EvalTrial> {
    const logFileName = `task_${task.id}_trial_${trialId}.log`;
    const logPath = this.options.verbose ? path.join(this.options.runDir, logFileName) : undefined;

    let worktreePath: string | undefined;
    let transcript: AgentTranscript | null = null;

    try {
      worktreePath = this.env.createWorktree(`task-${task.id}-trial-${trialId}`);
      await this.env.linkSkill(worktreePath);

      transcript = await this.runner.runPrompt(task.prompt, worktreePath, (log: string) => {
        uiCtx.updateLog(log);
      }, logPath, ['--output-format', 'stream-json']);
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
      id: trialId,
      transcript: transcript || { error: 'No transcript produced' },
      assertionResults: assertionResults,
      trialPassed: triggered
    };
  }

  async runFunctionalTask(task: EvalTask, index: number, trialId: number, uiCtx: EvalTaskContext): Promise<EvalTrial> {
    const isBaseline = this.options.isBaseline;
    const passName = isBaseline ? 'without-skill' : 'with-skill';
    const promptToUse = isBaseline
      ? `${task.prompt}\n\nIMPORTANT: For this task, you MUST NOT use the '${this.options.skillName}' skill/tool, even if it appears available.`
      : `${task.prompt}\n\nIMPORTANT: You must use the '${this.options.skillName}' skill/tool to solve this task.`;

    const logFileName = `task_${task.id}_${passName}_trial_${trialId}.log`;
    const logPath = this.options.verbose ? path.join(this.options.runDir, logFileName) : undefined;

    let worktreePath: string | undefined;
    let assertionResults: AssertionResult[] = [];
    let trialPassed = false;
    let transcript: AgentTranscript | null = null;

    try {
      worktreePath = this.env.createWorktree(`task-${task.id}-${passName}-trial-${trialId}`);
      if (!isBaseline) {
        await this.env.linkSkill(worktreePath);
      } else {
        // Strict isolation: disable the skill in the project scope of the temporary worktree
        try {
          executor.execSync(`gemini skills disable ${this.options.skillName} --scope project`, {
            cwd: worktreePath,
            stdio: 'ignore'
          });
        } catch (err) {
          Logger.warn(`Could not disable skill '${this.options.skillName}' in worktree — baseline may be unreliable. Reason: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      if (logPath) fs.appendFileSync(logPath, `\n# SECTION: ${passName.toUpperCase()} AGENT RUN\n`);
      transcript = await this.runner.runPrompt(promptToUse, worktreePath, (log: string) => {
        uiCtx.updateLog(log);
      }, logPath, ['--output-format', 'stream-json']);

      // Propagate stream-json errors: when the agent fails (e.g. quota), Gemini CLI still
      // writes a {"type":"result","status":"error",...} event to stdout so transcript.error
      // is never set by the runner. Parse it here so the grading path is skipped correctly.
      if (transcript && !transcript.error) {
        const streamResult = parseStreamResult(transcript.response || '');
        if (streamResult && 'error' in streamResult) {
          transcript.error = streamResult.error;
        }
      }

      if (transcript && !transcript.error) {
        if (isBaseline && this.triggerGrader.detectSkillAttempt(transcript)) {
          return {
            id: trialId,
            transcript,
            assertionResults: [{
              assertion: 'Baseline must not invoke the restricted skill',
              passed: false,
              reason: `Invalid Without Skill: '${this.options.skillName}' activation detected during without-skill run`,
              graderType: 'programmatic'
            }],
            trialPassed: false
          };
        }
        if (!isBaseline && !this.triggerGrader.gradeTrigger(transcript)) {
          return {
            id: trialId,
            transcript,
            assertionResults: [{
              assertion: 'Target pass must invoke the skill',
              passed: false,
              reason: `Invalid With Skill: '${this.options.skillName}' was not successfully activated`,
              graderType: 'programmatic'
            }],
            trialPassed: false
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
          if (logPath) fs.appendFileSync(logPath, `\n# SECTION: ${passName.toUpperCase()} JUDGE RUN\n`);
          // Use the already-parsed stream result to get clean text for the judge.
          const streamResult = parseStreamResult(transcript.response || '');
          const streamText = streamResult && 'response' in streamResult ? streamResult.response : '';
          const gradingTranscript = streamText ? { ...transcript, response: streamText } : transcript;
          assertionResults = await this.functionalGrader.gradeModelBased(
            task.prompt,
            gradingTranscript,
            task.assertions,
            context,
            (log) => { uiCtx.updateLog(`Grading: ${log}`); },
            logPath,
            worktreePath
          );
          trialPassed = assertionResults.every(r => r.passed);
        } else {
          trialPassed = true;
        }

        return {
          id: trialId,
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
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      trialPassed = false;
      if (task.assertions) {
        assertionResults = task.assertions.map(a => ({
          assertion: a,
          passed: false,
          reason: `Execution failed: ${errorMsg}`,
          graderType: 'model-based'
        }));
      }
    } finally {
      if (worktreePath) {
        this.env.removeWorktree(worktreePath);
      }
    }

    return {
      id: trialId,
      transcript: { error: transcript?.error || 'No transcript produced' },
      assertionResults: assertionResults,
      trialPassed
    };
  }
}
