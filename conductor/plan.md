# Implementation Plan: Extensible Agent Parameter

## Objective
Make the `skill-eval trigger` command extensible by allowing an optional `[agent]` parameter. This paves the way for supporting multiple agents while defaulting to `gemini-cli`.

## Key Files & Context
- `src/index.ts`: The main CLI entrypoint defining the `trigger` command using Commander.js.
- `src/commands/trigger.ts`: Contains the business logic for the `trigger` command.
- `src/core/runner.ts`: The runner executing the evaluation via a subprocess.

## Implementation Steps

1. **Update `src/index.ts`**
   - Modify the `trigger` command definition to accept an optional `[agent]` parameter before the required option.
   - Extract the `agent` parameter in the action handler (defaulting to `'gemini-cli'` if omitted).
   - Pass the resolved `agent` to `triggerCommand(agent, options.skill)`.

2. **Update `src/commands/trigger.ts`**
   - Update `triggerCommand`'s signature to `export async function triggerCommand(agent: string, skillPath: string): Promise<void>`.
   - Update the instantiation of the `HeadlessRunner` to include the `agent`: `new HeadlessRunner(agent)`.
   - Add a console log indicating which agent is being used for the current evaluation run.

3. **Update `src/core/runner.ts`**
   - Modify the `HeadlessRunner` class constructor to accept `agent: string`.
   - Inside the `runPrompt` method, add a check against `this.agent`.
   - If `this.agent` is `'gemini-cli'`, execute the existing subprocess logic.
   - Otherwise, print an error (`[Runner] Agent '${this.agent}' is not supported yet.`) and return `null`.

## Verification & Testing
1. Ensure the TypeScript compiler builds the project cleanly via `npm run build`.
2. Ensure `npm test` still passes.
3. Test locally with the mock skill using three configurations:
   - `node dist/index.js trigger --skill ./mock-skill` (Uses default: gemini-cli)
   - `node dist/index.js trigger gemini-cli --skill ./mock-skill` (Explicitly uses gemini-cli)
   - `node dist/index.js trigger unknown-agent --skill ./mock-skill` (Fails gracefully indicating unsupported agent)