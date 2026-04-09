# Plan: Remove Metrics and Align Output

## Objective
Remove latency and token metrics from the console output and summary reports to reduce noise, and align the output structures of the `trigger` and `functional` commands for consistency.

## Scope
The following files will be modified:
1. `src/types/index.ts`
2. `src/core/evaluator.ts`
3. `src/commands/trigger.ts`
4. `src/commands/functional.ts`
5. `tests/commands/functional.test.ts`

## Implementation Steps

### 1. Update Types (`src/types/index.ts`)
- Remove `latencyMs` and `tokens` from `EvalSummaryResult`.
- Remove `avgLatencyMs` and `totalTokens` from `EvalSummaryReport.metrics`.

### 2. Update Evaluator (`src/core/evaluator.ts`)
- Completely remove the `extractMetrics` method from the `Evaluator` class.

### 3. Update `trigger` Command (`src/commands/trigger.ts`)
- Remove local variables `latencyMs` and `tokens`.
- Remove calls to `evaluator.extractMetrics`.
- Remove metric fields when pushing to `summaryResults`.
- Remove metric fields from `report.metrics`.
- Align progress header: change `=> Processing eval ${i}` to `=> Eval ${i + 1}/${evals.length}` to match `functional.ts`.
- Align result output to match the style of `functional.ts`:
  - Use `Logger.info('   Trigger: ✅')` or `❌`.
  - Use `Logger.info('   Result: STATUS')` when not triggered.
- Remove metrics from the final summary output.

### 4. Update `functional` Command (`src/commands/functional.ts`)
- Remove local variables `latencyMs` and `tokens`.
- Remove calls to `evaluator.extractMetrics`.
- Remove metric fields when pushing to `summaryResults`.
- Remove metric fields from `report.metrics`.
- Update `Logger.info` to remove `(${latencyMs}ms | ${tokens} tokens)` from the `Trigger` log.
- Remove `avgLatency` and `totalTokens` calculations and logs from the final summary.

### 5. Update Tests (`tests/commands/functional.test.ts`)
- Remove any mock configurations for `extractMetrics` (e.g., `mock.method(FunctionalEvaluator.prototype, 'extractMetrics', ...)`).

## Verification
- Run `npm run test` to ensure all tests pass.
- Run `npm run test:trigger` and `npm run test:functional` to verify the console output structure is clean, aligned, and free of latency/token metrics.
