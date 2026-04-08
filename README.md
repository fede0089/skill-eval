# skill-eval

A robust Node.js CLI tool specifically built to test and evaluate the triggering of Agent Skills locally using Gemini CLI.

Currently, it focuses purely on parsing the outputs to evaluate whether a skill triggered successfully (`--approval-mode auto_edit` under the hood) without interrupting your CI/CD or development environment.

## Requirements
- Node.js environment
- TypeScript (`npm install` to grab all `devDependencies`)
- `gemini` CLI installed and added to `$PATH`.

## Setup and Installation

In the local repository, build and link the CLI:
```sh
npm install
npm run build
npm link
```

This will make the `skill-eval` binary available globally on your terminal.

## Usage

Evaluating a skill trigger goes through the `evals/evals.json` definition inside your target skill directory.

1. Ensure the destination skill has the typical structure:
   ```txt
   my-skill/
     SKILL.md
     evals/
       evals.json
   ```

2. Execute the CLI from anywhere **outside** the skill referencing its relative or absolute path:
   ```sh
   skill-eval trigger --skill ../ruta/al/skill
   ```

3. `skill-eval` will automatically:
   - Link the skill temporarily (it simulates a `Y` via pipes to bypass interactive links).
   - Fire up `gemini` in a headless mode reading the eval prompts.
   - Detect if the skill tools actually fired (`totalCalls > 0` under `stats.tools.byName`).
   - Create a local directory `.project-skill-evals/runs/<timestamp>/` and dump the raw full evaluation JSONs there for deeper debugging.

4. You can also rate your experience with the tool using the `view` command:
   ```sh
   skill-eval view --ease 5 --speed 4 --accuracy 5 --comment "Excellent!"
   ```

## JSON Valid Structure (evals.json)
Minimum structure required:
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
