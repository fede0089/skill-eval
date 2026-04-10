# Implementation Plan: Refactor Skill Activation Grader

## Phase 1: Configure Runner for JSON Output
- [ ] Task: Update runner configuration tests
    - [ ] Update `tests/core/runners/gemini-cli.runner.test.ts` to expect JSON output stream configuration.
    - [ ] Run the tests and ensure they fail.
- [ ] Task: Implement runner configuration
    - [ ] Update `src/core/runners/gemini-cli.runner.ts` (or relevant runner config) to enable stream-json output.
    - [ ] Run the tests and ensure they pass.
- [ ] Task: Conductor - User Manual Verification 'Phase 1: Configure Runner for JSON Output' (Protocol in workflow.md)

## Phase 2: Refactor Trigger Command Grader
- [ ] Task: Write failing tests for trigger command grader
    - [ ] Update `tests/commands/trigger.test.ts` to simulate JSON stream events (`tool_use`, `tool_result`).
    - [ ] Add test cases for successful activation (correct tool name, status success).
    - [ ] Add test cases for failure scenarios (incorrect tool name, status failure, missing events).
    - [ ] Run tests and ensure they fail.
- [ ] Task: Implement new JSON stream parsing logic
    - [ ] Refactor `src/commands/trigger.ts` to parse the JSON stream instead of plain text.
    - [ ] Implement detection logic: look for `type == "tool_use"`, `tool_name == "activate_skill"`.
    - [ ] Implement detection logic: check parameter `name` against `mock-skill` (case-insensitive).
    - [ ] Implement detection logic: look for `type == "tool_result"` with matching `tool_id` and `status == "success"`.
    - [ ] Ensure the trigger evaluation completes successfully when all conditions are met.
    - [ ] Run tests and ensure they pass.
- [ ] Task: Verify functionality and coverage
    - [ ] Run the full unit test suite `npm run test:unit`.
    - [ ] Run integration test `npm run test:trigger`.
- [ ] Task: Conductor - User Manual Verification 'Phase 2: Refactor Trigger Command Grader' (Protocol in workflow.md)