# Track: Anthropic Evals Format Adjustment

## Overview
Adjust the evaluation format to match the Anthropic format, enforcing numeric IDs and standardizing output logging. The system will output the `id` + `expected_output` and ensure that all task-specific logs generated adhere to a `task_$id` naming convention.

## Functional Requirements
- **TypeScript Interfaces**: Update the `EvalTestCase` (or relevant) TypeScript interface to strictly require `id` as a number (e.g., `id: number`).
- **Eval Files Migration**: Migrate existing evaluation JSON files in `mock-skill/evals/` to use the new numeric `id` format instead of strings.
- **Log Naming & Storage**: 
  - Ensure all logs generated during evaluations are prefixed or named `task_$id`.
  - Store logs both in standard output (stdout) and in the file system (e.g., within `.project-skill-evals/`).
- **Output Formatting**: Print `id + expected_output` during both task execution and in the final evaluation summary report.

## Non-Functional Requirements
- Ensure the JSON schema changes are handled gracefully by the CLI parser.

## Acceptance Criteria
- [ ] TypeScript compilation succeeds with the new strict numeric `id` requirement.
- [ ] All files in `mock-skill/evals/` have been updated and are parsed correctly.
- [ ] Running evaluations (both trigger and functional) prints `id + expected_output` to stdout.
- [ ] Log files generated are named `task_$id` and saved in `.project-skill-evals/`.
- [ ] The final summary report includes the required output format.

## Out of Scope
- Adding new evaluation criteria beyond the Anthropic format adjustments.