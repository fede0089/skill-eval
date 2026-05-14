import * as fs from 'fs';
import * as path from 'path';
import child_process from 'child_process';
import { AgentOutput } from '../../types/index.js';
import { AgentRunner } from '../runner.interface.js';
import { Logger } from '../../utils/logger.js';

type UnknownRecord = Record<string, unknown>;

interface LinkedSkill {
  name: string;
  path: string;
  instructionsPath: string;
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

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function extractText(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(extractText);
  if (!isRecord(value)) return [];

  const direct = ['text', 'message', 'content', 'output_text', 'final_message']
    .flatMap((key) => extractText(value[key]));
  if (direct.length > 0) return direct;

  return [];
}

function getEventItem(event: UnknownRecord): UnknownRecord | undefined {
  const item = event.item ?? event.message ?? event.event;
  return isRecord(item) ? item : undefined;
}

function getAssistantText(event: UnknownRecord): string[] {
  const eventType = String(event.type ?? '');
  if (eventType === 'agent_message' || eventType === 'assistant_message') {
    return extractText(event);
  }

  const item = getEventItem(event);
  if (!item) return [];

  const itemType = String(item.type ?? '');
  if (itemType === 'agent_message' || itemType === 'assistant_message' || itemType === 'message') {
    return extractText(item);
  }

  return [];
}

function eventSignalsSkill(event: UnknownRecord, skillName: string): boolean {
  const serialized = JSON.stringify(event).toLowerCase();
  const normalizedSkill = skillName.toLowerCase();
  const eventType = String(event.type ?? '').toLowerCase();
  const item = getEventItem(event);
  const itemType = String(item?.type ?? '').toLowerCase();

  return (
    serialized.includes(normalizedSkill) &&
    (
      serialized.includes('skill') ||
      eventType.includes('skill') ||
      itemType.includes('skill') ||
      serialized.includes('"activate_skill"') ||
      serialized.includes('"use_skill"')
    )
  );
}

function eventIsFailure(event: UnknownRecord): boolean {
  const status = String(event.status ?? '').toLowerCase();
  const item = getEventItem(event);
  const itemStatus = String(item?.status ?? '').toLowerCase();
  return ['error', 'failed', 'failure'].includes(status) || ['error', 'failed', 'failure'].includes(itemStatus);
}

function getErrorMessage(event: UnknownRecord): string | null {
  const eventType = String(event.type ?? '').toLowerCase();
  if (!eventType.includes('error') && !eventIsFailure(event)) return null;

  const message = extractText(event).join('\n').trim();
  if (message) return message;

  const error = event.error;
  if (typeof error === 'string') return error;
  if (isRecord(error)) {
    const nested = extractText(error).join('\n').trim();
    if (nested) return nested;
  }

  return 'Codex run failed';
}

function getUsage(event: UnknownRecord): UnknownRecord | undefined {
  const usage = event.usage ?? event.token_usage;
  if (isRecord(usage)) return usage;
  const item = getEventItem(event);
  const itemUsage = item?.usage ?? item?.token_usage;
  return isRecord(itemUsage) ? itemUsage : undefined;
}

function numberFrom(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

/**
 * Converts Codex exec JSONL events into the small NDJSON contract used by the
 * rest of the evaluator. The normalizer is intentionally tolerant because the
 * Codex JSON event stream is richer than the evaluator needs and may grow over
 * time.
 */
export function normalizeCodexJsonl(output: string, skillName?: string): string {
  const normalized: UnknownRecord[] = [];
  let sawResult = false;
  let sawSkillActivation = false;
  let errorMessage: string | null = null;
  let usage: UnknownRecord | undefined;

  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let event: UnknownRecord;
    try {
      event = JSON.parse(trimmed) as UnknownRecord;
    } catch {
      continue;
    }

    for (const text of getAssistantText(event)) {
      if (text.trim()) {
        normalized.push({ type: 'message', role: 'assistant', content: text });
      }
    }

    if (skillName && !sawSkillActivation && eventSignalsSkill(event, skillName)) {
      sawSkillActivation = true;
      normalized.push({
        type: 'tool_use',
        tool_id: `codex-skill-${normalized.length + 1}`,
        tool_name: 'activate_skill',
        parameters: { name: skillName },
      });
      normalized.push({
        type: 'tool_result',
        tool_id: `codex-skill-${normalized.length}`,
        status: eventIsFailure(event) ? 'error' : 'success',
      });
    }

    const eventUsage = getUsage(event);
    if (eventUsage) usage = eventUsage;

    const maybeError = getErrorMessage(event);
    if (maybeError) errorMessage = maybeError;

    const eventType = String(event.type ?? '');
    if (eventType === 'result') {
      sawResult = true;
      normalized.push(event);
    }
  }

  if (!sawResult) {
    if (errorMessage) {
      normalized.push({ type: 'result', status: 'error', error: { message: errorMessage } });
    } else {
      const inputTokens = usage ? numberFrom(usage.input_tokens) ?? numberFrom(usage.inputTokens) ?? 0 : 0;
      const outputTokens = usage ? numberFrom(usage.output_tokens) ?? numberFrom(usage.outputTokens) ?? 0 : 0;
      const stats = usage ? {
        total_tokens: numberFrom(usage.total_tokens) ?? numberFrom(usage.totalTokens) ?? inputTokens + outputTokens,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cached: numberFrom(usage.cached) ?? numberFrom(usage.cached_tokens) ?? numberFrom(usage.cached_input_tokens) ?? numberFrom(usage.cachedTokens) ?? 0,
      } : undefined;
      normalized.push({ type: 'result', status: 'success', ...(stats ? { stats } : {}) });
    }
  }

  return normalized.map((event) => JSON.stringify(event)).join('\n');
}

export class CodexRunner implements AgentRunner {
  readonly skillDispatchToolName = 'activate_skill';
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

