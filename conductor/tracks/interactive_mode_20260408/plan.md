# Implementation Plan: True Interactive Mode in skill-eval Commands

## Phase 1: Update Agent Runner Interface and Implementation
- [ ] Task: Update AgentRunner interface and GeminiCliRunner for interactive mode
    - [ ] Write failing test for `GeminiCliRunner` to ensure `--approval-mode yolo` is the new default instead of `auto_edit`.
    - [ ] Write failing test for `GeminiCliRunner` when `interactive: true` (expects `--prompt-interactive`, no `yolo`, and `stdio: ['inherit', 'pipe', 'inherit']`).
    - [ ] Update `AgentRunner` interface in `src/core/runners/runner.interface.ts` to accept an optional `interactive` boolean (e.g., via an options object or direct parameter).
    - [ ] Implement changes in `GeminiCliRunner` (`src/core/runners/gemini-cli.runner.ts`) to make tests pass.
- [ ] Task: Conductor - User Manual Verification 'Phase 1: Update Agent Runner Interface and Implementation' (Protocol in workflow.md)

## Phase 2: Update CLI Commands
- [ ] Task: Add `--interactive` flag to CLI commands
    - [ ] Write failing tests for `triggerCommand` and `functionalCommand` to handle the new flag.
    - [ ] Update `src/index.ts` to add `--interactive` (alias `-i`) to `trigger` and `functional` commands.
    - [ ] Update `src/commands/trigger.ts` to accept the `interactive` parameter, conditionally disable the UI `Spinner` to avoid overlapping terminal output, and pass the configuration to the runner.
    - [ ] Update `src/commands/functional.ts` to accept the `interactive` parameter, conditionally disable the UI `Spinner`, and pass the configuration to the runner.
- [ ] Task: Conductor - User Manual Verification 'Phase 2: Update CLI Commands' (Protocol in workflow.md)