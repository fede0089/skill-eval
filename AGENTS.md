# AGENTS.md

## Build and test commands
- `npm install` - Install all dependencies.
- `npm run build` - Build the project using `tsc`.
- `npm test` - Run the automated test suite.

## Project overview
- A Node.js CLI tool built to evaluate Agent Skills triggering locally using the Gemini CLI.
- Entrypoints for understanding the system:
  - `src/index.ts` - Main CLI entrypoint.
  - `src/commands/trigger.ts` - Skill triggering logic.
  - `src/core/evaluator.ts` - Core evaluation logic.
  - `mock-skill/SKILL.md` - Example skill structure.

### Repository layout
```
.
├── .project-skill-evals/  # evaluation run results
├── conductor/             # conductor metadata
├── mock-skill/           # mock skill for evaluation tests
├── src/                  # source code
│   ├── commands/         # CLI command definitions
│   ├── core/            # core evaluation and runner logic
│   └── types/           # shared TypeScript types
├── package.json          # project manifest
├── tsconfig.json         # TypeScript configuration
└── README.md             # project documentation
```

## Key technologies
- **Language:** TypeScript
- **Runtime:** Node.js
- **Package manager:** npm (`package-lock.json`)
- **Framework:** [Commander.js](https://www.npmjs.com/package/commander) - CLI framework (`package.json`)
- **Testing:** Custom test script using Node.js (`package.json`, `npm test`)
- **Lint/Format:** No dedicated linting/formatting tools are documented.

## Code style guidelines
- No explicit linting or formatting configuration exists.
- Refer to `tsconfig.json` for TypeScript compilation settings.
- Use `src/index.ts` and `src/commands/trigger.ts` as canonical examples for style and structure.

## Testing instructions
- Use `npm test` to run the full test suite.
- For manual testing, you can use the mock skill: 
  - `node dist/index.js trigger --skill ./mock-skill` (default: gemini-cli)
  - `node dist/index.js trigger [agent] --skill ./mock-skill` (to specify an agent)

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
