import { spawnSync } from 'child_process';
import { AgentOutput } from '../../types';
import { AgentRunner } from './runner.interface';

export class GeminiCliRunner implements AgentRunner {
  /**
   * Runs the prompt through a headless isolated gemini instance in auto_edit mode.
   * Auto Edit mode automatically allows tools meant for modifying files, falling back interactively
   * only for severe system-level actions.
   * @param prompt The evaluation prompt text
   * @returns Parsed JSON output from Gemini
   */
  public runPrompt(prompt: string): AgentOutput | null {
    // Escaping the prompt just in case. spawnSync handles formatting but better safe.
    try {
      const child = spawnSync('gemini', [
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
        console.error(`\n[Runner] Failed to parse JSON output: ${parseError}`);
        // Dump first 300 chars of raw to debug
        console.error(`[Runner Output Preview] ${rawOutput.substring(0, 300)}`);
        return null;
      }

    } catch (e) {
      console.error(`\n[Runner] Unexpected error running process: ${e}`);
      return null;
    }
  }
}
