import { test, mock } from 'node:test';
import assert from 'node:assert';
import child_process from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { CodexRunner, normalizeCodexJsonl } from '../../../src/runners/codex/runner.js';
import { parseStreamResult, parseTokenStats } from '../../../src/utils/ndjson.js';

function createMockChild() {
  const child = new EventEmitter() as any;
  child.pid = 12345;
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });
  return child;
}

test('CodexRunner.runPrompt invokes codex exec in non-interactive JSON mode', async () => {
  const mockChild = createMockChild();
  const spawnMock = mock.method(child_process, 'spawn', () => mockChild);

  const runner = new CodexRunner();
  const cwd = '/some/worktree';
  const promise = runner.runPrompt('test prompt', cwd);

  setImmediate(() => {
    mockChild.stdout.push(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'done' } }) + '\n');
    mockChild.stdout.push(JSON.stringify({ type: 'turn.completed' }) + '\n');
    mockChild.stdout.push(null);
    mockChild.stderr.push(null);
    mockChild.emit('close', 0);
  });

  await promise;

  assert.strictEqual(spawnMock.mock.callCount(), 1);
  const args = spawnMock.mock.calls[0].arguments[1] as string[];
  assert.deepStrictEqual(args.slice(0, 2), ['exec', '--json']);
  assert.ok(args.includes('--cd'), 'Should include --cd');
  assert.strictEqual(args[args.indexOf('--cd') + 1], cwd);
  assert.ok(args.includes('--sandbox'), 'Should include --sandbox');
  assert.strictEqual(args[args.indexOf('--sandbox') + 1], 'workspace-write');
  assert.ok(args.includes('approval_policy="never"'), 'Should disable interactive approvals through config');
  assert.ok(args.includes('--ephemeral'), 'Should run without persisting sessions');
  assert.strictEqual(args[args.length - 1], 'test prompt');

  spawnMock.mock.restore();
});

test('CodexRunner.linkSkill symlinks skill by frontmatter name and passes skills.config override', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-runner-'));
  const skillDir = path.join(tempDir, 'skill-dir');
  const worktreeDir = path.join(tempDir, 'worktree');
  fs.mkdirSync(skillDir);
  fs.mkdirSync(worktreeDir);
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: license-generator\ndescription: test\n---\n# Test\n');

  const mockChild = createMockChild();
  const spawnMock = mock.method(child_process, 'spawn', () => mockChild);

  try {
    const runner = new CodexRunner();
    await runner.linkSkill(skillDir, worktreeDir);

    const linkedPath = path.join(worktreeDir, '.codex', 'skills', 'license-generator');
    assert.ok(fs.lstatSync(linkedPath).isSymbolicLink(), 'Skill should be linked into .codex/skills');
    const instructionsPath = path.join(worktreeDir, '.codex', 'skill-eval-instructions.md');
    assert.ok(fs.existsSync(instructionsPath), 'Runner should create eval-specific Codex instructions');

    const promise = runner.runPrompt('test prompt', worktreeDir);
    setImmediate(() => {
      mockChild.stdout.push(JSON.stringify({ type: 'turn.completed' }) + '\n');
      mockChild.stdout.push(null);
      mockChild.stderr.push(null);
      mockChild.emit('close', 0);
    });
    await promise;

    const args = spawnMock.mock.calls[0].arguments[1] as string[];
    const configArgIndex = args.findIndex((arg) => arg.startsWith('skills.config='));
    assert.ok(configArgIndex >= 0, `Expected skills.config override in args: ${JSON.stringify(args)}`);
    assert.ok(args[configArgIndex].includes(linkedPath), 'skills.config should point at the linked skill path');
    const instructionsArgIndex = args.findIndex((arg) => arg.startsWith('model_instructions_file='));
    assert.ok(instructionsArgIndex >= 0, `Expected model_instructions_file override in args: ${JSON.stringify(args)}`);
    assert.ok(args[instructionsArgIndex].includes(instructionsPath), 'model_instructions_file should point at eval instructions');
  } finally {
    spawnMock.mock.restore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('normalizeCodexJsonl maps Codex messages, skill events, errors, and token usage to internal NDJSON', () => {
  const codexJsonl = [
    JSON.stringify({ type: 'item.completed', item: { type: 'skill_activation', name: 'license-generator', status: 'success' } }),
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Created LICENSE' } }),
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 5, output_tokens: 7, cached_input_tokens: 2 } }),
  ].join('\n');

  const normalized = normalizeCodexJsonl(codexJsonl, 'license-generator');
  const result = parseStreamResult(normalized);
  const tokenStats = parseTokenStats(normalized);

  assert.deepStrictEqual(result, { response: 'Created LICENSE' });
  assert.deepStrictEqual(tokenStats, {
    totalTokens: 12,
    inputTokens: 5,
    outputTokens: 7,
    cachedTokens: 2,
  });
  assert.ok(normalized.includes('"tool_name":"activate_skill"'), 'Should synthesize skill activation event');
  assert.ok(normalized.includes('"status":"success"'), 'Should synthesize successful skill result');
});

test('CodexRunner.applyRunnerConfig copies codex eval config into .codex', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-config-'));
  const configBase = path.join(tempDir, 'evals', 'config');
  const codexConfig = path.join(configBase, 'codex');
  const worktreeDir = path.join(tempDir, 'worktree');
  fs.mkdirSync(codexConfig, { recursive: true });
  fs.mkdirSync(worktreeDir);
  fs.writeFileSync(path.join(codexConfig, 'config.toml'), 'model = "gpt-5.4"\n');

  try {
    const runner = new CodexRunner();
    runner.applyRunnerConfig(configBase, worktreeDir);

    assert.strictEqual(
      fs.readFileSync(path.join(worktreeDir, '.codex', 'config.toml'), 'utf-8'),
      'model = "gpt-5.4"\n'
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
