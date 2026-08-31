import { test, mock } from 'node:test';
import { execFileSync } from 'node:child_process';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EvalRunner } from '../../src/core/eval-runner.js';
import { EvalEnvironment } from '../../src/core/environment.js';
import { RunnerFactory } from '../../src/runners/index.js';
import { git } from '../../src/utils/git.js';

// Drives real git against real repositories, so it lives apart from the mock-heavy
// EvalRunner unit tests: node:test gives each file its own process and no mock bleed.

test('EvalRunner runs a historical variant against the workspace repository, linking the skill from the extracted copy', async (t) => {
  // A real repository with a skill inside it, plus an artifacts root outside both.
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-histrepo-'));
  const artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-artifacts-'));
  const skillDirName = 'mock-skill';

  const gitOptions = { cwd: workspace, stdio: 'ignore' as const };
  execFileSync('git', ['init', '-q'], gitOptions);
  fs.mkdirSync(path.join(workspace, skillDirName, 'evals'), { recursive: true });
  fs.writeFileSync(path.join(workspace, skillDirName, 'SKILL.md'), '# skill\n', 'utf-8');
  execFileSync('git', ['add', '-A'], gitOptions);
  execFileSync('git', [
    '-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-qm', 'init'
  ], gitOptions);

  const refDir = path.join(artifactsDir, 'skill-refs', 'HEAD');
  git.extractSkillRef(path.join(workspace, skillDirName), 'HEAD', refDir);

  const extractedSkillPath = path.join(refDir, skillDirName);
  assert.ok(fs.existsSync(extractedSkillPath), 'Fixture: the ref should have been extracted');
  assert.ok(
    !fs.existsSync(path.join(refDir, '.git')),
    'Fixture: git archive produces no .git — this is why the extracted copy cannot host a worktree'
  );

  // The old wiring passed the extracted copy as the workspace. Now that the copy
  // lives outside the repository, git has nothing to walk up to and worktree
  // creation fails — the failure this variant's wiring exists to avoid.
  const brokenEnv = new EvalEnvironment({ workspace: refDir, artifactsDir });
  assert.throws(
    () => brokenEnv.createWorktree('task-1-ref-HEAD-trial-1'),
    /Failed to create git worktree/,
    'A worktree cannot be cut from an extracted copy that is not a repository'
  );

  const linkSkillMock = mock.fn(async () => {});
  t.mock.method(RunnerFactory, 'create', () => ({
    skillDispatchToolName: 'activate_skill',
    runPrompt: mock.fn(async () => ({ response: 'ok', raw_output: '' })),
    linkSkill: linkSkillMock,
    applyRunnerConfig: mock.fn(() => {}),
  }));

  // The wiring the commands use for a historical variant: the real repository as
  // the workspace, the skill addressed absolutely inside the extracted copy.
  const runner = new EvalRunner({
    agent: 'gemini-cli',
    workspace,
    skillPath: extractedSkillPath,
    skillName: 'mock-skill',
    runDir: artifactsDir,
    artifactsDir,
    isBaseline: false,
    variant: 'ref:HEAD'
  });

  try {
    await runner.runTriggerTask({ id: 1, prompt: 'test' }, 0, 1, { updateLog: () => {} } as any, 0);

    assert.strictEqual(linkSkillMock.mock.callCount(), 1, 'The trial should have linked a skill');
    assert.strictEqual(
      linkSkillMock.mock.calls[0].arguments[0],
      extractedSkillPath,
      'The variant must contribute the extracted implementation, not the working-tree one'
    );

    const worktreePath = linkSkillMock.mock.calls[0].arguments[1] as string;
    assert.ok(
      worktreePath.startsWith(path.join(artifactsDir, 'worktrees') + path.sep),
      'The worktree must live under the artifacts root'
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(artifactsDir, { recursive: true, force: true });
  }
});
