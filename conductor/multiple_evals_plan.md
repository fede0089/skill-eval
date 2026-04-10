# Plan: Support Multiple Eval Files (Anthropic Standard)

## Objective
Adapt the `skill-eval` CLI to support reading and merging multiple `.json` evaluation files from a skill's `evals/` directory. This aligns with Anthropic's recommendation to separate evaluations (e.g., capabilities vs. regressions) while running them as a unified test suite using the "Simple Merge" approach.

## Key Files & Context
- `src/utils/eval-loader.ts` (New file: utility to load and merge evals)
- `src/commands/trigger.ts` (Update to use the loader)
- `src/commands/functional.ts` (Update to use the loader)
- `tests/utils/eval-loader.test.ts` (New file: tests for the loader)

## Implementation Steps

### 1. Create `EvalLoader` Utility (`src/utils/eval-loader.ts`)
Implement a function `loadEvals(skillPath: string): EvalFile`:
- Resolve the `evals` directory inside the provided `skillPath`.
- Check if the directory exists. Throw a `ConfigError` if it doesn't.
- Read all files in the directory and filter for those ending in `.json`. Throw a `ConfigError` if no JSON files are found.
- Iterate through each JSON file:
  - Parse the file content. Catch parsing errors and throw a `ConfigError` indicating which file failed.
  - Validate that the parsed object contains a `skill_name` string and an `evals` array.
  - Keep track of the `skill_name` from the first valid file. If any subsequent file has a different `skill_name`, throw a `ConfigError` to prevent mixing evaluations from different skills.
  - Append the items in the `evals` array to a master array.
- Return a single `EvalFile` object containing the unified `skill_name` and the merged `evals` array.

### 2. Refactor CLI Commands
Update `src/commands/trigger.ts` and `src/commands/functional.ts`:
- Remove the existing logic that hardcodes reading `evals/evals.json`.
- Import `loadEvals` from `../utils/eval-loader`.
- Call `loadEvals(skillPath)` to obtain the merged `evalsConfig`.
- The rest of the execution logic remains unchanged, as it will simply iterate over the merged `evals` array.

### 3. Verification & Testing
1. **Unit Tests (`tests/utils/eval-loader.test.ts`):** 
   - Test successful merging of multiple valid JSON files.
   - Test error handling for: missing directory, no JSON files, invalid JSON syntax, missing required fields (`skill_name`, `evals`), and mismatched `skill_name` across files.
2. **Integration Testing:** 
   - Ensure the `mock-skill/evals/` directory has multiple JSON files (e.g., `evals.json` and `evals2.json`).
   - Run `npm run test:trigger mock-skill` and `npm run test:functional mock-skill` to verify that evaluations from all files are executed and reported correctly.