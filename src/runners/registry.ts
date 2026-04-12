import { GeminiCliRunner } from './gemini-cli/index.js';
import type { AgentRunner } from './runner.interface.js';

// ---------------------------------------------------------------------------
// Runner registry — the single place to register a new agent backend.
//
// To add a new runner:
//   1. Create src/runners/<your-agent>/ with runner.ts + index.ts
//   2. Add one entry below: '<agent-name>': { Runner: YourRunner, binary: 'cli-binary' }
//   3. Done — factory and preflight both pick it up automatically.
// ---------------------------------------------------------------------------

interface RunnerEntry {
  Runner: new () => AgentRunner;
  /** CLI binary name used to verify the agent is installed (preflight check). */
  binary: string;
}

export const RUNNER_REGISTRY: Record<string, RunnerEntry> = {
  'gemini-cli': { Runner: GeminiCliRunner, binary: 'gemini' },
};

export type AgentName = keyof typeof RUNNER_REGISTRY;

export class RunnerFactory {
  static create(agent: string): AgentRunner {
    const entry = RUNNER_REGISTRY[agent];
    if (!entry) {
      const supported = Object.keys(RUNNER_REGISTRY).join(', ');
      throw new Error(`Agent '${agent}' is not supported. Supported agents: ${supported}`);
    }
    return new entry.Runner();
  }
}
