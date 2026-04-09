"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeminiCliRunner = void 0;
const child_process_1 = require("child_process");
const logger_1 = require("../../utils/logger");
class GeminiCliRunner {
    /**
     * Runs the prompt through an isolated gemini instance.
     * Default mode is headless using --approval-mode auto_edit.
     *
     * @param prompt The evaluation prompt text
     * @param cwd Optional execution directory
     * @param onLog Callback to receive real-time logs (from stderr)
     * @returns Parsed JSON output from Gemini
     */
    async runPrompt(prompt, cwd, onLog) {
        return new Promise((resolve) => {
            let stdout = '';
            let stderr = '';
            let resolved = false;
            // Use -p and --approval-mode auto_edit for headless mode
            const args = ['-p', prompt, '--approval-mode', 'auto_edit', '-o', 'json'];
            const spawnOptions = {
                cwd: cwd,
                env: { ...process.env, FORCE_COLOR: '1' }
            };
            const child = (0, child_process_1.spawn)('gemini', args, spawnOptions);
            // Safety timeout: 5 minutes (300,000 ms)
            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    child.kill('SIGKILL');
                    logger_1.Logger.error('\nGemini CLI process timed out after 5 minutes.');
                    resolve({ error: 'Process timeout exceeded (5 minutes)', raw_output: stderr });
                }
            }, 300000);
            if (child.stdout) {
                child.stdout.on('data', (data) => {
                    stdout += data.toString();
                });
            }
            if (child.stderr) {
                child.stderr.on('data', (data) => {
                    const chunk = data.toString();
                    stderr += chunk;
                    if (onLog) {
                        // Send the last non-empty line to the logger
                        const lines = chunk.split('\n').filter((l) => l.trim() !== '');
                        if (lines.length > 0) {
                            onLog(lines[lines.length - 1]);
                        }
                    }
                });
            }
            child.on('error', (err) => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    logger_1.Logger.error(`Failed to start gemini CLI. Error: ${err.message}`);
                    resolve(null);
                }
            });
            child.on('close', (code) => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    if (code !== 0) {
                        logger_1.Logger.error(`Gemini CLI exited with status ${code}`);
                        if (stderr) {
                            logger_1.Logger.debug(`Gemini CLI Stderr: ${stderr.trim()}`);
                        }
                    }
                    if (!stdout || stdout.trim() === '') {
                        logger_1.Logger.error(`Received empty output from Gemini CLI. Cannot evaluate.`);
                        return resolve({ error: 'Empty output from Gemini CLI', raw_output: stderr });
                    }
                    // Extract JSON part from output (handles leading/trailing logs)
                    let jsonPart = stdout.trim();
                    const firstBraceIndex = jsonPart.indexOf('{');
                    const lastBraceIndex = jsonPart.lastIndexOf('}');
                    if (firstBraceIndex === -1 || lastBraceIndex === -1 || firstBraceIndex > lastBraceIndex) {
                        logger_1.Logger.error(`Could not find a valid JSON object in Gemini CLI output.`);
                        logger_1.Logger.debug(`Raw Output: ${stdout}`);
                        return resolve({ error: 'No JSON object found', raw_output: stdout });
                    }
                    jsonPart = jsonPart.substring(firstBraceIndex, lastBraceIndex + 1);
                    try {
                        const parsed = JSON.parse(jsonPart);
                        return resolve({ ...parsed, raw_output: stdout });
                    }
                    catch (parseError) {
                        logger_1.Logger.error(`Failed to parse JSON output: ${parseError}`);
                        logger_1.Logger.error(`Runner Output Preview: ${stdout.substring(0, 300)}`);
                        return resolve({ error: 'JSON parse failure', raw_output: stdout });
                    }
                }
            });
        });
    }
}
exports.GeminiCliRunner = GeminiCliRunner;
