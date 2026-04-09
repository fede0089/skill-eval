"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeminiCliRunner = void 0;
const fs = __importStar(require("fs"));
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
     * @param logPath Optional file path to save raw execution logs
     * @returns Raw output from Gemini
     */
    async runPrompt(prompt, cwd, onLog, logPath) {
        return new Promise((resolve) => {
            let stdout = '';
            let stderr = '';
            let resolved = false;
            // Use -p and --approval-mode auto_edit for headless mode.
            // Removed -o json to get plain text output.
            const args = ['-p', prompt, '--approval-mode', 'auto_edit'];
            const spawnOptions = {
                cwd: cwd,
                env: { ...process.env, FORCE_COLOR: '1' }
            };
            const child = (0, child_process_1.spawn)('gemini', args, spawnOptions);
            // Setup log stream if path is provided
            let logStream = null;
            if (logPath) {
                try {
                    logStream = fs.createWriteStream(logPath, { flags: 'a' });
                    logStream.write(`--- Gemini CLI Execution Start: ${new Date().toISOString()} ---\n`);
                    logStream.write(`Command: gemini ${args.join(' ')}\n\n`);
                }
                catch (err) {
                    logger_1.Logger.error(`Failed to create log file at ${logPath}: ${err}`);
                }
            }
            // Safety timeout: 5 minutes (300,000 ms)
            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    child.kill('SIGKILL');
                    if (logStream) {
                        logStream.write('\n\n--- Gemini CLI process timed out ---\n');
                        logStream.end();
                    }
                    logger_1.Logger.error('\nGemini CLI process timed out after 5 minutes.');
                    resolve({ error: 'Process timeout exceeded (5 minutes)', raw_output: stderr });
                }
            }, 300000);
            if (child.stdout) {
                child.stdout.on('data', (data) => {
                    const chunk = data.toString();
                    stdout += chunk;
                    if (logStream)
                        logStream.write(chunk);
                });
            }
            if (child.stderr) {
                child.stderr.on('data', (data) => {
                    const chunk = data.toString();
                    stderr += chunk;
                    if (logStream)
                        logStream.write(chunk);
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
                    if (logStream) {
                        logStream.write(`\n\n--- Error starting Gemini CLI: ${err.message} ---\n`);
                        logStream.end();
                    }
                    logger_1.Logger.error(`Failed to start gemini CLI. Error: ${err.message}`);
                    resolve(null);
                }
            });
            child.on('close', (code) => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    if (logStream) {
                        logStream.write(`\n\n--- Gemini CLI exited with status ${code} ---\n`);
                        logStream.end();
                    }
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
                    // In plain text mode, we return the full stdout as response,
                    // and both stdout and stderr in raw_output for evaluation purposes.
                    return resolve({
                        response: stdout.trim(),
                        raw_output: `${stdout}\n--- STDERR ---\n${stderr}`
                    });
                }
            });
        });
    }
}
exports.GeminiCliRunner = GeminiCliRunner;
