# Plan: Fix Skill Linking Isolation and Remove 'generalist'

## Objective
1. **Fix Skill Linking:** The current global skill linking mechanism using `gemini skills link` is prone to silent failures, pollutes the user's global environment, and is missing entirely from the trigger evaluation command. We need to implement isolated, per-worktree skill linking using direct filesystem symlinks.
2. **Remove 'generalist':** Remove references to `generalist` as a valid dispatch tool for skill triggering. The `generalist` agent does not specifically trigger skills, so counting it as a trigger event is inaccurate.

## Key Files & Context
- `src/core/environment.ts`: Manages the environment and git worktrees. Will handle isolated symlinking.
- `src/commands/trigger.ts`: Runs the trigger tests. Currently missing skill linking.
- `src/commands/functional.ts`: Runs functional tests. Currently uses global linking/unlinking.
- `src/core/evaluator.ts`: Contains the logic to determine if a skill triggered.
- `README.md`: Documentation mentioning `generalist`.

## Implementation Steps

### 1. Update `src/core/environment.ts`
- Modify `linkSkill(worktreePath: string)` to accept the worktree path.
- Inside `linkSkill`, use `fs.mkdirSync` to create `${worktreePath}/.agents/skills` recursively.
- Use `fs.symlinkSync` to create a symlink from `this.absoluteSkillPath` to `${worktreePath}/.agents/skills/${path.basename(this.absoluteSkillPath)}`. Remove the `spawnSync('gemini', ...)` call.
- Remove or empty the `unlinkSkill()` method, as worktree deletion natively handles the cleanup of the symlink.

### 2. Update `src/commands/trigger.ts`
- In the evaluation loop, immediately after creating the worktree (`worktreePath = env.createWorktree(...)`), call `await env.linkSkill(worktreePath);` so the agent can discover the skill.

### 3. Update `src/commands/functional.ts`
- Remove the global `await env.unlinkSkill();` call before the Baseline pass.
- Remove the global `await env.linkSkill();` call before the Functional pass.
- In `runSingleEval`, right after creating the worktree (`worktreePath = env.createWorktree(...)`), add a condition: `if (!isBaseline) { await env.linkSkill(worktreePath); }`.

### 4. Update `src/core/evaluator.ts`
- In `isSkillTriggered` (structured stats block), change `const dispatchTools = ['activate_skill', 'generalist'];` to `const dispatchTools = ['activate_skill'];`.
- In `isSkillTriggered` (plain text parsing block), change `const dispatchTools = ['activate_skill', 'generalist'];` to `const dispatchTools = ['activate_skill'];`.
- Update the comment `// e.g. "Calling tool: activate_skill", "Tool: generalist", etc.` to remove `"Tool: generalist"`.

### 5. Update `README.md`
- Locate the line: `> - **Minimum requirement:** Permissions to use the skill dispatch tool (e.g., \`activate_skill\` or \`generalist\` for Gemini CLI).`
- Change it to: `> - **Minimum requirement:** Permissions to use the skill dispatch tool (e.g., \`activate_skill\` for Gemini CLI).`

## Verification
- Run `npm run build` to compile TypeScript.
- Run `npm run test:unit` to ensure no unit tests are broken.
- Run `npm run test:trigger` to verify the trigger logic works and the skill is successfully discovered in the isolated worktree.
- Run `npm run test:functional` to verify the baseline pass fails correctly (skill not present) and the functional pass succeeds entirely.
