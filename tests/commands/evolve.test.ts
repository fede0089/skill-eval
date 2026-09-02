import { test, mock } from 'node:test';
import { execFileSync } from 'node:child_process';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { evolveCommand } from '../../src/commands/evolve.js';
import { EvalRunner } from '../../src/core/eval-runner.js';
import { executor } from '../../src/utils/exec.js';
import { AssertionResult } from '../../src/types/index.js';

// Drives a whole session against real Git and a real skill on disk, with only the
// trials replaced: what a session is worth is what it commits and what it
// restores, and neither is observable without a repository underneath.

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', ...args], {
    cwd,
    encoding: 'utf-8'
  });
}

interface Fixture {
  workspace: string;
  outputRoot: string;
  skillPath: string;
}

/**
 * A repository with a committed skill and a committed file outside it. The file
 * outside is the witness that a session never touches the author's other work.
 */
function makeFixture(): Fixture {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-evolve-repo-'));
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-evolve-out-'));
  const skillPath = path.join(workspace, 'my-skill');

  fs.mkdirSync(path.join(skillPath, 'evals'), { recursive: true });
  fs.writeFileSync(path.join(skillPath, 'SKILL.md'), '# committed implementation\n');
  fs.writeFileSync(path.join(skillPath, 'evals', 'license.json'), JSON.stringify({
    skill_name: 'evolving-skill',
    evals: [{ id: 1, prompt: 'do the thing', expectations: ['A holds', 'B holds'] }]
  }));
  fs.writeFileSync(path.join(workspace, 'README.md'), 'committed readme\n');

  git(workspace, ['init', '-q']);
  git(workspace, ['add', '-A']);
  git(workspace, ['commit', '-qm', 'the committed version']);

  return { workspace, outputRoot, skillPath };
}

/** The candidate the author left in the tree, plus pending work outside the skill. */
function dirtyTheTree(fixture: Fixture): void {
  fs.writeFileSync(path.join(fixture.skillPath, 'SKILL.md'), '# candidate implementation\n');
  fs.writeFileSync(path.join(fixture.workspace, 'README.md'), 'work the author has not committed\n');
}

/**
 * Replaces the trials with a fixed verdict per variant, and records which
 * variants each run measured — that is how the closing comparison is observed.
 */
function stubTrials(t: any, verdicts: { candidate: Record<string, boolean>; incumbent: Record<string, boolean> }): string[] {
  const variantsSeen: string[] = [];

  const realExecSync = executor.execSync;
  t.mock.method(executor, 'execSync', (command: string, options?: any) =>
    command.startsWith('which ') ? Buffer.from('') : realExecSync(command, options));

  t.mock.method(EvalRunner.prototype, 'runFunctionalTask', async function (this: any, _task: any, _i: number, trialId: number) {
    const variant: string = this.options.variant;
    if (!variantsSeen.includes(variant)) variantsSeen.push(variant);
    const results = variant === 'local' ? verdicts.candidate : verdicts.incumbent;
    const assertionResults: AssertionResult[] = Object.entries(results).map(([assertion, passed]) => ({
      assertion, passed, reason: passed ? 'met' : 'not met'
    }));
    return {
      id: trialId,
      transcript: { response: 'ok' },
      assertionResults,
      trialPassed: assertionResults.every(r => r.passed)
    };
  });

  return variantsSeen;
}

