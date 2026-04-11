# Overview

Two targeted improvements to `skill-eval`: fix silent parsing bugs in NDJSON stream output, and implement multi-trial task execution with the pass@k reliability metric.

## Functional Requirements

- **NDJSON Parsing Fix**: Replace `line.match(/\{.*\}/)` regex with `JSON.parse(line.trim())` in all 3 parsing locations (`parseStreamResult`, `gradeTrigger`, `detectSkillAttempt`). Nested JSON objects (e.g. `{"parameters":{"opts":{}}}`) must be handled correctly.
- **Pass@k Multi-Trial**: Add `--trials <n>` flag (default 3). Run each task N times. Compute `pass@k` metric using `1 - C(failing,k)/C(total,k)`. Store all N `EvalTrial` objects per task. Backward compatible: `--trials 1` produces identical output to current behavior.

## Non-Functional Requirements

- No breaking changes to CLI interface (new flags are optional with safe defaults).
- TypeScript strict mode compliance.
- `npm run test:unit` passes with no regressions.

## Acceptance Criteria

- [ ] `parseNdjsonEvents()` correctly handles objects with nested braces.
- [ ] All 3 regex parsing sites replaced with shared `parseNdjsonEvents()` utility.
- [ ] `--trials 3` (default) produces `summary.json` with 3 `EvalTrial` entries per task and a `passAtK` metric.
- [ ] `--trials 1` produces identical output to current behavior (modulo new optional fields).
- [ ] `npm run test:unit` passes with no regressions.

## Out of Scope

- Retry logic, judge majority voting, confidence intervals.
