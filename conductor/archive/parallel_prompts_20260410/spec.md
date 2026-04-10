# Track Specification: Parallel Prompt Execution with Dynamic Output

## Overview
This feature introduces parallel execution of prompts within the CLI tool to significantly improve performance. It also implements a dynamic, multi-line terminal output to visualize the progress of each concurrent prompt in real-time, culminating in a comprehensive summary once all executions finish.

## Functional Requirements
- **Parallel Execution:** The system must be capable of executing multiple prompts concurrently.
- **Concurrency Control:** Implement a configurable connection pool with a default limit (e.g., 5). The concurrency limit must be overridable via a new CLI flag (e.g., `--concurrency <number>`).
- **Dynamic UI:** Integrate the `listr2` library to render dynamic, multi-line output in the terminal. Each prompt execution should have its own dedicated, updating line showing its current status.
- **Error Handling:** Adopt a "Continue & Report" strategy. If an individual prompt fails during execution, the system must not halt the other running prompts. The failure should be recorded and prominently displayed in the final summary.
- **Final Summary:** Upon completion of all prompts, the dynamic UI should be finalized, and a clear summary report should be rendered showing the results of all executed prompts.

## Non-Functional Requirements
- **Performance:** Significant reduction in total execution time compared to sequential execution.
- **Dependency Management:** Add `listr2` as a dependency and ensure it integrates cleanly with the existing CLI framework (Commander.js).

## Acceptance Criteria
- [ ] Users can execute evaluations in parallel.
- [ ] Concurrency defaults to a sensible limit but can be modified via `--concurrency`.
- [ ] Terminal output updates in real-time with one line per executing prompt.
- [ ] A failure in one prompt does not prevent the completion of others.
- [ ] A final summary is accurately generated and displayed after all tasks complete.