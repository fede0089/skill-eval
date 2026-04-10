# Specification: Refactor Skill Activation Grader

## Overview
The current programmatic grader for detecting skill activation relies on the variable text output of the Gemini CLI, which makes it unreliable. This track refactors the trigger command to consume a stable JSON stream from the runner and explicitly look for specific tool use and tool result events.

## Functional Requirements
- **Runner Configuration:** Ensure the Gemini CLI runner is configured to output `stream-json` events instead of plain text.
- **Event Parsing:** The grader must parse the JSON stream to evaluate the evaluation's success.
- **Trigger Detection Logic:** A skill is marked as successfully activated ("skill activado") ONLY when the following sequence of events is detected in the stream:
  1. An event with `type == "tool_use"` and `tool_name == "activate_skill"`.
  2. The parameters of the tool call must have `name` matching `mock-skill` (case-insensitive) to ensure the correct skill was triggered.
  3. A subsequent event with `type == "tool_result"`, matching the `tool_id` of the `tool_use` event, and with `status == "success"`.

## Acceptance Criteria
- `src/commands/trigger.ts` is refactored to implement the new logic.
- The runner executes the AI agent expecting JSON output.
- The programmatic grader successfully passes when the mock skill is activated correctly.
- The programmatic grader fails when the mock skill is not activated or fails.
- All unit tests for the trigger command pass.
- E2E tests for the trigger command (`npm run test:trigger`) pass successfully.