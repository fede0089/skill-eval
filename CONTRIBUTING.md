# Contributing to skill-eval

## Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Gemini CLI](https://github.com/google/gemini-cli) installed and authenticated (required for integration evaluations)

## Local setup

```bash
git clone https://github.com/fede0089/skill-eval.git
cd skill-eval
npm install
npm run build
```

## Running tests

```bash
# Unit tests (no external dependencies)
npm run test:unit

# Integration evaluations against the mock skill (requires Gemini CLI)
npm run test:trigger
npm run test:functional
```

## Submitting a pull request

1. Fork the repo and create a branch from `main`.
2. Make your changes.
3. Add or update unit tests that cover the new behavior (`npm run test:unit`).
4. Verify the build passes (`npm run build`).
5. Open a pull request with a clear description of what changed and why.

PRs that add new runners or report formats should follow the patterns in `src/runners/` and `src/reporters/` respectively — see `AGENTS.md` for details.

## Reporting bugs

Open an issue at https://github.com/fede0089/skill-eval/issues. Include:
- What you ran (command + flags)
- What you expected vs. what happened
- Node.js version and OS
