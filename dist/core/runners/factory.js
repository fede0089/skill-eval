"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RunnerFactory = void 0;
const gemini_cli_runner_1 = require("./gemini-cli.runner");
class RunnerFactory {
    /**
     * Factory method to create an agent runner based on the agent name.
     * Add new agent implementations here.
     * @param agent The name of the agent to run
     * @returns An implementation of AgentRunner
     * @throws Error if the agent is not supported
     */
    static create(agent) {
        switch (agent) {
            case 'gemini-cli':
                return new gemini_cli_runner_1.GeminiCliRunner();
            default:
                throw new Error(`Agent '${agent}' is not supported yet.`);
        }
    }
}
exports.RunnerFactory = RunnerFactory;
