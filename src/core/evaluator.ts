import { AgentTranscript, ToolMetrics, AssertionResult, NdjsonToolUseEvent } from '../types/index.js';
import { Logger } from '../utils/logger.js';
import { AgentRunner } from '../runners/runner.interface.js';
import { parseNdjsonEvents } from '../utils/ndjson.js';

/**
 * Programmatic grader that checks if a skill was triggered by analyzing tool calls.
 */
export class TriggerGrader {
  private targetToolKeys: string[];

  constructor(skillName: string) {
    this.targetToolKeys = [
      skillName,
      skillName.replace(/-/g, '_')
    ];
  }

  /**
   * Grades a trial based on whether the skill was triggered.
   * New implementation: Parses JSON stream lines from raw_output.
   */
  gradeTrigger(transcript: AgentTranscript): boolean {
    const rawOutput = transcript.raw_output || '';
    const events = parseNdjsonEvents(rawOutput);

    // 1. Look for tool_use event for activate_skill
    let foundToolUse = false;
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      if (
        event.type === 'tool_use' &&
        event.tool_name === 'activate_skill' &&
        typeof event.parameters?.name === 'string' &&
        this.targetToolKeys.some(key => (event as NdjsonToolUseEvent).parameters!.name!.toLowerCase() === key.toLowerCase())
      ) {
        foundToolUse = true;
        const toolId = event.tool_id;

        // 2. Look for subsequent tool_result with matching ID and status success
        for (let j = i + 1; j < events.length; j++) {
          const resultEvent = events[j];
          if (
            resultEvent.type === 'tool_result' &&
            resultEvent.tool_id === toolId &&
            resultEvent.status === 'success'
          ) {
            return true;
          }
        }
      }
    }

    // If we found a tool_use for activate_skill but no successful tool_result, we should NOT fall back to legacy.
    // However, if no JSON events were parsed at all, we fall back.
    if (events.length > 0) {
      return false;
    }

    // Fallback for non-JSON stream output (legacy support)
    // 1. Check structured stats if available
    if (transcript?.stats?.tools?.byName) {
      const byName = transcript.stats.tools.byName;
      const toolNames = Object.keys(byName);

      const dispatchTools = ['activate_skill'];
      for (const tool of dispatchTools) {
        if (toolNames.includes(tool)) {
          const metrics: ToolMetrics = byName[tool];
          const calls = metrics.count ?? metrics.totalCalls ?? 0;
          if (calls > 0) return true;
        }
      }

      for (const expectedKey of this.targetToolKeys) {
        const match = toolNames.find(t => t.includes(expectedKey) || expectedKey.includes(t));
        if (match) {
          const metrics: ToolMetrics = byName[match];
          const calls = metrics.count ?? metrics.totalCalls ?? 0;
          if (calls > 0) return true;
        }
      }
    }

    // 2. Fallback to parsing raw text output
    const textToSearch = (transcript.raw_output || transcript.response || '').toLowerCase();
    if (!textToSearch) return false;

    const dispatchTools = ['activate_skill'];
    for (const tool of dispatchTools) {
      if (textToSearch.includes(tool.toLowerCase())) {
        Logger.debug(`Detected skill dispatch tool "${tool}" in plain text output.`);
        return true;
      }
    }

    for (const expectedKey of this.targetToolKeys) {
      if (textToSearch.includes(expectedKey.toLowerCase())) {
        Logger.debug(`Detected target skill key "${expectedKey}" in plain text output.`);
        return true;
      }
    }

    return false;
  }

  /**
   * Checks whether the skill was attempted (any tool_use event for activate_skill matching the skill name).
   * Unlike gradeTrigger, does NOT require a successful tool_result — any attempt counts.
   * Used to detect invalid baseline runs where the agent tried to invoke the restricted skill.
   */
  detectSkillAttempt(transcript: AgentTranscript): boolean {
    const rawOutput = transcript.raw_output || '';
    for (const event of parseNdjsonEvents(rawOutput)) {
      if (
        event.type === 'tool_use' &&
        event.tool_name === 'activate_skill' &&
        typeof event.parameters?.name === 'string' &&
        this.targetToolKeys.some(k => (event as NdjsonToolUseEvent).parameters!.name!.toLowerCase() === k.toLowerCase())
      ) return true;
    }
    return false;
  }
}

