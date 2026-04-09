import { spawn } from 'child_process';
import { AgentOutput } from '../../types';
import { AgentRunner } from './runner.interface';
import { Logger } from '../../utils/logger';

export class GeminiCliRunner implements AgentRunner {
  /**
   * Runs the prompt through a headless isolated gemini instance in auto_edit mode.
   * Auto Edit mode automatically allows tools meant for modifying files, falling back interactively
   * only for severe system-level actions.
   * @param prompt The evaluation prompt text
   * @param cwd Optional execution directory
   * @param onLog Callback to receive real-time logs (from stderr)
   * @returns Parsed JSON output from Gemini
   */
  public async runPrompt(prompt: string, cwd?: string, onLog?: (log: string) => void): Promise<AgentOutput | null> {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let resolved = false;

      const child = spawn('gemini', [
        '-p', prompt,
        '-o', 'json',
        '--approval-mode', 'auto_edit'
      ], {
        cwd: cwd,
        env: { ...process.env, FORCE_COLOR: '1' } // Try to keep colors if possible
      });

      // Safety timeout: 5 minutes
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          child.kill('SIGKILL');
          Logger.error('\nGemini CLI process timed out after 5 minutes.');
          resolve({ error: 'Process timeout exceeded (5 minutes)', raw_output: stderr });
        }
      }, 300000);

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        if (onLog) {
          // Send the last non-empty line to the logger
          const lines = chunk.split('\n').filter((l: string) => l.trim() !== '');
          if (lines.length > 0) {
            onLog(lines[lines.length - 1]);
          }
        }
      });

      child.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          Logger.error(`Failed to start gemini CLI. Error: ${err.message}`);
          resolve(null);
        }
      });

      child.on('close', (code) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);

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

          // Extract JSON part from output (handles leading/trailing logs)
          let jsonPart = stdout.trim();
          const firstBraceIndex = jsonPart.indexOf('{');
          const lastBraceIndex = jsonPart.lastIndexOf('}');
          
          if (firstBraceIndex === -1 || lastBraceIndex === -1 || firstBraceIndex > lastBraceIndex) {
            Logger.error(`Could not find a valid JSON object in Gemini CLI output.`);
            Logger.debug(`Raw Output: ${stdout}`);
            return resolve({ error: 'No JSON object found', raw_output: stdout });
          }

          jsonPart = jsonPart.substring(firstBraceIndex, lastBraceIndex + 1);

          try {
            const parsed = JSON.parse(jsonPart);
            return resolve({ ...parsed, raw_output: stdout } as AgentOutput);
          } catch (parseError) {
            Logger.error(`Failed to parse JSON output: ${parseError}`);
            Logger.error(`Runner Output Preview: ${stdout.substring(0, 300)}`);
            return resolve({ error: 'JSON parse failure', raw_output: stdout });
          }
        }
      });
    });
  }
}
