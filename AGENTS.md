# AGENTS.md

## Build and test commands
- `npm install` - Install all dependencies.
- `npm run build` - Build the project using `tsc`.
- `npm start` - Run CLI directly without building.
- `npm run test:unit` - Run the unit test suite using tsx.
- `npm run test:trigger` - Run skill triggering evaluation with the mock skill.
- `npm run test:functional` - Run functional evaluation with the mock skill.

## Project overview
- A Node.js CLI tool built to evaluate Agent Skills locally using the Gemini CLI, measuring both triggering reliability and functional correctness through an LLM judge.
- Both `trigger` and `functional` commands require `--workspace <path>` and `--skill <path>`, and accept `--trials <number>` (default: 3) and `--concurrency <number>` (default: 5).
- Entrypoints for understanding the system:
  - `src/index.ts` - Main CLI entrypoint; defines `trigger` and `functional` commands.
  - `src/commands/trigger.ts` - Skill triggering evaluation logic.
  - `src/commands/functional.ts` - Functional evaluation and expectations logic.
  - `src/core/evaluator.ts` - Core evaluation logic including functional judge prompts; `ModelBasedGrader` accepts an injected `AgentRunner`.
  - `src/core/eval-runner.ts` - Orchestrates trial runs, parses NDJSON stream output, coordinates grading.
  - `src/core/environment.ts` - Manages git worktree isolation and skill symlinks per evaluation.
  - `src/core/statistics.ts` - Implements `computePassAtK` and `aggregatePassAtK` metric computation.
  - `src/core/trial-utils.ts` - Shared helper: `padAbortedTrials` fills trial arrays to a consistent denominator.
  - `src/core/preflight.ts` - Pre-flight validation of agent binary and skill directory structure.
  - `src/core/errors.ts` - Custom error types (AppError, ConfigError, ExecutionError, ValidationError).
  - `src/runners/registry.ts` - **Single registration point** for agent runners; add new runners here.
  - `src/runners/gemini-cli/runner.ts` - Gemini CLI runner implementation.
  - `src/reporters/index.ts` - Reporter factory; add new report formats here.
  - `src/utils/table-renderer.ts` - Shared `renderTriggerTable` / `renderFunctionalTable` used by both commands.
  - `src/utils/` - Shared utilities: eval-loader, exec, ndjson, ui, logger.
  - `src/types/index.ts` - Shared TypeScript types including the `NdjsonEvent` discriminated union.
  - `mock-skill/SKILL.md` - Example skill structure for testing.

### Repository layout
```
.
├── .project-skill-evals/  # evaluation run results
├── conductor/             # project management metadata (tracks, backlog, docs)
├── mock-skill/            # mock skill for evaluation tests
├── src/                   # source code
│   ├── commands/          # CLI command definitions (trigger, functional)
│   ├── runners/           # ← ADD NEW AGENT RUNNERS HERE (one folder per runner)
│   │   ├── registry.ts    # single registration point: runner class + binary name
│   │   ├── runner.interface.ts  # AgentRunner interface
│   │   ├── gemini-cli/    # Gemini CLI runner implementation
│   │   └── index.ts       # public re-exports
│   ├── reporters/         # ← ADD NEW REPORT FORMATS HERE
│   │   ├── reporter.ts    # Reporter interface
│   │   ├── html-reporter.ts
│   │   ├── json-reporter.ts
│   │   └── index.ts       # createReporter() factory + re-exports
│   ├── core/              # core evaluation logic
│   │   ├── evaluator.ts   # LLM judge prompts and grading (ModelBasedGrader)
│   │   ├── eval-runner.ts # trial orchestration and NDJSON stream parsing
│   │   ├── environment.ts # git worktree isolation and skill symlinks
│   │   ├── statistics.ts  # pass@k metric computation (computePassAtK, aggregatePassAtK)
│   │   ├── trial-utils.ts # shared trial padding helper (padAbortedTrials)
│   │   ├── preflight.ts   # agent binary + skill path validation before trials
│   │   └── errors.ts      # custom error types
│   ├── utils/             # shared utilities (eval-loader, exec, ndjson, ui, logger, table-renderer)
│   └── types/             # shared TypeScript types (NdjsonEvent discriminated union)
├── tests/                 # test suite (mirrors src/ structure)
├── package.json           # project manifest
├── tsconfig.json          # TypeScript configuration
└── README.md              # project documentation
```

## Key technologies
- **Language:** TypeScript
- **Runtime:** Node.js
- **Package manager:** npm (`package-lock.json`)
- **Framework:** [Commander.js](https://www.npmjs.com/package/commander) - CLI framework (`package.json`)
- **Testing:** [tsx](https://tsx.is/) for unit tests (`package.json`, `npm run test:unit`).
- **Other notable libraries/tools:**
  - [Gemini CLI](https://github.com/google/gemini-cli) - runner for the agents being evaluated
  - [listr2](https://listr2.kilic.dev/) - task list UI renderer
  - [ora](https://github.com/sindresorhus/ora) - CLI spinner
  - [p-limit](https://github.com/sindresorhus/p-limit) - concurrency control for parallel evaluations
  - [chalk](https://github.com/chalk/chalk) - terminal colors
  - [cli-table3](https://github.com/cli-table/cli-table3) - ASCII table rendering

## Code style guidelines
- Refer to `tsconfig.json` for TypeScript compilation settings.
- Use `src/index.ts` and `src/commands/trigger.ts` as canonical examples for style and structure.

## Testing instructions
- Use `npm run test:unit` to run the full unit test suite.
- Use `npm run test:trigger` or `npm run test:functional` to run integration evaluations against the mock skill.
- To test a subset of tests, use `tsx --test "tests/path/to/test.test.ts"`.

## Security considerations
- No specific security constraints are documented.

## Extra instructions
- **Agent development cycle (default, unless overridden)**
  - This is the default workflow for this repository.
  - Override: Only override this workflow if the task explicitly says to use a different workflow (e.g., "override the default workflow" / "follow this workflow instead") or provides its own step-by-step "Workflow / Way of working". If overridden, do not merge workflows.
  - Plan once: Before coding, propose a TODO list oriented to iterative implementation and STOP. Ask for approval once. After approval, proceed without asking for the plan again unless new information invalidates it.
  - Test-first (when supported): If the repo has an existing test framework AND documented test command(s) (as listed in this AGENTS.md), write/update tests that specify the new behavior before implementing the production change.
  - Quality gate (must answer “yes” before finishing):
    - Task alignment: Does the change meet every requirement from the original request (and nothing unrelated)?
    - Tests for new logic: Did I add/adjust unit tests covering the success path and relevant error or edge cases (when supported in this repo)?
    - Idiomatic + consistent: Does the implementation follow repo conventions and language idioms?
    - Clarity + simplicity: Is the code easy to read and minimizes complexity?
    - Error handling: Are failure modes handled explicitly using the repo’s idioms (exceptions, Result types, validations, retries), with no silent failures?
  - Final verification (only using verified commands listed above): Run the applicable validation commands that exist in this repo and are listed in "Build and test commands":
    - build/compile validation (if listed)
    - tests covering what you changed (single/scope if documented, otherwise full test command)
    - lint/format/typecheck (if listed)
