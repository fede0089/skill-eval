# Specification: skill-eval Full Evaluation & Reporting Improvements

## Overview
This track focuses on improving the reporting output of the `skill-eval` tool and combining the `trigger` and `functional` testing into a single default execution path. Instead of requiring separate subcommands, running the CLI (e.g., `skill-eval --skill <path>`) will automatically run a comprehensive evaluation encompassing both trigger and functional testing phases.

## Functional Requirements
1. **Default Evaluation Command:**
   - Executing the base CLI with the `--skill` flag must trigger the full evaluation suite.
   - The full evaluation suite will sequentially execute the trigger tests followed by the functional tests.
2. **Failure Handling (Run All):**
   - The evaluation must not fail fast. If a test in the "trigger" phase fails, the tool should still attempt to execute the "functional" phase, gathering and reporting all errors at the end.
3. **Reporting Improvements (Rich CLI UI):**
   - **Visual Improvements:** Use rich UI resources for the CLI (e.g., colors for success/error, spinners for loading states).
   - **Summary Table:** Display a visually appealing, structured summary table at the end of the execution showing the pass/fail status of both trigger and functional phases.
   - **Better Error Traces:** Provide deeper context and clear, formatted stack traces when a test fails to aid in debugging.

## Non-Functional Requirements
- The output should remain accessible and legible across different terminal environments.
- Use dedicated UI libraries (like `chalk` for color, `ora` for spinners, and `cli-table3` for tables) to enhance the user experience.

## Acceptance Criteria
- Running the tool with `--skill` without a subcommand runs both trigger and functional tests.
- Terminal output is clean, reducing noise, and uses a rich UI summary table at the end.
- Both test phases run regardless of whether the other fails.
- Error messages are detailed and easy to read.