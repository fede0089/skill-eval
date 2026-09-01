# Changelog

Notable changes to `skill-eval`. Versions are tagged by the `release:*` scripts;
entries land here first under `Unreleased`.

## Unreleased

### Breaking

- **The positional agent argument is gone.** `skill-eval trigger gemini-cli …`
  and `skill-eval functional codex …` now fail with `error: too many arguments`.
  One position cannot name two roles, and keeping it alongside the new flags
  would leave two ways to choose an agent.

  ```sh
  # before
  skill-eval functional codex --workspace . --skill ./my-skill

  # now
  skill-eval functional --executor-agent codex --workspace . --skill ./my-skill
  ```

- **A skill can no longer reference anything under `evals/` from its
  implementation.** The evaluated agent now receives the skill with `evals/`
  left out, so it cannot read the expectations it is being graded with. A
  `SKILL.md` pointing at a file below `evals/` will find nothing there.

### Changed

- **The evals are frozen at the start of a run and measure every variant.**
  `evals/`, its expectations and the evaluation config of both measuring roles
  are copied once, into `evals/` inside the run directory. A `--compare-ref`
  version now contributes only its implementation: it no longer brings its own
  evaluation config to the comparison, so a change in the evals between two
  versions can no longer move the numbers.
- The HTML report header records which evals produced the numbers.

### Fixed

- A relative `--skill` is now resolved against `--workspace` before extracting a
  `--compare-ref` version. Running from anywhere other than the workspace root
  extracted the ref from whatever repository the shell happened to be in.

### Added

- `--executor-agent <name>` on both commands: the agent that runs the evaluated
  task. Defaults to `gemini-cli`, as the positional argument did.
- `--judge-agent <name>` on `functional`: the agent that grades the result.
  Defaults to the executor agent, so a run that names neither behaves exactly as
  before. `trigger` does not take it — it reads the transcript to decide whether
  the skill was activated, so no agent judges anything there.
- Each role runs with the configuration your skill ships for its backend. Both
  roles work in the same trial worktree, so when they use different backends,
  both `evals/config/<runner>/` directories are applied there.
- The run header and the HTML report record which agent filled each role. A
  `trigger` run reports no judge instead of repeating the executor.
