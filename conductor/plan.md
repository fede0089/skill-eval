# Plan: Revert Spinner to Single Line

## Objective
Revert the `Spinner` implementation in `src/utils/logger.ts` to use a single line. The multi-line approach with ANSI escape codes causes rendering issues depending on the terminal, making the "tail" look stuck on a single line instead of updating fluidly.

## Implementation Steps
1. Modify `src/utils/logger.ts`.
2. Update the `Spinner.render()` method to print everything on a single line: `\r\x1b[2K   ${frame} ${this.prefix}... ${logPart}`.
3. Update the `Spinner.stop()` method to only clear the current line and print the final message, removing the multi-line clearing logic (`\n\r\x1b[K\x1b[1A`).

## Verification
- Recompile the project (`npm run build`).
- Run `npm run test:functional` to ensure the spinner updates properly on a single line and no rendering artifacts remain.