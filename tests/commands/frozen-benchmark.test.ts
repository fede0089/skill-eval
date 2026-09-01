import { test, mock } from 'node:test';
import { execFileSync } from 'node:child_process';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { functionalCommand } from '../../src/commands/functional.js';
import { EvalEnvironment } from '../../src/core/environment.js';
import { EvalRunner } from '../../src/core/eval-runner.js';
import { executor } from '../../src/utils/exec.js';
import type { EvalRunOptions } from '../../src/core/eval-runner.js';

// Drives the command against real Git and a real skill on disk, so it lives apart
// from the mock-heavy command tests: those replace fs wholesale, and this one needs
// the copies the freeze and the cut actually produce.

function commit(cwd: string, message: string): void {
  execFileSync('git', ['add', '-A'], { cwd, stdio: 'ignore' });
  execFileSync('git', [
    '-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-qm', message
  ], { cwd, stdio: 'ignore' });
}

function writeBenchmark(skillPath: string, expectation: string, settings: string): void {
  fs.mkdirSync(path.join(skillPath, 'evals', 'config', 'gemini-cli'), { recursive: true });
  fs.writeFileSync(path.join(skillPath, 'evals', 'license.json'), JSON.stringify({
    skill_name: 'mock-skill',
    evals: [{ id: 1, prompt: 'do the thing', expectations: [expectation] }]
  }));
  fs.writeFileSync(path.join(skillPath, 'evals', 'config', 'gemini-cli', 'settings.json'), settings);
}

test('functionalCommand measures every variant with the frozen benchmark and links only implementations', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-frozen-repo-'));
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-frozen-out-'));
  const skillPath = path.join(workspace, 'mock-skill');

  execFileSync('git', ['init', '-q'], { cwd: workspace, stdio: 'ignore' });
  fs.mkdirSync(skillPath, { recursive: true });
  fs.writeFileSync(path.join(skillPath, 'SKILL.md'), '# old implementation\n');
  writeBenchmark(skillPath, 'the old expectation', '{"frozen":false}');
  commit(workspace, 'the historical version');

  fs.writeFileSync(path.join(skillPath, 'SKILL.md'), '# new implementation\n');
  writeBenchmark(skillPath, 'the local expectation', '{"frozen":true}');
  commit(workspace, 'the local version');

  // Preflight only asks the shell whether the agent binary is on PATH; everything
  // else on this path is real git, which extracting the ref depends on.
  const realExecSync = executor.execSync;
  t.mock.method(executor, 'execSync', (command: string, options?: any) =>
    command.startsWith('which ') ? Buffer.from('') : realExecSync(command, options));

  // Teardown would remove the copies before they can be inspected.
  t.mock.method(EvalEnvironment.prototype, 'setup', async () => {});
  t.mock.method(EvalEnvironment.prototype, 'teardown', async () => {});

  const captured: EvalRunOptions[] = [];
  t.mock.method(EvalRunner.prototype, 'runFunctionalTask', async function (this: any) {
    captured.push(this.options);
    return { id: 1, transcript: { response: 'ok' }, assertionResults: [], trialPassed: true };
  });

  try {
    await functionalCommand(
      'gemini-cli', 'gemini-cli', workspace, 'mock-skill', 1, undefined, 1,
      { generate: () => {} }, undefined, undefined, ['HEAD~1'], false, undefined, outputRoot
    );

    const byVariant = new Map(captured.map(o => [o.variant, o]));
    assert.deepStrictEqual([...byVariant.keys()].sort(), ['local', 'ref:HEAD~1']);

    const local = byVariant.get('local')!;
    const historical = byVariant.get('ref:HEAD~1')!;

    // 1. One frozen benchmark for both variants, and it is the local one.
    assert.ok(local.benchmarkDir, 'Expected the run to have frozen a benchmark');
    assert.strictEqual(historical.benchmarkDir, local.benchmarkDir, 'Both variants must be measured with the same benchmark');
    assert.strictEqual(
      fs.readFileSync(path.join(local.benchmarkDir!, 'config', 'gemini-cli', 'settings.json'), 'utf-8'),
      '{"frozen":true}',
      'The frozen evaluation config must be the local one, not the one the ref carried'
    );
    assert.match(
      fs.readFileSync(path.join(local.benchmarkDir!, 'license.json'), 'utf-8'),
      /the local expectation/
    );

    // 2. Each variant contributes its own implementation, and no benchmark travels with it.
    assert.strictEqual(fs.readFileSync(path.join(local.skillPath, 'SKILL.md'), 'utf-8'), '# new implementation\n');
    assert.strictEqual(fs.readFileSync(path.join(historical.skillPath, 'SKILL.md'), 'utf-8'), '# old implementation\n');
    for (const [variant, options] of byVariant) {
      assert.ok(
        !fs.existsSync(path.join(options.skillPath, 'evals')),
        `The trial environment of '${variant}' must not receive the benchmark`
      );
      assert.ok(
        !path.resolve(options.skillPath).startsWith(path.resolve(skillPath) + path.sep) &&
        path.resolve(options.skillPath) !== path.resolve(skillPath),
        `The trial environment of '${variant}' must link a copy, not the author's skill`
      );
    }
  } finally {
    mock.reset();
    fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});