      const linkedSkill = cwd ? this.linkedSkillsByWorktree.get(path.resolve(cwd)) : undefined;
      const skillConfigArgs = linkedSkill
        ? ['-c', `skills.config=[{path=${tomlString(linkedSkill.path)},enabled=true}]`]
        : [];
      const instructionArgs = linkedSkill
        ? ['-c', `model_instructions_file=${tomlString(linkedSkill.instructionsPath)}`]
        : [];

      const args = [
        'exec',
        '--json',
        '--cd', cwd ?? process.cwd(),
        '--sandbox', 'workspace-write',
        '-c', 'approval_policy="never"',
        '--skip-git-repo-check',
        '--ephemeral',
        '--color', 'never',
        ...skillConfigArgs,
        ...instructionArgs,
        ...extraArgs,
        prompt,
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
          Logger.warn(`Failed to write Codex debug log at ${logPath}. Continuing. Reason: ${err}`);
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

      const child = child_process.spawn('codex', args, spawnOptions);

      appendLog(`--- Codex Execution Start: ${new Date().toISOString()} ---\n`);
      appendLog(`Command: codex ${args.join(' ')}\n\n`);

      if (timeoutMs && timeoutMs > 0) {
        timeout = setTimeout(() => {
          if (resolved) return;
          resolved = true;
          killProcessGroup();
          const timeoutSec = timeoutMs / 1000;
          Logger.error(`\nCodex process timed out after ${timeoutSec} seconds.`);
          appendLog(`\n\n--- Codex process timed out ---\n${stderr}\n`);
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
        Logger.error(`Failed to start Codex CLI. Error: ${err.message}`);
        appendLog(`\n\n--- Error starting Codex CLI ---\n${err.message}\n`);
        resolve(null);
      });

      child.on('close', (code) => {
        appendLog(`\n\n--- Codex exited with status ${code} ---\n`);
        if (code !== 0 && stderr) {
          appendLog(`--- Stderr ---\n${stderr}\n--- End Stderr ---\n`);
        }

        if (resolved) return;
        resolved = true;
        if (timeout) clearTimeout(timeout);

        if (!stdout.trim()) {
          resolve({ error: 'Empty output from Codex CLI', raw_output: stderr });
          return;
        }

        const normalized = normalizeCodexJsonl(stdout, linkedSkill?.name);
        if (code !== 0) {
          resolve({
            error: `Codex CLI exited with status ${code}`,
            response: normalized,
            raw_output: `${normalized}\n--- CODEX STDOUT ---\n${stdout}\n--- STDERR ---\n${stderr}`,
          });
          return;
        }

        resolve({
          response: normalized,
          raw_output: `${normalized}\n--- CODEX STDOUT ---\n${stdout}\n--- STDERR ---\n${stderr}`,
        } as AgentOutput);
      });
    });
  }

  applyRunnerConfig(evalConfigBaseDir: string, worktreePath: string): void {
    const src = path.join(evalConfigBaseDir, 'codex');
    if (!fs.existsSync(src)) return;
    const dst = path.join(worktreePath, '.codex');
    fs.mkdirSync(dst, { recursive: true });
    fs.cpSync(src, dst, { recursive: true, force: true });
  }

  async linkSkill(absoluteSkillPath: string, worktreePath: string): Promise<void> {
    const skillName = readSkillName(absoluteSkillPath);
    const localSkillsDir = path.join(worktreePath, '.codex', 'skills');
    const symlinkPath = path.join(localSkillsDir, skillName);

    fs.mkdirSync(localSkillsDir, { recursive: true });
    if (fs.existsSync(symlinkPath)) {
      fs.rmSync(symlinkPath, { recursive: true, force: true });
    }
    fs.symlinkSync(absoluteSkillPath, symlinkPath, 'dir');

    const instructionsPath = path.join(worktreePath, '.codex', 'skill-eval-instructions.md');
    fs.writeFileSync(instructionsPath, [
      'You are running inside an automated Agent Skill evaluation.',
      'Complete the user task end-to-end without asking for approval, waiting for confirmation, or stopping after a plan.',
      'Use the configured skill when it applies. If you use a skill, read and follow its SKILL.md instructions.',
      'Make any required edits directly in the current working directory.',
      'Keep the final response concise.',
      '',
    ].join('\n'));

    this.linkedSkillsByWorktree.set(path.resolve(worktreePath), {
      name: skillName,
      path: symlinkPath,
      instructionsPath,
    });
  }
}
