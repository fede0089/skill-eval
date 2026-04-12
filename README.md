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
   ```

2. Execute the CLI from anywhere **outside** the skill referencing its relative or absolute path. You can run trigger evaluations, functional evaluations, or view the latest results:

   **Evaluate Triggers (Trigger Command):**
   ```sh
   skill-eval trigger --skill ../path/to/skill
   ```

   **Evaluate Functional Correctness (Functional Command):**
   ```sh
   skill-eval functional --skill ../path/to/skill
   ```

   **Display Latest Results (Show Command):**
   ```sh
   skill-eval show
   ```

   Both `trigger` and `functional` support `--trials <number>` (default: 3) to run multiple trials per task and compute **pass@k** metrics, and `--concurrency <number>` (default: 5) to control parallel execution.

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

## Configuration

Instead of passing flags every time, you can create a `.skill-eval.json` file in the directory where you run `skill-eval`. CLI flags always take precedence over config file values.

```json
{
  "skill": "./path/to/my-skill",
  "agent": "gemini-cli",
  "concurrency": 3,
  "trials": 5,
  "report": "html"
}
```

All fields are optional. With a config file in place, you can run evaluations without any flags:

```sh
skill-eval trigger
skill-eval functional
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `skill` | string | — | Path to the skill directory |
| `agent` | string | `gemini-cli` | Agent backend to use |
| `concurrency` | number | `5` | Concurrent tasks |
| `trials` | number | `3` | Trials per task (for pass@k) |
| `report` | `html` \| `json` | `html` | Output report format |
