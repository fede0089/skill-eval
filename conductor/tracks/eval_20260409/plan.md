# Implementation Plan: skill-eval Full Evaluation & Reporting Improvements

## Phase 1: Setup Rich UI Dependencies
- [x] Task: Install UI libraries (e.g., chalk, ora, cli-table3) and add them to package.json [a6655b3]
- [ ] Task: Conductor - User Manual Verification 'Phase 1: Setup Rich UI Dependencies' (Protocol in workflow.md)

## Phase 2: Implement Rich CLI Output Utilities
- [ ] Task: Write failing tests for new UI utility functions (e.g., spinner wrapper, table generator, error formatter)
- [ ] Task: Implement UI utility functions to pass tests
- [ ] Task: Refactor existing loggers in `src/utils/logger.ts` to use the new UI utilities
- [ ] Task: Conductor - User Manual Verification 'Phase 2: Implement Rich CLI Output Utilities' (Protocol in workflow.md)

## Phase 3: Update Default Command Execution
- [ ] Task: Write failing tests for the default CLI command (`skill-eval --skill <path>`) to ensure it triggers both evaluation phases
- [ ] Task: Modify `src/index.ts` or the main command handler to execute the full evaluation suite by default when no subcommand is provided
- [ ] Task: Implement logic to ensure both trigger and functional testing run sequentially
- [ ] Task: Conductor - User Manual Verification 'Phase 3: Update Default Command Execution' (Protocol in workflow.md)

## Phase 4: Implement "Run All" Failure Handling and Final Summary
- [ ] Task: Write failing tests to verify that a failure in the "trigger" phase does not stop the "functional" phase execution
- [ ] Task: Update the evaluator core to catch and accumulate errors from each phase without halting
- [ ] Task: Implement the generation of the final summary table displaying the results of both phases using the new UI utilities
- [ ] Task: Enhance error trace formatting in the final summary for better debugging
- [ ] Task: Conductor - User Manual Verification 'Phase 4: Implement "Run All" Failure Handling and Final Summary' (Protocol in workflow.md)