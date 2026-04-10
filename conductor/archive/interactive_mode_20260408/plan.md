# Implementation Plan: True Interactive Mode in skill-eval Commands

## Phase 1: Update Agent Runner Interface and Implementation [checkpoint: 69c8814]
- [x] Task: Update AgentRunner interface and GeminiCliRunner for interactive mode (7d31a31)
    - [x] Write failing test for `GeminiCliRunner` to ensure `--approval-mode yolo` is the new default instead of `auto_edit`.
    - [x] Write failing test for `GeminiCliRunner` when `interactive: true` (expects `--prompt-interactive`, no `yolo`, and `stdio: ['inherit', 'pipe', 'inherit']`).
    - [x] Update `AgentRunner` interface in `src/core/runners/runner.interface.ts` to accept an optional `interactive` boolean (e.g., via an options object or direct parameter).
    - [x] Implement changes in `GeminiCliRunner` (`src/core/runners/gemini-cli.runner.ts`) to make tests pass.
- [x] Task: Conductor - User Manual Verification 'Phase 1: Update Agent Runner Interface and Implementation' (Protocol in workflow.md) (69c8814)

## Phase 2: Update CLI Commands
- [x] Task: Add `--interactive` flag to CLI commands (be00473)
    - [x] Write failing tests for `triggerCommand` and `functionalCommand` to handle the new flag.
    - [x] Update `src/index.ts` to add `--interactive` (alias `-i`) to `trigger` and `functional` commands.
    - [x] Update `src/commands/trigger.ts` to accept the `interactive` parameter, conditionally disable the UI `Spinner` to avoid overlapping terminal output, and pass the configuration to the runner.
    - [x] Update `src/commands/functional.ts` to accept the `interactive` parameter, conditionally disable the UI `Spinner`, and pass the configuration to the runner.
- [ ] Task: Conductor - User Manual Verification 'Phase 2: Update CLI Commands' (Protocol in workflow.md)