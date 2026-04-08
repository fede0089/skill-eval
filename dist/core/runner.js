"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HeadlessRunner = void 0;
const child_process_1 = require("child_process");
class HeadlessRunner {
    agent;
    constructor(agent) {
        this.agent = agent;
    }
    /**
     * Runs the prompt through a headless isolated gemini instance in auto_edit mode.
     * Auto Edit mode automatically allows tools meant for modifying files, falling back interactively
     * only for severe system-level actions (which we assume tests shouldn't invoke, or will fail if they do in non-interactive).
     * @param prompt The evaluation prompt text
     * @returns Parsed JSON output from Gemini
     */
    runPrompt(prompt) {
        if (this.agent !== 'gemini-cli') {
            console.error(`\n[Runner] Agent '${this.agent}' is not supported yet.`);
            return null;
        }
        // Escaping the prompt just in case. spawnSync handles formatting but better safe.
        try {
            const child = (0, child_process_1.spawnSync)('gemini', [
                '-p', prompt,
                '-o', 'json',
                '--approval-mode', 'auto_edit'
            ], {
                encoding: 'utf-8',
                // Not passing default stdio because we need to parse stdout 
                // silently without printing all the tool interactions to the user terminal.
                stdio: ['ignore', 'pipe', 'pipe']
            });
            if (child.error) {
                console.error(`\n[Runner] Failed to start gemini CLI. Error: ${child.error.message}`);
                return null;
            }
            // If exit code is not 0, there was likely a crash or unhanded exception in gemini cli.
            if (child.status !== 0) {
                console.error(`\n[Runner] Gemini CLI exited with status ${child.status}`);
                if (child.stderr) {
                    console.error(`[Runner Stderr] ${child.stderr.trim()}`);
                }
            }
            const rawOutput = child.stdout;
            if (!rawOutput || rawOutput.trim() === '') {
                console.error(`\n[Runner] Received empty output from Gemini CLI. Cannot evaluate.`);
                return null;
            }
            // We need to safely extract the JSON part because Gemini CLI might emit 
            // non-JSON warnings like "MCP issues detected. Run /mcp list for status." to stdout. 
            // We'll search for the first '{' to begin our JSON payload.
            let jsonPart = rawOutput.trim();
            const firstBraceIndex = jsonPart.indexOf('{');
            if (firstBraceIndex > 0) {
                jsonPart = jsonPart.substring(firstBraceIndex);
            }
            try {
                const parsed = JSON.parse(jsonPart);
                return parsed;
            }
            catch (parseError) {
                console.error(`\n[Runner] Failed to parse JSON output: ${parseError}`);
                // Dump first 300 chars of raw to debug
                console.error(`[Runner Output Preview] ${rawOutput.substring(0, 300)}`);
                return null;
            }
        }
        catch (e) {
            console.error(`\n[Runner] Unexpected error running process: ${e}`);
            return null;
        }
    }
}
exports.HeadlessRunner = HeadlessRunner;
