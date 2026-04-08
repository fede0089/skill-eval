# Specification: Refactor Functional CLI Output

## Overview
The current CLI output for the functional evaluation is unclear regarding how many expectations pass per run and what the final summary percentages mean. This track aims to refactor the terminal logging to provide a clear, hierarchical breakdown of trigger and expectation results per evaluation, and a more detailed final summary.

## Functional Requirements
1. **Per-Eval Output:** For each evaluation, log the Trigger status (latency, tokens) and a breakdown of Expectations (e.g., `Expectations (1/2 Passed):`).
2. **Expectation Details:** List each expectation individually with a ✅ or ❌. If it fails, append the reason.
3. **Summary Output:** The final summary must clearly distinguish between:
   - **Trigger Rate:** Number of evals triggered out of total evals.
   - **Functional Rate:** Number of evals where ALL expectations passed out of evals with expectations.
   - **Expectations Met:** Total individual expectations passed out of the total individual expectations across all evals.
4. **Emoji Usage:** Strictly limit emoji usage to ✅ and ❌ to maintain a professional CLI appearance. Do not use extraneous emojis.

## Non-Functional Requirements
- Maintain existing JSON artifact output structure (`summary.json` and `eval_*.json`).

## Acceptance Criteria
- [ ] Console output matches the requested hierarchical format for individual evals.
- [ ] Console summary clearly shows Trigger Rate, Functional Rate, and Expectations Met.
- [ ] Only ✅ and ❌ are used as emojis in the output.