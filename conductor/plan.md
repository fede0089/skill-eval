# Implementation Plan: Extensible Runner using Strategy Pattern

## Objective
Refactor the current `HeadlessRunner` implementation to use a Strategy and Factory pattern. This makes the code robust, adheres to the Open/Closed Principle, and easily extensible to other agents without modifying existing classes.

## Key Files & Context
- `src/types/index.ts`: Rename agent-specific types (`GeminiOutput`) to agent-agnostic types (`AgentOutput`).
- `src/core/runners/runner.interface.ts`: The common interface for all agent runners.
- `src/core/runners/gemini-cli.runner.ts`: The concrete implementation for `gemini-cli`.
- `src/core/runners/factory.ts`: The factory responsible for instantiating the correct runner.
- `src/core/evaluator.ts`: Update type references.
- `src/commands/trigger.ts`: Integrate the `RunnerFactory`.
- `src/core/runner.ts`: To be deleted.

## Implementation Steps

1. **Update `src/types/index.ts`**
   - Rename `GeminiOutput` to `AgentOutput`.
   - Rename `GeminiOutputTools` to `AgentOutputTools`.

2. **Create Strategy Interface: `src/core/runners/runner.interface.ts`**
   - Define `AgentRunner` interface with a `runPrompt(prompt: string): AgentOutput | null` method.

3. **Create Concrete Strategy: `src/core/runners/gemini-cli.runner.ts`**
   - Move the existing logic from `HeadlessRunner` into `GeminiCliRunner implements AgentRunner`.

4. **Create Factory: `src/core/runners/factory.ts`**
   - Implement `RunnerFactory.create(agent: string): AgentRunner`.
   - Return a new `GeminiCliRunner` for `'gemini-cli'`.
   - Throw an `Error` for unsupported agents.

5. **Update `src/core/evaluator.ts`**
   - Update imports and signatures to use `AgentOutput`.

6. **Update `src/commands/trigger.ts`**
   - Replace the instantiation of `HeadlessRunner` with `RunnerFactory.create(agent)`.
   - Wrap the instantiation in a try-catch to cleanly handle the `Error` for unsupported agents and exit cleanly.

7. **Cleanup**
   - Delete `src/core/runner.ts`.

## Verification & Testing
1. Run `npm run build` to ensure the project compiles.
2. Run `npm test` to verify default behavior.
3. Test locally using:
   - `node dist/index.js trigger --skill ./mock-skill` (Default gemini-cli)
   - `node dist/index.js trigger other-agent --skill ./mock-skill` (Should fail cleanly with the Factory error)