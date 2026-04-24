# skill-eval

A CLI tool for evaluating Agent Skills locally. Tests whether your skill triggers reliably and produces the right output, using an LLM as the judge.

## Why skill evals?

Skills are instructions that change how the agent behaves. But a single successful run isn't enough to trust one — agents are non-deterministic, and a good isolated result can be exactly that: an isolated case.

Skill evals let you turn that intuition into evidence: run several comparable tasks with and without the skill, measure them against the same criteria, and validate whether the agent improves consistently against a baseline.

## How it works

For each eval prompt, skill-eval spins up parallel agent processes — some with the skill installed, others without (the baseline). Each agent runs headlessly and produces a transcript. An LLM judge then grades each transcript against your expectations. Results are aggregated into **pass@k** metrics, giving you a clear measure of how much your skill actually improves the agent's behavior versus the unassisted baseline.

```
                  eval prompt
                       │
               ┌───────▼───────┐
               │   skill-eval  │
               └───────┬───────┘
                       │
           ┌───────────┴───────────┐
      ─ with skill ─          ─ baseline ─
      ┌──────┴──────┐         ┌─────┴──────┐
    agent 1      agent 2   agent 3      agent 4
      │              │         │             │
    judge          judge     judge         judge
      └──────┬──────┘         └──────┬──────┘
             └──────────┬────────────┘
                        │
                     pass@k
```

> The `trigger` command only runs with-skill trials and checks whether the skill dispatch tool was actually invoked — no judge or baseline needed.

## Quick Start

```sh
git clone <this-repo>
cd skill-eval
npm install
npm run build
npm link
```

This makes `skill-eval` available globally in your terminal.

**Requirements:** Node.js, and the agent CLI you want to evaluate (e.g. `gemini`) installed and on `$PATH`.

## Commands

```sh
# Checks that the skill is triggered (invoked) for each prompt
skill-eval trigger --workspace <path> --skill <path> [options] [agent]

# Checks that the skill produces correct output, measured against a baseline
skill-eval functional --workspace <path> --skill <path> [options] [agent]
```

### Options

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--workspace <path>` | yes | — | Path to the repo the agent will run in |
| `--skill <path>` | yes | — | Path to the skill directory |
| `--agents <number>` | no | `4` | Number of parallel agent processes |
| `--trials <number>` | no | `3` | Trials per task (for pass@k) |
| `--timeout <seconds>` | no | none | Kill the agent after this many seconds |
| `--eval-id <id>` | no | all | Run only the eval with this numeric ID |
| `-v, --debug` | no | `false` | Enable verbose debug logging |
| `[agent]` | no | `gemini-cli` | Agent backend to use |

### Skill directory structure

```
my-skill/
├── SKILL.md                        # skill definition (required)
└── evals/                          # evaluation suite (required)
    ├── my-evals.json               # one or more eval files (*.json)
    └── config/                     # runner configuration (optional but often needed)
        └── gemini-cli/             # runner-specific config folder
            └── settings.json       # copied to <worktree>/.gemini/ before each trial
```

All `.json` files in `evals/` are loaded and merged into a single suite — you can split them by feature or regression category.

**Trigger eval** — `id` must be a unique integer across all eval files:
```json
{
  "skill_name": "my-skill",
  "evals": [
    { "id": 1, "prompt": "Do the thing that my skill handles" }
  ]
}
```

**Functional eval** — add `expectations` for the LLM judge to evaluate:
```json
{
  "skill_name": "my-skill",
  "evals": [
    {
      "id": 1,
      "prompt": "Create a file called hello.txt containing the word 'world'",
      "expectations": [
        "A file named hello.txt was created",
        "The file contains the text 'world'"
      ]
    }
  ]
}
```

## Permissions

**This is the most common cause of eval failures.**

skill-eval runs the agent headlessly — stdin is closed, there is no terminal. If the agent encounters a tool that requires interactive approval, it will either fail immediately or hang until the trial timeout kills it.

The runner already uses `--approval-mode auto_edit`, which auto-approves standard file operations (create, edit, delete). But if your skill needs to run shell commands, read environment variables, make network calls, or use any other tool category — those still require explicit permission.

**Solution:** place a config file inside your skill at `evals/config/<runner>/`. Before every trial, skill-eval automatically copies that directory into the agent's config location inside the isolated worktree:

```
evals/config/gemini-cli/  →  <worktree>/.gemini/
```

Use this to ship both settings and policies alongside your evals. For Gemini CLI, for example, you can use `settings.json` to configure tool permissions and approval policies so that every tool your skill relies on runs without prompting:

```json
{
  "telemetry": { "enabled": false }
}
```

Refer to your runner's documentation for the full list of available settings and policy keys.

> This config only applies inside the temporary worktree created for each trial. Your real workspace config is never touched.

## Try it out

This repo includes a `mock-skill/` directory — a complete, working example of a license-generator skill with trigger and functional evals. Run it directly with:

```sh
npm run test:trigger     # trigger evaluation against mock-skill
npm run test:functional  # functional evaluation against mock-skill
```

Results are saved to `.project-skill-evals/runs/<timestamp>/` with logs, raw eval JSONs, and an HTML report.

## Extending

### Adding a new agent runner

1. Create `src/runners/<your-agent>/runner.ts` implementing the `AgentRunner` interface (see `src/runners/runner.interface.ts`).
2. Export it from `src/runners/<your-agent>/index.ts`.
3. Register it in `src/runners/registry.ts`:
   ```ts
   '<your-agent>': { Runner: YourRunner, binary: '<cli-binary-name>' },
   ```

The factory, preflight check, and CLI all pick it up automatically.

> Implement `applyRunnerConfig(evalConfigBaseDir, worktreePath)` to copy `evalConfigBaseDir/<your-agent>/` into the appropriate config directory in the worktree (e.g. `.claude/` for a Claude runner). No-op silently if the directory doesn't exist.

### Adding a new report format

1. Create `src/reporters/<format>-reporter.ts` implementing `Reporter`.
2. Export it and add a case in `createReporter()` in `src/reporters/index.ts`.
3. Add the format string to `ReportFormat` in `src/types/index.ts`.
