import { test, mock } from 'node:test';
import assert from 'node:assert';
import child_process from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ClaudeCodeRunner, normalizeClaudeJsonl } from '../../../src/runners/claude-code/runner.js';
import { parseStreamResult, parseTokenStats, parseNdjsonEvents } from '../../../src/utils/ndjson.js';
import { TriggerGrader } from '../../../src/core/evaluator.js';

function createMockChild() {
  const child = new EventEmitter() as any;
  child.pid = 12345;
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });
  return child;
}

test('ClaudeCodeRunner.runPrompt invokes claude with -p, stream-json, and bypassPermissions', async () => {
  const mockChild = createMockChild();
  const spawnMock = mock.method(child_process, 'spawn', () => mockChild);

  const runner = new ClaudeCodeRunner();
  const cwd = '/some/worktree';
  const promise = runner.runPrompt('test prompt', cwd);

  setImmediate(() => {
    mockChild.stdout.push(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'done' }) + '\n');
    mockChild.stdout.push(null);
    mockChild.stderr.push(null);
    mockChild.emit('close', 0);
  });

  await promise;

  assert.strictEqual(spawnMock.mock.callCount(), 1);
  const callArgs = spawnMock.mock.calls[0].arguments;
  assert.strictEqual(callArgs[0], 'claude');
  const args = callArgs[1] as string[];
  assert.ok(args.includes('-p'), 'Should include -p');
  assert.strictEqual(args[args.indexOf('-p') + 1], 'test prompt');
  assert.ok(args.includes('--output-format'), 'Should include --output-format');
  assert.strictEqual(args[args.indexOf('--output-format') + 1], 'stream-json');
  assert.ok(args.includes('--verbose'), 'Should include --verbose');
  assert.ok(args.includes('--permission-mode'), 'Should include --permission-mode');
  assert.strictEqual(args[args.indexOf('--permission-mode') + 1], 'bypassPermissions');
  assert.ok(args.includes('--no-session-persistence'), 'Should disable session persistence');
  assert.strictEqual(callArgs[2]?.cwd, cwd);

  spawnMock.mock.restore();
});

test('ClaudeCodeRunner.linkSkill symlinks the skill by frontmatter name into .claude/skills', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-runner-'));
  const skillDir = path.join(tempDir, 'skill-dir');
  const worktreeDir = path.join(tempDir, 'worktree');
  fs.mkdirSync(skillDir);
  fs.mkdirSync(worktreeDir);
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: license-generator\ndescription: test\n---\n# Test\n');

  try {
    const runner = new ClaudeCodeRunner();
    await runner.linkSkill(skillDir, worktreeDir);

    const linkedPath = path.join(worktreeDir, '.claude', 'skills', 'license-generator');
    assert.ok(fs.lstatSync(linkedPath).isSymbolicLink(), 'Skill should be linked into .claude/skills');
    assert.strictEqual(fs.readlinkSync(linkedPath), skillDir, 'Symlink should point to skill source');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('ClaudeCodeRunner.applyRunnerConfig copies evals/config/claude-code into .claude', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-config-'));
  const configBase = path.join(tempDir, 'evals', 'config');
  const claudeConfig = path.join(configBase, 'claude-code');
  const worktreeDir = path.join(tempDir, 'worktree');
  fs.mkdirSync(claudeConfig, { recursive: true });
  fs.mkdirSync(worktreeDir);
  fs.writeFileSync(path.join(claudeConfig, 'settings.json'), '{"includeCoAuthoredBy": false}\n');

  try {
    const runner = new ClaudeCodeRunner();
    runner.applyRunnerConfig(configBase, worktreeDir);

    assert.strictEqual(
      fs.readFileSync(path.join(worktreeDir, '.claude', 'settings.json'), 'utf-8'),
      '{"includeCoAuthoredBy": false}\n'
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('ClaudeCodeRunner.applyRunnerConfig is a no-op when the config directory is absent', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-config-'));
  const configBase = path.join(tempDir, 'evals', 'config');
  const worktreeDir = path.join(tempDir, 'worktree');
  fs.mkdirSync(configBase, { recursive: true });
  fs.mkdirSync(worktreeDir);

  try {
    const runner = new ClaudeCodeRunner();
    runner.applyRunnerConfig(configBase, worktreeDir);
    assert.ok(!fs.existsSync(path.join(worktreeDir, '.claude')), '.claude should not be created when no source config exists');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('normalizeClaudeJsonl maps assistant text, Skill tool_use, tool_result, and token usage', () => {
  const claudeStream = [
    JSON.stringify({ type: 'system', subtype: 'init', session_id: 'abc' }),
    JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Skill', input: { skill: 'license-generator', args: 'MIT for John' } }] },
    }),
    JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'Launching skill: license-generator' }] },
      tool_use_result: { success: true, commandName: 'license-generator' },
    }),
    JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Created LICENSE' }] },
    }),
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'Created LICENSE',
      usage: { input_tokens: 5, output_tokens: 7, cache_read_input_tokens: 2 },
    }),
  ].join('\n');

  const normalized = normalizeClaudeJsonl(claudeStream);
  const events = parseNdjsonEvents(normalized);

  const toolUse = events.find((e) => e.type === 'tool_use');
  assert.ok(toolUse, 'Should emit a tool_use event');
  assert.strictEqual((toolUse as any).tool_name, 'Skill');
  assert.strictEqual((toolUse as any).tool_id, 'toolu_1');
  assert.strictEqual((toolUse as any).parameters.name, 'license-generator');

  const toolResult = events.find((e) => e.type === 'tool_result');
  assert.ok(toolResult, 'Should emit a tool_result event');
  assert.strictEqual((toolResult as any).tool_id, 'toolu_1');
  assert.strictEqual((toolResult as any).status, 'success');

  const stream = parseStreamResult(normalized);
  assert.deepStrictEqual(stream, { response: 'Created LICENSE' });

  const tokens = parseTokenStats(normalized);
  assert.deepStrictEqual(tokens, {
    totalTokens: 12,
    inputTokens: 5,
    outputTokens: 7,
    cachedTokens: 2,
  });
});