/**
 * Model-based grader that uses an LLM Judge to verify functional assertions.
 * The judgeRunner is injected so the grader uses the same agent backend as the evaluation,
 * making it easy to swap the runner (e.g. gemini-cli → claude) without touching this class.
 */
export class ModelBasedGrader {
  constructor(private skillName: string, private judgeRunner: AgentRunner) {}

  /**
   * Invokes an LLM Judge to evaluate if assertions are met.
   */
  async gradeModelBased(
    prompt: string,
    transcript: AgentTranscript,
    assertions: string[],
    workspaceContext: string,
    onLog?: (log: string) => void,
    logPath?: string,
    worktreePath?: string
  ): Promise<AssertionResult[]> {
    if (!assertions || assertions.length === 0) {
      return [];
    }

    const judgePrompt = this.buildJudgePrompt(prompt, transcript.response || '', assertions, workspaceContext);

    const judgeRawOutput = await this.judgeRunner.runPrompt(judgePrompt, worktreePath, onLog, logPath);
    
    if (!judgeRawOutput || !judgeRawOutput.response) {
      const errorMsg = judgeRawOutput?.error ? ` (Error: ${judgeRawOutput.error})` : '';
      return assertions.map(a => ({
        assertion: a,
        passed: false,
        reason: `Judge agent failed to provide a response.${errorMsg}`,
        graderType: 'model-based'
      }));
    }

    try {
      const jsonMatch = judgeRawOutput.response.match(/\[[\s\S]*\]/);
      const rawResults = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(judgeRawOutput.response);
      
      return rawResults.map((r: any) => ({
        assertion: r.assertion || r.expectation,
        passed: !!r.passed,
        reason: r.reason || '',
        graderType: 'model-based'
      }));
    } catch (err) {
      Logger.error(`Failed to parse Judge JSON response: ${err instanceof Error ? err.message : String(err)}`);
      Logger.debug(`Raw Judge response: ${judgeRawOutput.response}`);
      return assertions.map(a => ({
        assertion: a,
        passed: false,
        reason: 'Judge agent response was not valid JSON.',
        graderType: 'model-based'
      }));
    }
  }

  private buildJudgePrompt(prompt: string, response: string, assertions: string[], context: string): string {
    return `You are a Functional Quality Judge for AI Agent Skills.
Your task is to evaluate if a skill execution met its functional assertions.

Original Prompt: "${prompt}"
Agent Response: "${response}"

Workspace Context (Changes detected):
${context}

Assertions to evaluate:
${assertions.map((a, i) => `${i + 1}. ${a}`).join('\n')}

INSTRUCTIONS:
1. Analyze the Agent Response and the Workspace Context below.
   You are running in the directory where the agent worked. If any assertion references file content or file existence, you MUST use the read_file tool to verify directly — do not rely solely on the agent's response text.
   IMPORTANT: The Agent Response string might contain CLI system noise, telemetry errors, or tool status warnings (e.g., initialization logs) prepended or appended to the actual reply. You MUST ignore any system-level noise and evaluate the assertions STRICTLY against the agent's intended message and actions.
2. For each assertion, determine if it was met (passed: true) or not (passed: false).
3. Provide a brief reasoning for your judgment.
4. Output your evaluation ONLY as a JSON array of objects with the following structure:
[
  {
    "assertion": "the exact text of assertion 1",
    "passed": true,
    "reason": "why it passed or failed"
  },
  ...
]

Do not include any other text in your response, only the JSON array.`;
  }
}

// Backwards compatibility aliases
export { TriggerGrader as Evaluator };
export { ModelBasedGrader as FunctionalEvaluator };

/**
 * Validates a single programmatic assertion against the actual output.
 * Supported types: contains, not_contains, regex, json.
 */
export function validateAssertion(assertion: { type: string; value: string }, actualOutput: string): boolean {
  switch (assertion.type) {
    case 'contains':
      return actualOutput.includes(assertion.value);
    case 'not_contains':
      return !actualOutput.includes(assertion.value);
    case 'regex':
      return new RegExp(assertion.value).test(actualOutput);
    case 'json':
      try {
        JSON.parse(actualOutput);
        return true;
      } catch {
        return false;
      }
    default:
      return false;
  }
}

// Backwards compatibility alias
export const validateExpectation = validateAssertion;
