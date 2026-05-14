import * as fs from 'fs';
import * as path from 'path';
import child_process from 'child_process';
import { AgentOutput } from '../../types/index.js';
import { AgentRunner } from '../runner.interface.js';
import { Logger } from '../../utils/logger.js';

type UnknownRecord = Record<string, unknown>;

interface LinkedSkill {
  name: string;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function readSkillName(skillPath: string): string {
  const skillMd = path.join(skillPath, 'SKILL.md');
  if (!fs.existsSync(skillMd)) return path.basename(skillPath);

  const content = fs.readFileSync(skillMd, 'utf-8');
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatter) return path.basename(skillPath);

  const nameLine = frontmatter[1].split('\n').find((line) => line.trim().startsWith('name:'));
  const name = nameLine?.replace(/^name:\s*/, '').trim().replace(/^["']|["']$/g, '');
  return name || path.basename(skillPath);
}

function numberFrom(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function getAssistantContent(event: UnknownRecord): UnknownRecord[] {
  const eventType = String(event.type ?? '');
  if (eventType !== 'assistant') return [];
  const message = event.message;
  if (!isRecord(message)) return [];
  const content = message.content;
  if (!Array.isArray(content)) return [];
  return content.filter(isRecord);
}

function getUserContent(event: UnknownRecord): UnknownRecord[] {
  const eventType = String(event.type ?? '');
  if (eventType !== 'user') return [];
  const message = event.message;
  if (!isRecord(message)) return [];
  const content = message.content;
  if (!Array.isArray(content)) return [];
  return content.filter(isRecord);
}

/**
 * Converts Claude Code stream-json events into the small NDJSON contract used
 * by the rest of the evaluator. The normalizer is intentionally tolerant: the
 * Claude Code event stream is richer than the evaluator needs and may grow
 * over time. Only fields the grader/judge consume are mapped.
 */
export function normalizeClaudeJsonl(output: string): string {
  const normalized: UnknownRecord[] = [];
  let sawResult = false;

  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let event: UnknownRecord;
    try {
      event = JSON.parse(trimmed) as UnknownRecord;
    } catch {
      continue;
    }

    for (const item of getAssistantContent(event)) {
      const itemType = String(item.type ?? '');
      if (itemType === 'text' && typeof item.text === 'string' && item.text.trim()) {
        normalized.push({ type: 'message', role: 'assistant', content: item.text });
      } else if (itemType === 'tool_use') {
        const toolName = String(item.name ?? '');
        const toolId = String(item.id ?? `claude-tool-${normalized.length + 1}`);
        const input = isRecord(item.input) ? item.input : {};
        // The internal NDJSON contract expects parameters.name to carry the skill
        // identifier when the dispatch tool is invoked. Claude Code's Skill tool
        // uses `input.skill` for that — remap so TriggerGrader can match it.
        const parameters: UnknownRecord = { ...input };
        if (toolName === 'Skill' && typeof input.skill === 'string') {
          parameters.name = input.skill;
        }
        normalized.push({
          type: 'tool_use',
          tool_id: toolId,
          tool_name: toolName,
          parameters,
        });
      }
    }

    for (const item of getUserContent(event)) {
      const itemType = String(item.type ?? '');
      if (itemType !== 'tool_result') continue;
      const toolId = String(item.tool_use_id ?? '');
      if (!toolId) continue;
      const isError = item.is_error === true;
      // Claude Code attaches a tool_use_result sibling on the parent event with
      // a `success` boolean for built-in tools (e.g. Skill). Prefer that when present.
      const parent = event.tool_use_result;
      const parentSuccess = isRecord(parent) ? parent.success : undefined;
      const status = isError === true || parentSuccess === false ? 'error' : 'success';
      normalized.push({ type: 'tool_result', tool_id: toolId, status });
    }

    const eventType = String(event.type ?? '');
    if (eventType === 'result') {
      sawResult = true;
      const isError = event.is_error === true;
      const usage = isRecord(event.usage) ? event.usage : undefined;
      const inputTokens = usage ? numberFrom(usage.input_tokens) ?? 0 : 0;
      const outputTokens = usage ? numberFrom(usage.output_tokens) ?? 0 : 0;
      const cachedTokens = usage
        ? numberFrom(usage.cache_read_input_tokens)
          ?? numberFrom(usage.cached_input_tokens)
          ?? 0
        : 0;
      const stats = usage
        ? {
            total_tokens: inputTokens + outputTokens,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            cached: cachedTokens,
          }
        : undefined;
      if (isError) {
        const message = typeof event.result === 'string' && event.result.trim()
          ? event.result
          : `Claude Code run failed (subtype: ${String(event.subtype ?? 'unknown')})`;
        normalized.push({ type: 'result', status: 'error', error: { message }, ...(stats ? { stats } : {}) });
      } else {
        const response = typeof event.result === 'string' ? event.result : undefined;
        normalized.push({
          type: 'result',
          status: 'success',
          ...(response ? { response } : {}),
          ...(stats ? { stats } : {}),
        });
      }
    }
  }

  if (!sawResult) {
    normalized.push({ type: 'result', status: 'error', error: { message: 'Claude Code produced no result event' } });
  }

  return normalized.map((event) => JSON.stringify(event)).join('\n');
}

export class ClaudeCodeRunner implements AgentRunner {
  readonly skillDispatchToolName = 'Skill';
  private linkedSkillsByWorktree = new Map<string, LinkedSkill>();

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
      let timeout: NodeJS.Timeout | undefined;

      const args = [
        '-p', prompt,
        '--output-format', 'stream-json',
        '--verbose',
        '--permission-mode', 'bypassPermissions',
        '--no-session-persistence',
        ...extraArgs,
      ];

      const spawnOptions: child_process.SpawnOptions = {
        cwd,
        env: { ...process.env, FORCE_COLOR: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      };

      function appendLog(chunk: string): void {
        if (!logPath) return;
        try {
          fs.appendFileSync(logPath, chunk);
        } catch (err) {
          Logger.warn(`Failed to write Claude Code debug log at ${logPath}. Continuing. Reason: ${err}`);
        }
      }

      function killProcessGroup() {
        if (!child.pid) return;
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          // Process might have already exited.
        }
      }

      const child = child_process.spawn('claude', args, spawnOptions);

      appendLog(`--- Claude Code Execution Start: ${new Date().toISOString()} ---\n`);
      appendLog(`Command: claude ${args.join(' ')}\n\n`);

      if (timeoutMs && timeoutMs > 0) {
        timeout = setTimeout(() => {
          if (resolved) return;
          resolved = true;
          killProcessGroup();
          const timeoutSec = timeoutMs / 1000;
          Logger.error(`\nClaude Code process timed out after ${timeoutSec} seconds.`);
          appendLog(`\n\n--- Claude Code process timed out ---\n${stderr}\n`);
          resolve({ error: `Process timeout exceeded (${timeoutSec} seconds)`, raw_output: stderr });
        }, timeoutMs);
      }

      child.stdout?.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;
        appendLog(chunk);
      });

