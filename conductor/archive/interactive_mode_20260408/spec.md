# Specification: True Interactive Mode in skill-eval Commands

## Overview
Currently, the `skill-eval` tool invokes the `gemini` CLI in a fully headless mode (`--approval-mode auto_edit`) using a spinner. To allow users to interact with Gemini when skill activations require it, we will introduce a true `--interactive` flag. Additionally, the default headless behavior will be updated to use `--approval-mode yolo` instead of `auto_edit`.

## Functional Requirements
- **Command Update**: Add a boolean flag `--interactive` (alias `-i`) to the `trigger` and `functional` commands in `src/index.ts`.
- **Default Headless Mode**: When `--interactive` is NOT passed:
  - Run Gemini with `--approval-mode yolo`.
  - The CLI spinner remains active.
- **Interactive Mode**: When `--interactive` is passed:
  - Pass `--prompt-interactive` to the Gemini process.
  - Omit `--approval-mode yolo` (to allow normal Gemini prompt interactions).
  - Configure the Gemini process `stdio` to inherit `stdin` and `stderr` so the user can see prompts and type responses. `stdout` must still be piped to capture the JSON result.
  - Disable the UI spinner in `skill-eval` to prevent terminal UI conflicts during user interaction.

## Non-Functional Requirements
- Ensure the `runPrompt` interface and Runner factory accurately pass the `interactive` configuration.
- Gracefully handle process timeouts in interactive mode, but consider extending or disabling the hardcoded 5-minute timeout if the user is expected to interact.

## Acceptance Criteria
1. Running `skill-eval trigger --skill <path>` (default) runs with `--approval-mode yolo` and shows the spinner.
2. Running `skill-eval trigger --skill <path> --interactive` runs with `--prompt-interactive`, hides the spinner, allows user input, and captures the JSON output.
3. Same behavior applies to `skill-eval functional`.

## Out of Scope
- Modifying how the Gemini CLI handles its own internal interactive sessions; we are merely configuring the OS pipes to bridge the interaction.