# Implementation Plan: Strict Isolation in Baseline Pass

## Phase 1: Environment Isolation (Skill Disable)
- [x] Task: Update `EvalRunner` (e.g. `runFunctionalTask`) to execute `gemini skills disable <skill-name> --scope project` **inside the newly created worktree** before starting the Baseline trial. b8778b0
- [ ] Task: Conductor - User Manual Verification 'Phase 1: Environment Isolation' (Protocol in workflow.md)

## Phase 2: System Prompt Restriction
- [x] Task: Modify the baseline prompt construction in `src/core/eval-runner.ts` to inject the negative instruction: "IMPORTANT: For this task, you MUST NOT use the [Skill Name] tool, even if it appears available."
- [x] Task: Update unit tests for `EvalRunner` to verify the baseline prompt string includes the negative instruction.
- [ ] Task: Conductor - User Manual Verification 'Phase 2: System Prompt Restriction' (Protocol in workflow.md)

## Phase 3: Transcription Validation (Guardrail)
- [x] Task: Adapt the existing JSON log parsing logic (used in the `triggering` evaluation) to analyze the Baseline execution output in `EvalRunner`. Added `detectSkillAttempt` to `TriggerGrader`.
- [x] Task: Add symmetric validation checks in Baseline and Target passes: Baseline with skill activation → "Invalid Baseline"; Target without activation → "Invalid Target".
- [x] Task: Write unit tests (5 total: prompt check + 2 baseline + 2 target).
- [ ] Task: Conductor - User Manual Verification 'Phase 3: Transcription Validation' (Protocol in workflow.md)