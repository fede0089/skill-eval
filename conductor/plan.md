# Plan: Change Evaluator Output to Plain Text and Save Logs

## Objective
Modify the `gemini-cli.runner.ts` to use plain text output instead of structured JSON. The raw execution logs (stdout and stderr) from Gemini CLI should be saved to a temporary log file inside the run's artifacts folder. The evaluator logic must be updated to determine skill triggering based on the plain text log rather than the JSON stats object.

## Key Files & Context
- `src/core/runners/runner.interface.ts`: Interface defining the `runPrompt` method.
- `src/core/runners/gemini-cli.runner.ts`: The actual implementation of the Gemini CLI runner.
- `src/core/evaluator.ts`: Logic to evaluate if a skill was triggered.
- `src/commands/trigger.ts`: Command execution loop.
- `src/commands/functional.ts`: Functional evaluation command execution loop.

## Implementation Steps

### 1. Update Runner Interface
Modify `src/core/runners/runner.interface.ts` to accept a new optional parameter `logPath` in `runPrompt`.
```typescript
runPrompt(
  prompt: string,
  cwd?: string,
  onLog?: (log: string) => void,
  logPath?: string
): Promise<AgentOutput | null>;
```

### 2. Modify GeminiCliRunner
In `src/core/runners/gemini-cli.runner.ts`:
- Remove `-o`, `json` from the `args` array.
- Open a write stream to `logPath` (if provided) and write both `stdout` and `stderr` chunks to it as they arrive.
- Remove the JSON parsing block (`JSON.parse`).
- Return an `AgentOutput` object containing the full text in `raw_output` and `response`.

### 3. Adjust Evaluator Logic
In `src/core/evaluator.ts`:
- Modify `isSkillTriggered(output: AgentOutput): boolean` to parse the plain text.
- Since we no longer have `stats.tools.byName`, the method should search `output.raw_output` (or `output.response`) for textual indicators that the skill was used. For example, looking for `activate_skill`, `generalist`, or the `targetToolKeys`.
- Use regex or substring matching to detect if these tools were called.

### 4. Update Commands (trigger & functional)
In `src/commands/trigger.ts` and `src/commands/functional.ts`:
- Generate a `logFileName` (e.g., `eval_${i}_${evalSpec.id || 'unnamed'}_gemini.log`).
- Pass the full path to `logPath` when calling `runner.runPrompt()`.
- Ensure the result JSON still saves the `rawOutput` correctly.

## Verification & Testing
1. Compile the code: `npm run build`.
2. Run automated tests: `npm test` and update any broken unit tests (e.g., `gemini-cli.runner.test.ts`, `evaluator.test.ts`).
3. Manually run `node dist/index.js trigger --skill ./mock-skill` and verify that the log file is created in `.project-skill-evals/runs/<timestamp>/` and contains the plain text execution output.
4. Verify the `trigger` and `functional` evaluation logic correctly parses the plain text to detect tool usage.
