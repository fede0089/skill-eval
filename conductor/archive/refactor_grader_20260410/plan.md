# Implementation Plan: Refactor Skill Activation Grader

## Phase 1: Configure Runner for JSON Output [checkpoint: 05c8fc5]
- [x] Task: Update runner configuration tests [05c8fc5]
    - [x] Update `tests/core/runners/gemini-cli.runner.test.ts` to expect JSON output stream configuration.
    - [x] Run the tests and ensure they fail.
- [x] Task: Implement runner configuration [05c8fc5]
    - [x] Update `src/core/runners/gemini-cli.runner.ts` (or relevant runner config) to enable stream-json output.
    - [x] Run the tests and ensure they pass.
- [x] Task: Conductor - User Manual Verification 'Phase 1: Configure Runner for JSON Output' (Protocol in workflow.md) [05c8fc5]

## Phase 2: Refactor Trigger Command Grader [checkpoint: 05c8fc5]
- [x] Task: Write failing tests for trigger command grader [05c8fc5]
    - [x] Create `tests/core/trigger-grader.test.ts` to simulate JSON stream events (`tool_use`, `tool_result`).
    - [x] Add test cases for successful activation (correct tool name, status success).
    - [x] Add test cases for failure scenarios (incorrect tool name, status failure, missing events).
    - [x] Run tests and ensure they fail.
- [x] Task: Implement new JSON stream parsing logic [05c8fc5]
    - [x] Refactor `src/commands/trigger.ts` to parse the JSON stream instead of plain text.
    - [x] Implement detection logic: look for `type == "tool_use"`, `tool_name == "activate_skill"`.
    - [x] Implement detection logic: check parameter `name` against `mock-skill` (case-insensitive).
    - [x] Implement detection logic: look for `type == "tool_result"` with matching `tool_id` and `status == "success"`.
    - [x] Ensure the trigger evaluation completes successfully when all conditions are met.
    - [x] Run tests and ensure they pass.
- [x] Task: Verify functionality and coverage [05c8fc5]
    - [x] Run the full unit test suite `npm run test:unit`.
    - [x] Run integration test `npm run test:trigger`.
- [x] Task: Conductor - User Manual Verification 'Phase 2: Refactor Trigger Command Grader' (Protocol in workflow.md) [05c8fc5]
