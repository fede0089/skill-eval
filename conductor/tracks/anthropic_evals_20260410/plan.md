# Implementation Plan: Anthropic Evals Format Adjustment

## Phase 1: Update TypeScript Interfaces & Evals Schema
- [x] Task: Write failing unit tests for eval parsing with string vs numeric IDs. [checkpoint: 9220ea3]
    - [x] Create test case for parsing valid numeric ID. [9220ea3]
    - [x] Create test case verifying rejection of string IDs. [9220ea3]
- [x] Task: Implement TypeScript interface changes for strictly numeric `id`. [9220ea3]
    - [x] Update `EvalTestCase` interface in `src/types/index.ts` or relevant file. [9220ea3]
    - [x] Update eval parsing logic in `src/utils/eval-loader.ts`. [9220ea3]
- [x] Task: Migrate existing JSON eval files in `mock-skill/evals/`. [9220ea3]
    - [x] Update `id` fields to be numbers instead of strings. [9220ea3]
- [x] Task: Conductor - User Manual Verification 'Update TypeScript Interfaces & Evals Schema' (Protocol in workflow.md) [9220ea3]

## Phase 2: Adjust Logging Naming Convention & Output Formatting
- [x] Task: Write failing unit tests for new logging and output format. [9220ea3]
    - [x] Test that `task_$id` is used for log file names. [9220ea3]
    - [x] Test that `id + expected_output` is generated correctly. [9220ea3]
- [x] Task: Implement logic to output `id + expected_output`. [9220ea3]
    - [x] Update execution loop to print `id + expected_output` during task runs. [9220ea3]
    - [x] Update final summary logic to include `id + expected_output`. [9220ea3]
- [x] Task: Implement logging updates. [9220ea3]
    - [x] Ensure logs are saved correctly to `.project-skill-evals/task_$id`. [9220ea3]
    - [x] Ensure logs are also printed to stdout. [9220ea3]
- [x] Task: Conductor - User Manual Verification 'Adjust Logging Naming Convention & Output Formatting' (Protocol in workflow.md) [9220ea3]
