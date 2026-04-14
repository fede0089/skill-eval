import * as fs from 'fs';
import * as path from 'path';
import child_process from 'child_process';
import { AgentOutput } from '../../types/index.js';
import { AgentRunner } from '../runner.interface.js';
import { Logger } from '../../utils/logger.js';
import { executor } from '../../utils/exec.js';

export class GeminiCliRunner implements AgentRunner {
  readonly skillDispatchToolName = 'activate_skill';
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
    extraArgs: string[] = [],
    timeoutMs: number = 600_000
  ): Promise<AgentOutput | null> {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let resolved = false;

      // Use -p, --approval-mode auto_edit and --output-format stream-json for headless NDJSON mode.
      const args: string[] = ['-p', prompt, '--approval-mode', 'auto_edit', '--output-format', 'stream-json', ...extraArgs];

      const spawnOptions: any = {
        cwd: cwd,
        env: { ...process.env, FORCE_COLOR: '1' }
      };

      const child = child_process.spawn('gemini', args, spawnOptions);

      // Setup log stream if path is provided
      let logStream: fs.WriteStream | null = null;
      let logStreamDone = true; // Default to true if no logPath

      if (logPath) {
        try {
          logStream = fs.createWriteStream(logPath, { flags: 'a' });
          logStreamDone = false;
          logStream.on('finish', () => {
            logStreamDone = true;
            checkAllDone();
          });
          logStream.write(`--- Gemini CLI Execution Start: ${new Date().toISOString()} ---\n`);
          logStream.write(`Command: gemini ${args.join(' ')}\n\n`);
        } catch (err) {
          Logger.warn(`Failed to create log file at ${logPath} — debug output will not be saved. Continuing. Reason: ${err}`);
          logStreamDone = true;
        }
      }

      // Safety timeout (default: 10 minutes / 600,000 ms, configurable via timeoutMs)
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          child.kill('SIGKILL');
          if (logStream) {
            logStream.write('\n\n--- Gemini CLI process timed out ---\n');
            logStream.end();
          }
          const timeoutSec = timeoutMs / 1000;
          Logger.error(`\nGemini CLI process timed out after ${timeoutSec} seconds.`);
          resolve({ error: `Process timeout exceeded (${timeoutSec} seconds)`, raw_output: stderr });
        }
      }, timeoutMs);

      // Track completion of streams
      let stdoutDone = false;
      let stderrDone = false;
      let processDone = false;

      function checkAllDone() {
        if (stdoutDone && stderrDone && processDone && logStreamDone && !resolved) {
          resolved = true;
          clearTimeout(timeout);

          if (!stdout || stdout.trim() === '') {
            return resolve({ error: 'Empty output from Gemini CLI', raw_output: stderr });
          }

          return resolve({
            response: stdout.trim(),
            raw_output: `${stdout}\n--- STDERR ---\n${stderr}`
          } as AgentOutput);
        }
      }

      if (child.stdout) {
        child.stdout.on('data', (data) => {
          const chunk = data.toString();
          stdout += chunk;
          if (logStream) logStream.write(chunk);
        });
        child.stdout.on('end', () => {
          stdoutDone = true;
          checkAllDone();
        });
      } else {
        stdoutDone = true;
      }

      if (child.stderr) {
        child.stderr.on('data', (data) => {
          const chunk = data.toString();
          stderr += chunk;
          if (onLog) {
            const lines = chunk.split('\n').filter((l: string) => l.trim() !== '');
            if (lines.length > 0) {
              onLog(lines[lines.length - 1]);
            }
          }
        });
        child.stderr.on('end', () => {
          stderrDone = true;
          checkAllDone();
        });
      } else {
        stderrDone = true;
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
        if (logStream) {
          logStream.write(`\n\n--- Gemini CLI exited with status ${code} ---\n`);
          logStream.end();
        }

        if (code !== 0 && !resolved) {
          Logger.error(`Gemini CLI exited with status ${code}`);
          if (stderr) {
            Logger.debug(`Gemini CLI Stderr: ${stderr.trim()}`);
          }
        }

        processDone = true;
        checkAllDone();
      });
    });
  }

  async linkSkill(absoluteSkillPath: string, worktreePath: string): Promise<void> {
    const skillName = path.basename(absoluteSkillPath);
    const localSkillsDir = path.join(worktreePath, '.agents', 'skills');
    const symlinkPath = path.join(localSkillsDir, skillName);

    if (!fs.existsSync(localSkillsDir)) {
      fs.mkdirSync(localSkillsDir, { recursive: true });
    }
    if (fs.existsSync(symlinkPath)) {
      fs.unlinkSync(symlinkPath);
    }
    fs.symlinkSync(absoluteSkillPath, symlinkPath, 'dir');
  }

  async disableSkill(skillName: string, worktreePath: string): Promise<void> {
    executor.execSync(`gemini skills disable ${skillName} --scope workspace`, { cwd: worktreePath, stdio: 'ignore' });
  }
}
