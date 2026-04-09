# Implementation Plan: Asynchronous Agent Runner with Interactive Spinner & Real-time Logs

## Objective
Convert the current synchronous agent execution model to an asynchronous approach to prevent blocking the Node.js main thread. This will enable the display of an interactive terminal spinner with real-time process logs (from `stderr`) and implement a safety timeout to prevent infinite hangs.

## Scope & Impact
- **Affected files:**
  - `src/core/runners/runner.interface.ts`: Update `runPrompt` signature to return a `Promise`.
  - `src/core/runners/gemini-cli.runner.ts`: Replace `spawnSync` with `spawn` and return a Promise. Implement safety timeout and capture real-time stderr logs.
  - `src/commands/trigger.ts`: Update the `runPrompt` call to `await`. Implement a visual terminal spinner that clears on completion or updates with real-time logs.
  - `src/commands/functional.ts`: Update the `runPrompt` call to `await`. Implement the same visual terminal spinner as `trigger.ts`.
  - `src/utils/logger.ts`: Enhance the logger or provide a utility to print the spinner on the same line to keep the terminal clean.

## Proposed Solution

1. **`AgentRunner` Interface:** Update `runPrompt(prompt: string, cwd?: string)` to return `Promise<AgentOutput | null>`.
2. **`GeminiCliRunner` implementation:**
    - Use `child_process.spawn` instead of `spawnSync`.
    - Setup a timeout timer (e.g., 5 minutes = 300000 ms) using `setTimeout`. If the timeout is reached, call `child.kill()` and resolve with an error output `Timeout exceeded`.
    - Listen to `child.stdout.on('data')` to build the full standard output string.
    - Listen to `child.stderr.on('data')` to emit/log real-time lines to the console (which the spinner will display).
    - To relay the `stderr` logs to the command module, we can pass a callback function to `runPrompt` (e.g. `onLog?: (log: string) => void`) or emit events. A simple callback parameter is more direct.
3. **`Logger` / Spinner Implementation:**
    - Create a simple terminal spinner animation using frames like `['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']` or similar.
    - Use `process.stdout.write` and carriage return `\r` (along with ANSI clear line escape sequences like `\x1b[2K`) to redraw the spinner and the latest log message on the same line without overflowing the terminal.
4. **Command Files (`trigger.ts` and `functional.ts`):**
    - Set up the spinner before calling `runner.runPrompt()`.
    - Provide the `onLog` callback to receive log updates and redraw the spinner with the log text.
    - Await `runner.runPrompt()`.
    - Stop the spinner and print `Done.` or the final result.

## Verification
- Run `npm run test:trigger` and verify that the spinner spins, and logs from Gemini CLI appear in real-time.
- Run `npm run test:functional` to ensure the same behavior.
- Ensure the process does not hang indefinitely.

## Rollback
- Revert the files to their original states if the asynchronous approach causes integration issues.
