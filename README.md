# skill-eval

A robust Node.js CLI tool specifically built to test and evaluate Agent Skills locally. It supports evaluating skill triggers and validating functional correctness through an LLM judge.

The agent executes in a **headless mode** (e.g., using `--approval-mode auto_edit` under the hood) without interrupting your CI/CD or development environment. 

> **⚠️ Important Note on Permissions:** 
> Because the execution is headless, the agent needs non-interactive permissions for the tools it intends to use. 
> - **Minimum requirement:** Permissions to use the skill dispatch tool (e.g., `activate_skill` for Gemini CLI).
> - **Functional edits:** If your evaluations require the agent to edit files, run commands, or use other specific tools, you MUST configure your environment (e.g., Gemini CLI policies) to allow these tools to run non-interactively. Otherwise, the agent will block waiting for user approval, and the evaluation will timeout or fail.

## Requirements
- Node.js environment
- TypeScript (`npm install` to grab all `devDependencies`)
- `gemini` CLI (or target agent CLI) installed and available in `$PATH`.

## Setup and Installation

In the local repository, build and link the CLI:
```sh
npm install
npm run build
npm link
```

This will make the `skill-eval` binary available globally on your terminal.

## Usage

Evaluations are defined via an `evals/evals.json` file inside your target skill directory.

1. Ensure the destination skill has the typical structure:
   ```txt
   my-skill/
     SKILL.md
     evals/
       evals.json
       config/               # optional: runner-specific configuration
         gemini-cli/         # copied into <worktree>/.gemini/ before each run
           settings.json
   ```

2. Run evaluations by specifying the workspace (the repo the agent will run in) and the skill path:

   **Evaluate Triggers (Trigger Command):**
   ```sh
   skill-eval trigger --workspace /path/to/repo --skill /path/to/skill
   ```

   **Evaluate Functional Correctness (Functional Command):**
   ```sh
   skill-eval functional --workspace /path/to/repo --skill /path/to/skill
   ```

   Both commands support `--trials <number>` (default: 3) to run multiple trials per task and compute **pass@k** metrics, and `--concurrency <number>` (default: 5) to control parallel execution.

   > **Runner config (`evals/config/<agent>/`):** Each skill can include runner-specific configuration files under `evals/config/`. Before every trial, skill-eval copies the matching subdirectory into the worktree's agent config directory (e.g., `evals/config/gemini-cli/` → `<worktree>/.gemini/`). Use this to pin `settings.json`, policies, or any other runner config needed for the eval to work correctly — without touching your workspace's own config.

3. `skill-eval` will automatically:
   - Validate the agent binary and skill directory structure before starting (pre-flight check).
   - Create isolated git worktrees for each evaluation to prevent destructive changes to your main workspace.
   - Fire up the agent in a headless mode reading the eval prompts.
   - Detect if the skill tools actually fired (via NDJSON stream output).
   - Evaluate expectations via an LLM judge (for the `functional` command).
   - Compute pass@k metrics across multiple trials per task.
   - Create a local directory `.project-skill-evals/runs/<timestamp>/` and dump the raw full evaluation JSONs, logs, and a summary report there for deeper debugging.

## JSON Valid Structure (evals.json)
Minimum structure required for triggers:
```json
{
  "skill_name": "example-skill",
  "evals": [
    {
      "id": "1",
      "prompt": "Activate my skill by doing XYZ"
    }
  ]
}
```

For functional evaluations, include `expectations`:
```json
{
  "skill_name": "example-skill",
  "evals": [
    {
      "id": "1",
      "prompt": "Create a new file called hello.txt with the word 'world'",
      "expectations": [
        "A file named hello.txt should be created",
        "The file should contain the exact text 'world'"
      ]
    }
  ]
}
```

## Extending

### Adding a new agent runner

1. Create a folder `src/runners/<your-agent>/` with two files:
   ```
   src/runners/<your-agent>/
   ├── runner.ts    # implements AgentRunner interface
   └── index.ts     # export { YourRunner } from './runner.js'
   ```
2. Implement all methods of `AgentRunner`, including `applyRunnerConfig(evalConfigBaseDir, worktreePath)`. This method should copy `evalConfigBaseDir/<your-agent>/` into the appropriate config directory inside the worktree (e.g., `.gemini/` for Gemini CLI, `.claude/` for a hypothetical Claude runner). No-op silently if the directory doesn't exist.
3. Open `src/runners/registry.ts` and add one entry:
   ```ts
   import { YourRunner } from './<your-agent>/index.js';

   export const RUNNER_REGISTRY: Record<string, RunnerEntry> = {
     'gemini-cli': { Runner: GeminiCliRunner, binary: 'gemini' },
     '<your-agent>': { Runner: YourRunner, binary: '<cli-binary-name>' },
   };
   ```
4. Done — the factory, preflight check, and CLI all pick it up automatically.

### Adding a new report format

1. Create `src/reporters/<format>-reporter.ts` implementing `Reporter`.
2. Add it to `src/reporters/index.ts`: export the class and add a case in `createReporter()`.
3. Add the new format string to `ReportFormat` in `src/types/index.ts`.

## CLI flags

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--workspace <path>` | yes | — | Path to the repo the agent will run in |
| `--skill <path>` | yes | — | Path to the skill directory |
| `--concurrency <number>` | no | `5` | Concurrent tasks |
| `--trials <number>` | no | `3` | Trials per task (for pass@k) |
| `--report <format>` | no | `html` | Output format: `html` or `json` |
| `[agent]` | no | `gemini-cli` | Agent backend to use |
