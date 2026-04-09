"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeminiCliRunner = void 0;
const child_process_1 = require("child_process");
const logger_1 = require("../../utils/logger");
class GeminiCliRunner {
    /**
     * Runs the prompt through a headless isolated gemini instance in auto_edit mode.
     * Auto Edit mode automatically allows tools meant for modifying files, falling back interactively
     * only for severe system-level actions.
     * @param prompt The evaluation prompt text
     * @param cwd Optional execution directory
     * @returns Parsed JSON output from Gemini
     */
    runPrompt(prompt, cwd) {
        try {
            const child = (0, child_process_1.spawnSync)('gemini', [
                '-p', prompt,
                '-o', 'json',
                '--approval-mode', 'auto_edit'
            ], {
                encoding: 'utf-8',
                stdio: ['ignore', 'pipe', 'pipe'],
                cwd: cwd
            });
            if (child.error) {
                logger_1.Logger.error(`Failed to start gemini CLI. Error: ${child.error.message}`);
                return null;
            }
            if (child.status !== 0) {
                logger_1.Logger.error(`Gemini CLI exited with status ${child.status}`);
                if (child.stderr) {
                    logger_1.Logger.error(`Gemini CLI Stderr: ${child.stderr.trim()}`);
                }
            }
            const rawOutput = child.stdout;
            if (!rawOutput || rawOutput.trim() === '') {
                logger_1.Logger.error(`Received empty output from Gemini CLI. Cannot evaluate.`);
                return { error: 'Empty output from Gemini CLI', raw_output: child.stderr };
            }
            // Extract JSON part from output (handles leading/trailing logs)
            let jsonPart = rawOutput.trim();
            const firstBraceIndex = jsonPart.indexOf('{');
            const lastBraceIndex = jsonPart.lastIndexOf('}');
            if (firstBraceIndex === -1 || lastBraceIndex === -1 || firstBraceIndex > lastBraceIndex) {
                logger_1.Logger.error(`Could not find a valid JSON object in Gemini CLI output.`);
                logger_1.Logger.debug(`Raw Output: ${rawOutput}`);
                return { error: 'No JSON object found', raw_output: rawOutput };
            }
            jsonPart = jsonPart.substring(firstBraceIndex, lastBraceIndex + 1);
            try {
                const parsed = JSON.parse(jsonPart);
                return { ...parsed, raw_output: rawOutput };
            }
            catch (parseError) {
                logger_1.Logger.error(`Failed to parse JSON output: ${parseError}`);
                logger_1.Logger.error(`Runner Output Preview: ${rawOutput.substring(0, 300)}`);
                return { error: 'JSON parse failure', raw_output: rawOutput };
            }
        }
        catch (e) {
            logger_1.Logger.error(`Unexpected error running process: ${e}`);
            return { error: `Process error: ${e instanceof Error ? e.message : String(e)}` };
        }
    }
}
exports.GeminiCliRunner = GeminiCliRunner;
