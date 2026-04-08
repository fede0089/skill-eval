# Specification: Worktree-Based Evaluator & Runner Robustness

## Overview
The current evaluations suffer from silent failures (JSON parse errors logged as "Not Triggered") and a lack of workspace isolation, where mutations from one evaluation leak into the next. The functional Judge is also blind to actual file diffs, seeing only `git status --porcelain`. Leveraging `git worktree` and refining JSON output handling will ensure robust, deterministic, and isolated evaluations.

## Functional Requirements
1. **Workspace Isolation via Git Worktrees:** For each evaluation, a temporary `git worktree` must be created in a `.project-skill-evals/worktrees/eval-<id>` folder.
2. **Runner Execution:** The agent runner will execute `gemini` strictly inside the respective worktree directory.
3. **Runner Resilience:** The runner's JSON extractor will handle CLI crash logs gracefully. It must be explicitly tested against Invalid JSON, Non-zero Exit codes, and Empty Output. If `gemini` fails to yield valid JSON, an explicit error is saved to the result payload rather than defaulting to "Not Triggered".
4. **Functional Diff Context:** In `functional.ts`, after the agent completes, `git diff HEAD` (and checking for untracked files) must be run *within the worktree* and this complete text must be passed to the `FunctionalEvaluator` judge prompt.
5. **Strict Functional Expectations:** Evaluations missing `expectations` will skip the functional evaluation but still count the trigger success, avoiding false positive functional passes.
6. **Cleanup:** After processing the worktree and judge results, the temporary worktree must be removed (`git worktree remove --force`).

## Non-Functional Requirements
- **Performance:** Sequential worktrees should be used to keep memory and CPU usage low and logs readable.
- **Isolation:** Tests must not pollute each other's state or the main repository state.

## Acceptance Criteria
- [ ] Mock tests with `npm run build && node dist/index.js functional --skill ./mock-skill` ensure no changes bleed into the main workspace.
- [ ] Validates that the Judge receives the actual git diff payload.
- [ ] Runner correctly surfaces an error rather than "Not Triggered" on invalid JSON, non-zero exits, or empty outputs.
- [ ] Evals without expectations are recorded without artificially boosting the functional pass rate.

## Out of Scope
- Parallel execution of worktrees.
- Support for other AI agents beyond the current scope.
