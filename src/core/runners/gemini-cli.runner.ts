import { spawn } from 'child_process';
import { AgentOutput } from '../../types';
import { AgentRunner, RunPromptOptions } from './runner.interface';
import { Logger } from '../../utils/logger';

export class GeminiCliRunner implements AgentRunner {
  /**
   * Runs the prompt through an isolated gemini instance.
   * Default mode is headless using --approval-mode yolo.
   * Interactive mode allows user interaction by inheriting stdin/stderr.
   * 
   * @param prompt The evaluation prompt text
   * @param cwd Optional execution directory
   * @param onLog Callback to receive real-time logs (from stderr)
   * @param options Configuration for the run (e.g. interactive mode)
   * @returns Parsed JSON output from Gemini
   */
  public async runPrompt(
    prompt: string, 
    cwd?: string, 
    onLog?: (log: string) => void,
    options: RunPromptOptions = {}
  ): Promise<AgentOutput | null> {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let resolved = false;

      const args: string[] = [];

      if (options.interactive) {
        // Use --prompt-interactive instead of -p for interactive mode
        args.push('--prompt-interactive', prompt);
      } else {
        // Use -p and --approval-mode yolo for headless mode
        args.push('-p', prompt);
        args.push('--approval-mode', 'yolo');
      }

      args.push('-o', 'json');

      const spawnOptions: any = {
        cwd: cwd,
        env: { ...process.env, FORCE_COLOR: '1' }
      };

      // In interactive mode, we must inherit stdin so the user can respond to prompts,
      // and stderr so they can see the prompts. 
      // stdout is always piped to capture the JSON response.
      if (options.interactive) {
        spawnOptions.stdio = ['inherit', 'pipe', 'inherit'];
      }

      const child = spawn('gemini', args, spawnOptions);

      // Safety timeout: 5 minutes (300,000 ms)
      // Only enable timeout if NOT in interactive mode, as user interaction might take time.
      let timeout: NodeJS.Timeout | undefined;
      if (!options.interactive) {
        timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            child.kill('SIGKILL');
            Logger.error('\nGemini CLI process timed out after 5 minutes.');
            resolve({ error: 'Process timeout exceeded (5 minutes)', raw_output: stderr });
          }
        }, 300000);
      }

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
          if (timeout) clearTimeout(timeout);
          Logger.error(`Failed to start gemini CLI. Error: ${err.message}`);
          resolve(null);
        }
      });

      child.on('close', (code) => {
        if (!resolved) {
          resolved = true;
          if (timeout) clearTimeout(timeout);

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
