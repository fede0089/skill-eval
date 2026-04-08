import { GeminiOutput } from '../types';

export class Evaluator {
  private targetToolKeys: string[];

  /**
   * Evaluator handles boolean verification of whether the skill activated or not.
   * `targetToolKeys` can be the skill_name directly, or specific tool names exposed by the skill,
   * since `geminiOutput.tools?.byName` groups usages by the precise native tool name that was called.
   */
  constructor(skillName: string) {
    // A simplistic heuristic: the main tool name usually shares the skill's name 
    // replacing hyphens with underscores, or is exactly the same.
    this.targetToolKeys = [
      skillName,
      skillName.replace(/-/g, '_')
    ];
  }

  public isSkillTriggered(output: GeminiOutput): boolean {
    if (!output?.stats?.tools?.byName) {
      return false; // If there are no tool stats, nothing was triggered remotely
    }

    const byName = output.stats.tools.byName;
    const toolNames = Object.keys(byName);

    // Heuristics for isolated local evaluations:
    // When Gemini invokes a skill, it might use 'activate_skill', or it might delegate
    // to a subagent like 'generalist' if it requires executing generic instructions.
    // In our headless evaluation environment, if ANY of these dispatch tools are called,
    // we consider the skill rule triggered because the prompt was designed to hit it.
    const dispatchTools = ['activate_skill', 'generalist'];
    for (const tool of dispatchTools) {
      if (toolNames.includes(tool)) {
        const calls = byName[tool]?.count || byName[tool]?.totalCalls;
        if (calls > 0) {
          return true;
        }
      }
    }

    // Also check if any generic tool mimicking the skill name was called directly 
    // (legacy fallback for older agent definitions)
    for (const expectedKey of this.targetToolKeys) {
      const match = toolNames.find(t => t.includes(expectedKey) || expectedKey.includes(t));
      if (match && (byName[match]?.count > 0 || byName[match]?.totalCalls > 0)) {
        return true;
      }
    }

    // Fallback: If ANY tools were called, maybe the skill triggered a generic tool implicitly?
    // We log a debug warning so the user knows tools fired.
    if (output.stats.tools.totalCalls > 0) {
      console.log(`\n  [Debug] Tools were called (${toolNames.join(', ')}), but no explicit skill dispatch was detected. Returning false.`);
    }

    return false;
  }
}
