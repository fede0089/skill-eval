import * as fs from 'fs';
import { spawn } from 'child_process';
import { AgentOutput } from '../../types';
import { AgentRunner } from './runner.interface';
import { Logger } from '../../utils/logger';

export class GeminiCliRunner implements AgentRunner {
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
  public async runPrompt(
    prompt: string, 
    cwd?: string, 
    onLog?: (log: string) => void,
    logPath?: string,
    extraArgs: string[] = []
  ): Promise<AgentOutput | null> {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let resolved = false;

      // Use -p and --approval-mode auto_edit for headless mode.
      const args: string[] = ['-p', prompt, '--approval-mode', 'auto_edit', ...extraArgs];

      const spawnOptions: any = {
        cwd: cwd,
        env: { ...process.env, FORCE_COLOR: '1' }
      };

      const child = spawn('gemini', args, spawnOptions);

      // Setup log stream if path is provided
      let logStream: fs.WriteStream | null = null;
      if (logPath) {
        try {
          logStream = fs.createWriteStream(logPath, { flags: 'a' });
          logStream.write(`--- Gemini CLI Execution Start: ${new Date().toISOString()} ---\n`);
          logStream.write(`Command: gemini ${args.join(' ')}\n\n`);
        } catch (err) {
          Logger.error(`Failed to create log file at ${logPath}: ${err}`);
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
          Logger.error('\nGemini CLI process timed out after 5 minutes.');
          resolve({ error: 'Process timeout exceeded (5 minutes)', raw_output: stderr });
        }
      }, 300000);

      if (child.stdout) {
        child.stdout.on('data', (data) => {
          const chunk = data.toString();
          stdout += chunk;
          if (logStream) logStream.write(chunk);
        });
      }

      if (child.stderr) {
        child.stderr.on('data', (data) => {
          const chunk = data.toString();
          stderr += chunk;
          if (logStream) logStream.write(chunk);
          if (onLog) {
            // Send the last non-empty line to the logger
            const lines = chunk.split('\n').filter((l: string) => l.trim() !== '');
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
          Logger.error(`Failed to start gemini CLI. Error: ${err.message}`);
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
            Logger.error(`Gemini CLI exited with status ${code}`);
            if (stderr) {
              Logger.debug(`Gemini CLI Stderr: ${stderr.trim()}`);
            }
          }

          if (!stdout || stdout.trim() === '') {
            Logger.error(`Received empty output from Gemini CLI. Cannot evaluate.`);
            return resolve({ error: 'Empty output from Gemini CLI', raw_output: stderr });
          }

          // In plain text mode, we return the full stdout as response,
          // and both stdout and stderr in raw_output for evaluation purposes.
          return resolve({ 
            response: stdout.trim(), 
            raw_output: `${stdout}\n--- STDERR ---\n${stderr}` 
          } as AgentOutput);
        }
      });
    });
  }
}
