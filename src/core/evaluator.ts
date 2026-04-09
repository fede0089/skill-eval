import { AgentOutput, ToolMetrics, ModelMetrics, ExpectationResult, FunctionalEvalResult, EvalSummaryResult } from '../types';
import { Logger } from '../utils/logger';
import { RunnerFactory } from './runners/factory';

export class Evaluator {
  private targetToolKeys: string[];

  constructor(skillName: string) {
    this.targetToolKeys = [
      skillName,
      skillName.replace(/-/g, '_')
    ];
  }

  /**
   * Verifies if the skill was triggered by analyzing the agent's tool calls.
   * Checks for explicit skill dispatch or name matches in tool statistics (if available)
   * or in the raw output text.
   */
  isSkillTriggered(output: AgentOutput): boolean {
    // 1. Check structured stats if available (Legacy/Structured mode)
    if (output?.stats?.tools?.byName) {
      const byName = output.stats.tools.byName;
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

    // 2. Fallback to parsing raw text output (Plain Text mode)
    const textToSearch = (output.raw_output || output.response || '').toLowerCase();
    if (!textToSearch) return false;

    const dispatchTools = ['activate_skill', 'generalist'];
    for (const tool of dispatchTools) {
      // Look for common tool execution patterns in Gemini CLI output
      // e.g. "Calling tool: activate_skill", "Tool: generalist", etc.
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
 * FunctionalEvaluator extends the base Evaluator to support Judge-led
 * verification of functional expectations.
 */
export class FunctionalEvaluator extends Evaluator {
  constructor(skillName: string) {
    super(skillName);
  }

  /**
   * Invokes an LLM Judge (Gemini CLI) to evaluate if the agent's response
   * and workspace changes meet the defined functional expectations.
   * 
   * @param prompt Original user prompt
   * @param output Output from the agent execution
   * @param expectations List of textual expectations
   * @param workspaceContext Current state/diff of the local workspace
   * @returns Array of individual expectation results with status and reasoning
   */
  async evaluateFunctional(
    prompt: string,
    output: AgentOutput,
    expectations: string[],
    workspaceContext: string
  ): Promise<ExpectationResult[]> {
    if (!expectations || expectations.length === 0) {
      return [];
    }

    const judgePrompt = this.buildJudgePrompt(prompt, output.response || '', expectations, workspaceContext);
    const runner = RunnerFactory.create('gemini-cli');
    
    // We run the prompt and expect a JSON response
    const judgeRawOutput = await runner.runPrompt(judgePrompt);
    
    if (!judgeRawOutput || !judgeRawOutput.response) {
      return expectations.map(e => ({
        expectation: e,
        passed: false,
        reason: 'Judge agent failed to provide a response.'
      }));
    }

    try {
      // Find JSON block in response
      const jsonMatch = judgeRawOutput.response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return JSON.parse(judgeRawOutput.response);
    } catch (err) {
      Logger.error(`Failed to parse Judge JSON response: ${err instanceof Error ? err.message : String(err)}`);
      Logger.debug(`Raw Judge response: ${judgeRawOutput.response}`);
      return expectations.map(e => ({
        expectation: e,
        passed: false,
        reason: 'Judge agent response was not valid JSON.'
      }));
    }
  }

  private buildJudgePrompt(prompt: string, response: string, expectations: string[], context: string): string {
    return `You are a Functional Quality Judge for AI Agent Skills.
Your task is to evaluate if a skill execution met its functional expectations.

Original Prompt: "${prompt}"
Agent Response: "${response}"

Workspace Context (Changes detected):
${context}

Expectations to evaluate:
${expectations.map((e, i) => `${i + 1}. ${e}`).join('\n')}

INSTRUCTIONS:
1. Analyze the Response and the Workspace Context.
2. For each expectation, determine if it was met (passed: true) or not (passed: false).
3. Provide a brief reasoning for your judgment.
4. Output your evaluation ONLY as a JSON array of objects with the following structure:
[
  {
    "expectation": "the exact text of expectation 1",
    "passed": true,
    "reason": "why it passed or failed"
  },
  ...
]

Do not include any other text in your response, only the JSON array.`;
  }
}

/**
 * Validates a single expectation against the actual output.
 * Supported types: contains, not_contains, regex, json.
 */
export function validateExpectation(expectation: { type: string; value: string }, actualOutput: string): boolean {
  switch (expectation.type) {
    case 'contains':
      return actualOutput.includes(expectation.value);
    case 'not_contains':
      return !actualOutput.includes(expectation.value);
    case 'regex':
      return new RegExp(expectation.value).test(actualOutput);
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
