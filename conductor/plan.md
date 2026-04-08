# Implementation Plan

## Phase 1: Environment Worktree Management [checkpoint: 025cd8e]
- [x] Task: Add worktree management to EvalEnvironment (59d130f)
    - [x] Create `tests/core/environment.test.ts` (or update existing) and write failing tests for `createWorktree` and `removeWorktree`.
    - [x] Implement `createWorktree` and `removeWorktree` in `src/core/environment.ts`.
- [x] Task: Conductor - User Manual Verification 'Phase 1: Environment Worktree Management' (025cd8e)

## Phase 2: Runner Directory Support & JSON Resilience [checkpoint: d4034ed]
- [x] Task: Update AgentRunner interface (4cff669)
    - [x] Write failing test for interface update (if applicable).
    - [x] Update `runPrompt` to accept an execution directory `cwd`.
- [x] Task: Enhance GeminiCliRunner resilience (d15a572)
    - [x] Write failing tests for JSON extraction handling Invalid JSON, Non-zero Exit, and Empty Output.
    - [x] Implement robust JSON extraction in `src/core/runners/gemini-cli.runner.ts`.
    - [x] Implement `cwd` propagation to `spawnSync` in `GeminiCliRunner`.
- [x] Task: Conductor - User Manual Verification 'Phase 2: Runner Directory Support & JSON Resilience' (d4034ed)

## Phase 3: Evaluator Loop & Functional Judge Enrichment
- [ ] Task: Update Trigger Command Loop
    - [ ] Write failing tests for sequential worktree creation/removal inside `src/commands/trigger.ts`.
    - [ ] Implement the `trigger.ts` evaluation loop with worktree logic.
- [ ] Task: Update Functional Command Loop
    - [ ] Write failing tests for sequential worktree creation/removal inside `src/commands/functional.ts`.
    - [ ] Implement the `functional.ts` evaluation loop with worktree logic.
- [ ] Task: Enhance Functional Judge Context
    - [ ] Write failing tests to verify `git diff HEAD` is captured inside the worktree in `functional.ts`.
    - [ ] Implement running `git diff HEAD` and `git ls-files --others --exclude-standard` specifically inside the worktree's `cwd`.
    - [ ] Inject the enriched git diff output as `context` into `evaluator.evaluateFunctional`.
- [ ] Task: Handle Strict Functional Expectations
    - [ ] Write failing tests to ensure empty expectations skip functional evaluation.
    - [ ] Implement logic in `functional.ts` to log missing expectations without artificially boosting the pass rate.
- [ ] Task: Conductor - User Manual Verification 'Phase 3: Evaluator Loop & Functional Judge Enrichment' (Protocol in workflow.md)