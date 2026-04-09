# Implementation Plan: Revert Interactive Mode & Restore Auto Edit

## Objective
Revert the "interactive mode" additions from the CLI, specifically removing the `--interactive` flag, restoring the UI spinner everywhere, and reverting the `GeminiCliRunner` to its previous default behavior of using `--approval-mode auto_edit` instead of `yolo` or prompting. The goal is to enforce the automated run by default, resolving policy issues with auto-edit.

## Key Files & Context
- `src/core/runners/runner.interface.ts`: Revert `AgentRunner` interface to remove the `interactive` option.
- `src/core/runners/gemini-cli.runner.ts`: Revert default arguments to include `--approval-mode auto_edit`. Remove any `--prompt-interactive` or `yolo` logic.
- `src/index.ts`: Remove the `-i, --interactive` flag definition from `trigger` and `functional` commands.
- `src/commands/trigger.ts`: Remove the interactive parameter handling and unconditionally use the UI Spinner.
- `src/commands/functional.ts`: Remove the interactive parameter handling and unconditionally use the UI Spinner.
- Associated test files:
  - `tests/core/runners/gemini-cli.runner.test.ts`
  - `tests/commands/trigger.test.ts`
  - `tests/commands/functional.test.ts`

## Implementation Steps
1. **Runner Interfaces & Core:**
   - In `src/core/runners/runner.interface.ts`, remove the `interactive?: boolean;` property from the `AgentRunnerOptions` (or equivalent interface).
   - In `src/core/runners/gemini-cli.runner.ts`, update the `run` method to stop accepting or passing the interactive mode configuration. Change the default execution arguments back to appending `--approval-mode auto_edit`. Adjust the `stdio` back to its previous default (likely `'pipe'` for all streams instead of inheriting stdin).

2. **CLI Entrypoint & Commands:**
   - In `src/index.ts`, remove `.option('-i, --interactive', 'Run in interactive mode')` from both `.command('trigger')` and `.command('functional')`.
   - In `src/commands/trigger.ts`, remove the check for `options.interactive`. Ensure that the `ora` spinner is always started and stopped appropriately around the runner execution.
   - In `src/commands/functional.ts`, remove the check for `options.interactive`. Unconditionally initialize and use the `ora` spinner.

3. **Update Tests:**
   - In `tests/core/runners/gemini-cli.runner.test.ts`, update assertions to expect `--approval-mode auto_edit` instead of `yolo`. Remove any tests explicitly testing the `interactive: true` behavior.
   - In `tests/commands/trigger.test.ts` and `tests/commands/functional.test.ts`, remove tests checking the spinner behavior when interactive mode is true. Ensure assertions check that the spinner is called properly in the default (now only) flow.

## Verification & Testing
- Run `npm run build` to ensure the project compiles successfully after interface changes.
- Run `npm run test:unit` to verify that all unit tests pass, validating the newly adjusted assertions for the runner and commands.
- Manually run `node dist/index.js trigger --skill ./mock-skill` to confirm it runs in `auto_edit` mode without prompting, and that the UI spinner is visible.