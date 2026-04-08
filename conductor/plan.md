# Implementation Plan

## Phase 1: Environment Worktree Management
- [ ] Task: Add worktree management to EvalEnvironment
    - [ ] Create `tests/core/environment.test.ts` (or update existing) and write failing tests for `createWorktree` and `removeWorktree`.
    - [ ] Implement `createWorktree` and `removeWorktree` in `src/core/environment.ts`.
- [ ] Task: Conductor - User Manual Verification 'Phase 1: Environment Worktree Management' (Protocol in workflow.md)

## Phase 2: Runner Directory Support & JSON Resilience
- [ ] Task: Update AgentRunner interface
    - [ ] Write failing test for interface update (if applicable).
    - [ ] Update `runPrompt` to accept an execution directory `cwd`.
- [ ] Task: Enhance GeminiCliRunner resilience
    - [ ] Write failing tests for JSON extraction handling Invalid JSON, Non-zero Exit, and Empty Output.
    - [ ] Implement robust JSON extraction in `src/core/runners/gemini-cli.runner.ts`.
    - [ ] Implement `cwd` propagation to `spawnSync` in `GeminiCliRunner`.
- [ ] Task: Conductor - User Manual Verification 'Phase 2: Runner Directory Support & JSON Resilience' (Protocol in workflow.md)

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