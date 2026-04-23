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
    timeoutMs?: number
  ): Promise<AgentOutput | null> {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let resolved = false;
      let logStreamEnded = false;

      type TerminationReason = 'timeout' | 'interactive-prompt' | 'error' | 'normal';
      let terminationReason: TerminationReason = 'normal';

      // Matches interactive Y/N prompts only when they appear at the end of a chunk
      // (optionally followed by ": " or whitespace), indicating the process is waiting
      // for user input it will never receive (stdin is closed).
      // Anchoring to end-of-chunk avoids false positives from generated content that
      // happens to contain "[Y/n]" in the middle of a line.
      const INTERACTIVE_PROMPT_RE = /\[[yYnN]\/[yYnN]\]\s*:?\s*$/;

      let timeout: NodeJS.Timeout | undefined;

      function killProcessGroup() {
        if (child.pid) {
          try {
            // Signal the entire process group by using negative PID (Unix only)
            process.kill(-child.pid, 'SIGKILL');
          } catch (err) {
            // Process might have already exited
          }
        }
      }

      function killOnInteractivePrompt(chunk: string): boolean {
        if (!resolved && INTERACTIVE_PROMPT_RE.test(chunk)) {
          resolved = true;
          if (timeout) clearTimeout(timeout);
          killProcessGroup();
          terminationReason = 'interactive-prompt';
          if (logStream) {
            logStream.write('\n\n--- Gemini CLI blocked on interactive prompt — killed ---\n');
            logStream.write(`--- Triggering text: ${JSON.stringify(chunk)} ---\n`);
            if (stderr) {
              logStream.write(`--- Stderr at time of kill ---\n${stderr}\n--- End stderr ---\n`);
            }
            // End the stream here so the log is fully flushed before resolving.
            // logStreamEnded prevents child.on('close') from double-ending it.
            logStreamEnded = true;
            logStream.end(() => {
              resolve({ error: 'Gemini CLI blocked on interactive prompt', raw_output: stderr });
            });
          } else {
            resolve({ error: 'Gemini CLI blocked on interactive prompt', raw_output: stderr });
          }
          return true;
        }
        return false;
      }

      // Use -p, --approval-mode auto_edit and --output-format stream-json for headless NDJSON mode.
      const args: string[] = ['-p', prompt, '--approval-mode', 'auto_edit', '--output-format', 'stream-json', ...extraArgs];

      const spawnOptions: any = {
        cwd: cwd,
        env: { ...process.env, FORCE_COLOR: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],  // stdin closed → interactive reads get EOF immediately
        detached: true
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

      // Safety timeout (configurable via timeoutMs)
      if (timeoutMs && timeoutMs > 0) {
        timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            killProcessGroup();
            terminationReason = 'timeout';
            // logStream is finalized (marker + stderr + end) in child.on('close')
            const timeoutSec = timeoutMs / 1000;
            Logger.error(`\nGemini CLI process timed out after ${timeoutSec} seconds.`);
            resolve({ error: `Process timeout exceeded (${timeoutSec} seconds)`, raw_output: stderr });
          }
        }, timeoutMs);
      }

      // Track completion of streams
      let stdoutDone = false;
      let stderrDone = false;
      let processDone = false;

      function checkAllDone() {
        if (stdoutDone && stderrDone && processDone && logStreamDone && !resolved) {
          resolved = true;
          if (timeout) clearTimeout(timeout);

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
          if (killOnInteractivePrompt(chunk)) return;
          stdout += chunk;
          // Guard against write-after-end: if an interactive prompt on stderr killed the
          // process, logStreamEnded is already true while buffered stdout chunks drain.
          if (logStream && !logStreamEnded) logStream.write(chunk);
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
          if (killOnInteractivePrompt(chunk)) return;
          stderr += chunk;
          if (onLog) {
            const lines = chunk.split('\n').filter(
              (l: string) => l.trim() !== '' && !l.startsWith('[DEBUG]')
            );
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
          if (timeout) clearTimeout(timeout);
          terminationReason = 'error';
          // logStream is finalized (marker + stderr + end) in child.on('close')
          Logger.error(`Failed to start gemini CLI. Error: ${err.message}`);
          resolve(null);
        }
      });

      child.on('close', (code) => {
        if (logStream && !logStreamEnded) {
          logStreamEnded = true;
          if (terminationReason === 'timeout') {
            logStream.write('\n\n--- Gemini CLI process timed out ---\n');
            if (stderr) logStream.write(`--- Stderr ---\n${stderr}\n--- End Stderr ---\n`);
          } else if (terminationReason === 'error') {
            logStream.write('\n\n--- Error starting Gemini CLI ---\n');
            if (stderr) logStream.write(`--- Stderr ---\n${stderr}\n--- End Stderr ---\n`);
          } else {
            // 'normal' exit (interactive-prompt is excluded by the !logStreamEnded guard above)
            logStream.write(`\n\n--- Gemini CLI exited with status ${code} ---\n`);
            if (code !== 0 && stderr) {
              logStream.write(`--- Stderr ---\n${stderr}\n--- End Stderr ---\n`);
            }
          }
          logStream.end();
        }

        if (code !== 0 && !resolved) {
          if (onLog) onLog(`Exited with status ${code}`);
        }

        processDone = true;
        checkAllDone();
      });
    });
  }

  applyRunnerConfig(evalConfigBaseDir: string, worktreePath: string): void {
    const src = path.join(evalConfigBaseDir, 'gemini-cli');
    if (!fs.existsSync(src)) return;
    const dst = path.join(worktreePath, '.gemini');
    fs.mkdirSync(dst, { recursive: true });
    fs.cpSync(src, dst, { recursive: true, force: true });
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

}
