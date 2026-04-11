# Implementation Plan: Strict Isolation in Baseline Pass

## Phase 1: Environment Isolation (Skill Disable)
- [x] Task: Update `EvalRunner` (e.g. `runFunctionalTask`) to execute `gemini skills disable <skill-name> --scope project` **inside the newly created worktree** before starting the Baseline trial. b8778b0
- [ ] Task: Conductor - User Manual Verification 'Phase 1: Environment Isolation' (Protocol in workflow.md)

## Phase 2: System Prompt Restriction
- [ ] Task: Modify the baseline prompt construction in `src/core/eval-runner.ts` to inject the negative instruction: "IMPORTANT: For this task, you MUST NOT use the [Skill Name] tool, even if it appears available."
- [ ] Task: Update unit tests for `EvalRunner` to verify the baseline prompt string includes the negative instruction.
- [ ] Task: Conductor - User Manual Verification 'Phase 2: System Prompt Restriction' (Protocol in workflow.md)

## Phase 3: Transcription Validation (Guardrail)
- [ ] Task: Adapt the existing JSON log parsing logic (used in the `triggering` evaluation) to analyze the Baseline execution output in `EvalRunner`.
- [ ] Task: Add a validation check in the Baseline trial evaluation to scan for any invoked tool calls matching the restricted skill name. If found, mark the baseline trial as failed with an "Invalid Baseline" reason.
- [ ] Task: Write unit tests to ensure that a parsed log with the restricted tool call correctly invalidates the baseline trial, and a clean log passes normally.
- [ ] Task: Conductor - User Manual Verification 'Phase 3: Transcription Validation' (Protocol in workflow.md)