      child.stderr?.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        if (onLog) {
          const lines = chunk.split('\n').filter((line: string) => line.trim() !== '');
          if (lines.length > 0) onLog(lines[lines.length - 1]);
        }
      });

      child.on('error', (err) => {
        if (resolved) return;
        resolved = true;
        if (timeout) clearTimeout(timeout);
        Logger.error(`Failed to start Claude Code CLI. Error: ${err.message}`);
        appendLog(`\n\n--- Error starting Claude Code CLI ---\n${err.message}\n`);
        resolve(null);
      });

      child.on('close', (code) => {
        appendLog(`\n\n--- Claude Code exited with status ${code} ---\n`);
        if (code !== 0 && stderr) {
          appendLog(`--- Stderr ---\n${stderr}\n--- End Stderr ---\n`);
        }

        if (resolved) return;
        resolved = true;
        if (timeout) clearTimeout(timeout);

        if (!stdout.trim()) {
          resolve({ error: 'Empty output from Claude Code CLI', raw_output: stderr });
          return;
        }

        const normalized = normalizeClaudeJsonl(stdout);
        if (code !== 0) {
          resolve({
            error: `Claude Code CLI exited with status ${code}`,
            response: normalized,
            raw_output: `${normalized}\n--- CLAUDE CODE STDOUT ---\n${stdout}\n--- STDERR ---\n${stderr}`,
          });
          return;
        }

        resolve({
          response: normalized,
          raw_output: `${normalized}\n--- CLAUDE CODE STDOUT ---\n${stdout}\n--- STDERR ---\n${stderr}`,
        } as AgentOutput);
      });
    });
  }

  applyRunnerConfig(evalConfigBaseDir: string, worktreePath: string): void {
    const src = path.join(evalConfigBaseDir, 'claude-code');
    if (!fs.existsSync(src)) return;
    const dst = path.join(worktreePath, '.claude');
    fs.mkdirSync(dst, { recursive: true });
    fs.cpSync(src, dst, { recursive: true, force: true });
  }

  async linkSkill(absoluteSkillPath: string, worktreePath: string): Promise<void> {
    const skillName = readSkillName(absoluteSkillPath);
    const localSkillsDir = path.join(worktreePath, '.claude', 'skills');
    const symlinkPath = path.join(localSkillsDir, skillName);

    fs.mkdirSync(localSkillsDir, { recursive: true });
    if (fs.existsSync(symlinkPath)) {
      fs.rmSync(symlinkPath, { recursive: true, force: true });
    }
    fs.symlinkSync(absoluteSkillPath, symlinkPath, 'dir');

    this.linkedSkillsByWorktree.set(path.resolve(worktreePath), { name: skillName });
  }
}
