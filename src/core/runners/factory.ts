import { AgentRunner } from './runner.interface.js';
import { GeminiCliRunner } from './gemini-cli.runner.js';

export class RunnerFactory {
  /**
   * Factory method to create an agent runner based on the agent name.
   * Add new agent implementations here.
   * @param agent The name of the agent to run
   * @returns An implementation of AgentRunner
   * @throws Error if the agent is not supported
   */
  static create(agent: string): AgentRunner {
    switch (agent) {
      case 'gemini-cli':
        return new GeminiCliRunner();
      default:
        throw new Error(`Agent '${agent}' is not supported yet.`);
    }
  }
}
