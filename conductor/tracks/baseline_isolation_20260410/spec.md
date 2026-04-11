# Overview
Implement strict isolation for the Baseline pass in skill evaluations to ensure the agent under test cannot access the skill being evaluated. This guarantees that the Baseline represents true zero-shot/vanilla capabilities without the skill, making the Uplift metric pure.

# Functional Requirements
1. **Environment Isolation**: Before running the Baseline trial, dynamically disable the skill being tested in the current project scope using the CLI command (e.g. `gemini skills disable <skill-name> --scope project`).
2. **System Prompt Restriction**: Inject a negative system prompt specifically for the Baseline pass: "IMPORTANT: For this task, you MUST NOT use the [Skill Name] tool, even if it appears available."
3. **Transcription Validation (Guardrail)**: Parse the structured JSON output logs (similar to the triggering evaluation mechanism) of the Baseline pass to verify if the agent attempted to invoke the restricted skill. If a tool call to the skill is detected, mark the trial as "Invalid Baseline".

# Non-Functional Requirements
- Ensure the state is properly managed (e.g., re-enable the skill after the baseline if necessary, or ensure the test environment manages its setup/teardown correctly).
- Cache clearing is explicitly NOT required.

# Acceptance Criteria
- [ ] Baseline execution successfully runs with the target skill disabled in the project scope.
- [ ] The prompt sent to the Baseline runner includes the strict negative instruction.
- [ ] The execution output is parsed via JSON, and if the restricted skill call is present, the trial is flagged/failed.
- [ ] The baseline isolation logic integrates seamlessly with the existing `EvalRunner`.