import { AgentTranscript, ToolMetrics, AssertionResult } from '../types/index.js';
import { Logger } from '../utils/logger.js';
import { RunnerFactory } from './runners/factory.js';

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
   */
  gradeTrigger(transcript: AgentTranscript): boolean {
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
}

/**
 * Model-based grader that uses an LLM Judge to verify functional assertions.
 */
export class ModelBasedGrader {
  constructor(private skillName: string) {}

  /**
   * Invokes an LLM Judge to evaluate if assertions are met.
   */
  async gradeModelBased(
    prompt: string,
    transcript: AgentTranscript,
    assertions: string[],
    workspaceContext: string,
    onLog?: (log: string) => void,
    logPath?: string
  ): Promise<AssertionResult[]> {
    if (!assertions || assertions.length === 0) {
      return [];
    }

    const judgePrompt = this.buildJudgePrompt(prompt, transcript.response || '', assertions, workspaceContext);
    const runner = RunnerFactory.create('gemini-cli');
    
    const judgeRawOutput = await runner.runPrompt(judgePrompt, undefined, onLog, logPath);
    
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
1. Analyze the Response and the Workspace Context.
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
