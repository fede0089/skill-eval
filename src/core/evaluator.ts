import { AgentOutput, ToolMetrics, ModelMetrics } from '../types';
import { Logger } from '../utils/logger';

export class Evaluator {
  private targetToolKeys: string[];

  /**
   * Evaluator handles boolean verification of whether the skill activated or not.
   * `targetToolKeys` can be the skill_name directly, or specific tool names exposed by the skill.
   */
  constructor(skillName: string) {
    this.targetToolKeys = [
      skillName,
      skillName.replace(/-/g, '_')
    ];
  }

  public isSkillTriggered(output: AgentOutput): boolean {
    if (!output?.stats?.tools?.byName) {
      return false;
    }

    const byName = output.stats.tools.byName;
    const toolNames = Object.keys(byName);

    const dispatchTools = ['activate_skill', 'generalist'];
    for (const tool of dispatchTools) {
      if (toolNames.includes(tool)) {
        const metrics: ToolMetrics = byName[tool];
        const calls = metrics.count ?? metrics.totalCalls ?? 0;
        if (calls > 0) {
          return true;
        }
      }
    }

    for (const expectedKey of this.targetToolKeys) {
      const match = toolNames.find(t => t.includes(expectedKey) || expectedKey.includes(t));
      if (match) {
        const metrics: ToolMetrics = byName[match];
        const calls = metrics.count ?? metrics.totalCalls ?? 0;
        if (calls > 0) {
          return true;
        }
      }
    }

    const totalCalls = output.stats.tools.totalCalls;
    if (totalCalls > 0) {
      Logger.debug(`Tools were called (${toolNames.join(', ')}), but no explicit skill dispatch was detected.`);
    }

    return false;
  }

  /**
   * Safely extracts total tokens and latency across all model calls in the output.
   */
  public extractMetrics(output: AgentOutput): { latencyMs: number; tokens: number } {
    let latencyMs = 0;
    let tokens = 0;

    const models = output?.stats?.models;
    if (models) {
      for (const modelId in models) {
        const m = models[modelId] as ModelMetrics;
        if (m.api?.totalLatencyMs) {
          latencyMs += m.api.totalLatencyMs;
        }
        if (m.tokens?.total) {
          tokens += m.tokens.total;
        }
      }
    }

    return { latencyMs, tokens };
  }
}
