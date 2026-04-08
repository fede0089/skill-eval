import { spawnSync } from 'child_process';
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
   * @returns Parsed JSON output from Gemini
   */
  public runPrompt(prompt: string, cwd?: string): AgentOutput | null {
    try {
      const child = spawnSync('gemini', [
        '-p', prompt,
        '-o', 'json',
        '--approval-mode', 'auto_edit'
      ], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe']
      });

      if (child.error) {
        Logger.error(`Failed to start gemini CLI. Error: ${child.error.message}`);
        return null;
      }

      if (child.status !== 0) {
        Logger.error(`Gemini CLI exited with status ${child.status}`);
        if (child.stderr) {
          Logger.error(`Gemini CLI Stderr: ${child.stderr.trim()}`);
        }
      }

      const rawOutput = child.stdout;
      if (!rawOutput || rawOutput.trim() === '') {
        Logger.error(`Received empty output from Gemini CLI. Cannot evaluate.`);
        return null;
      }

      // Extract JSON part from output
      let jsonPart = rawOutput.trim();
      const firstBraceIndex = jsonPart.indexOf('{');
      if (firstBraceIndex > 0) {
        jsonPart = jsonPart.substring(firstBraceIndex);
      }

      try {
        const parsed = JSON.parse(jsonPart);
        return parsed as AgentOutput;
      } catch (parseError) {
        Logger.error(`Failed to parse JSON output: ${parseError}`);
        Logger.error(`Runner Output Preview: ${rawOutput.substring(0, 300)}`);
        return null;
      }

    } catch (e) {
      Logger.error(`Unexpected error running process: ${e}`);
      return null;
    }
  }
}