test('normalizeClaudeJsonl output makes TriggerGrader detect skill activation', () => {
  const claudeStream = [
    JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_xyz', name: 'Skill', input: { skill: 'license-generator' } }] },
    }),
    JSON.stringify({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_xyz', content: 'Launching skill: license-generator' }] },
      tool_use_result: { success: true },
    }),
    JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', usage: { input_tokens: 1, output_tokens: 1 } }),
  ].join('\n');

  const normalized = normalizeClaudeJsonl(claudeStream);
  const grader = new TriggerGrader('license-generator', 'Skill');
  const triggered = grader.gradeTrigger({ raw_output: normalized });
  assert.strictEqual(triggered, true, 'TriggerGrader should detect skill activation from normalized stream');
});

test('normalizeClaudeJsonl surfaces is_error results as error events', () => {
  const claudeStream = [
    JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true, result: 'Hit max turns' }),
  ].join('\n');

  const normalized = normalizeClaudeJsonl(claudeStream);
  const stream = parseStreamResult(normalized);
  assert.ok(stream && 'error' in stream, 'Should surface an error');
  assert.ok((stream as { error: string }).error.includes('Hit max turns'));
});

test('normalizeClaudeJsonl injects a synthetic error when no result event is emitted', () => {
  const claudeStream = JSON.stringify({ type: 'system', subtype: 'init' });
  const normalized = normalizeClaudeJsonl(claudeStream);
  const stream = parseStreamResult(normalized);
  assert.ok(stream && 'error' in stream, 'Missing result event should be surfaced as an error');
});

test('ClaudeCodeRunner.runPrompt returns error and raw_output when claude exits non-zero', async () => {
  const mockChild = createMockChild();
  const spawnMock = mock.method(child_process, 'spawn', () => mockChild);

  const runner = new ClaudeCodeRunner();
  const promise = runner.runPrompt('test prompt');

  setImmediate(() => {
    mockChild.stdout.push(JSON.stringify({ type: 'result', subtype: 'error', is_error: true, result: 'bad' }) + '\n');
    mockChild.stdout.push(null);
    mockChild.stderr.push('boom');
    mockChild.stderr.push(null);
    mockChild.emit('close', 2);
  });

  const result = await promise;
  assert.ok(result, 'should resolve a result');
  assert.ok(result?.error, 'should have error');
  assert.ok(result?.raw_output?.includes('boom'), 'should preserve stderr in raw_output');

  spawnMock.mock.restore();
});