function cleanUp(fixture: Fixture): void {
  mock.reset();
  fs.rmSync(fixture.workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  fs.rmSync(fixture.outputRoot, { recursive: true, force: true });
}

const SESSION = (fixture: Fixture, predict: string[], proposals = 0) => ({
  executorAgent: 'gemini-cli',
  judgeAgent: 'gemini-cli',
  optimizerAgent: 'gemini-cli',
  workspace: fixture.workspace,
  skillPath: 'my-skill',
  maxAgents: 1,
  numTrials: 1,
  // These cases are about the working-tree proposal, so no optimizer is invoked.
  proposals,
  output: fixture.outputRoot,
  predict
});

test('a dirty implementation with no declared prediction stops the session before any trial runs', async (t) => {
  const fixture = makeFixture();
  dirtyTheTree(fixture);
  stubTrials(t, { candidate: { 'A holds': true, 'B holds': true }, incumbent: { 'A holds': true, 'B holds': false } });

  try {
    await assert.rejects(
      () => evolveCommand(SESSION(fixture, [])),
      (err: Error) => {
        assert.match(err.message, /needs to know what it should improve/);
        assert.match(err.message, /1#1\s+A holds/, 'the author has to be told which expectations exist');
        assert.match(err.message, /1#2\s+B holds/);
        return true;
      }
    );

    const runs = path.join(fixture.outputRoot, 'evolving-skill', 'runs');
    assert.ok(!fs.existsSync(runs), 'nothing may be measured before the prediction is declared');
    assert.strictEqual(git(fixture.workspace, ['rev-list', '--count', 'HEAD']).trim(), '1');
  } finally {
    cleanUp(fixture);
  }
});

test('a corroborated working-tree proposal is committed, scoped to the implementation', async (t) => {
  const fixture = makeFixture();
  dirtyTheTree(fixture);
  const variantsSeen = stubTrials(t, {
    candidate: { 'A holds': true, 'B holds': true },
    incumbent: { 'A holds': true, 'B holds': false }
  });

  try {
    await evolveCommand(SESSION(fixture, ['1#2']));

    assert.strictEqual(git(fixture.workspace, ['rev-list', '--count', 'HEAD']).trim(), '2', 'the proposal is committed');
    assert.deepStrictEqual(
      git(fixture.workspace, ['show', '--name-only', '--format=', 'HEAD']).trim().split('\n'),
      ['my-skill/SKILL.md'],
      'only the implementation reaches the commit'
    );
    assert.match(git(fixture.workspace, ['show', '--format=%B', '-s', 'HEAD']), /evolve\(evolving-skill\)/);
    assert.strictEqual(
      fs.readFileSync(path.join(fixture.skillPath, 'SKILL.md'), 'utf-8'),
      '# candidate implementation\n',
      'the working tree reflects the accepted version'
    );
    assert.match(
      git(fixture.workspace, ['status', '--porcelain']),
      /^ M README\.md$/m,
      "the author's work outside the skill is left alone"
    );

    const initialSha = git(fixture.workspace, ['rev-parse', 'HEAD~1']).trim();
    assert.ok(
      variantsSeen.includes(`ref:${initialSha}`),
      'an accepted session closes with a fresh comparison against the version it started on'
    );
  } finally {
    cleanUp(fixture);
  }
});

test('a proposal whose prediction did not hold is restored and never committed', async (t) => {
  const fixture = makeFixture();
  dirtyTheTree(fixture);
  // The aggregate improves on B, but the author declared the change would fix A.
  const variantsSeen = stubTrials(t, {
    candidate: { 'A holds': true, 'B holds': true },
    incumbent: { 'A holds': true, 'B holds': false }
  });

  try {
    await evolveCommand(SESSION(fixture, ['1#1']));

    assert.strictEqual(git(fixture.workspace, ['rev-list', '--count', 'HEAD']).trim(), '1', 'nothing is committed');
    assert.strictEqual(
      fs.readFileSync(path.join(fixture.skillPath, 'SKILL.md'), 'utf-8'),
      '# committed implementation\n',
      'the implementation goes back to the version in effect'
    );
    assert.match(
      git(fixture.workspace, ['status', '--porcelain']),
      /^ M README\.md$/m,
      "a rejection discards the candidate, not the author's other work"
    );
    assert.ok(
      !variantsSeen.some(v => /^ref:[0-9a-f]{7,}$/.test(v)),
      'with nothing accepted there is no end-to-end comparison to run'
    );

    const backup = path.join(fixture.outputRoot, 'evolving-skill', 'evolve');
    const sessions = fs.readdirSync(backup);
    assert.ok(
      fs.existsSync(path.join(backup, sessions[0], 'backup', 'author-worktree.patch')),
      'the discarded candidate stays recoverable'
    );
  } finally {
    cleanUp(fixture);
  }
});
