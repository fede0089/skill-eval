# Eval Terminology Refactor Plan

## Objective
Refactor the `skill-eval` CLI to align its internal terminology and data models with the industry-standard evaluation framework defined by Anthropic, while preserving the existing evaluation logic and capabilities (trigger and functional testing). 

The goal is to provide a robust, scalable foundation that supports future features like multiple trials per task and diverse grader types, without breaking the conceptual model of Anthropic Evals.

## Key Terminology Mapping (Anthropic Model)
*   **Task (EvalTask):** A single test case with defined inputs (`prompt`) and success criteria (`assertions`). Currently referred to as `eval` or `evalSpec`.
*   **Trial (EvalTrial):** A single execution of a Task. Multiple trials produce more consistent results (even if currently we only run one per task).
*   **Assertions:** The specific rules or expectations a Trial must pass. Currently referred to as `expectations`.
*   **Grader:** The logic that scores the agent's performance (e.g., `ProgrammaticGrader` for trigger checks, `ModelBasedGrader` for functional expectations). Currently handled by `Evaluator` and `FunctionalEvaluator`.
*   **Transcript:** The complete record of a Trial (outputs, tool calls, stats). Currently referred to as `AgentOutput`.
*   **Suite (EvalSuite):** A collection of Tasks designed to measure specific capabilities. Currently represented by the `evals.json` file content.
*   **Baseline vs. Target:** The configurations being compared. 'Baseline' is running without the skill, 'Target' is running with the skill.

## Scope & Impact
*   **Data Models (`src/types/index.ts`):** Complete renaming and restructuring of evaluation interfaces to reflect the new terminology (Task, Trial, Assertion, Suite, Transcript).
*   **Core Evaluators (`src/core/evaluator.ts`):** Renaming variables and methods (e.g., `expectations` -> `assertions`, `evaluateFunctional` -> `gradeModelBased`). Refactoring evaluators conceptually into Graders.
*   **Commands (`src/commands/trigger.ts`, `src/commands/functional.ts`):** Updating the execution flow to construct `EvalTrial` objects and aggregate them into `TaskResult` and `EvalSuiteReport`.
*   **File Loader (`src/utils/eval-loader.ts`):** Updating the loader to parse the new structure (mapping `evals` to `tasks` if necessary for backwards compatibility with existing JSONs, but preferring `tasks` internally).
*   **Tests:** Updating all associated unit tests to use the new interfaces and terminology.
*   **JSON Schema/Structure:** The expected structure of `mock-skill/evals/evals.json` will logically group tasks into a suite. We will support mapping legacy keys (`evals` -> `tasks`, `expectations` -> `assertions`) during loading to avoid breaking existing skills immediately, but internally we will use the strict Anthropic terms.

## Proposed Solution & Implementation Steps

### Step 1: Update Type Definitions (`src/types/index.ts`)
Introduce the new Anthropic-aligned interfaces.
*   Rename `Eval` to `EvalTask`. Change `expectations` to `assertions`.
*   Rename `ExpectationResult` to `AssertionResult`. Add `graderType` ('programmatic' | 'model-based').
*   Rename `AgentOutput` to `AgentTranscript`.
*   Create `EvalTrial` to encapsulate a single run (id, transcript, assertionResults, trialPassed).
*   Create `TaskResult` to aggregate trials for a task (score, trials).
*   Rename `EvalSummaryReport` to `EvalSuiteReport` and structure it to contain `TaskResults`. Introduce `targetScore` and `baselineScore`.
*   Rename `EvalFile` to `EvalSuite`.

### Step 2: Refactor Evaluator to Graders (`src/core/evaluator.ts`)
Refactor the evaluation logic to reflect the Grader concept.
*   Rename `Evaluator` methods to reflect Programmatic Grading (e.g., `gradeTrigger` instead of `isSkillTriggered`).
*   Rename `FunctionalEvaluator` to `ModelBasedGrader` (or similar) and update its methods to grade `assertions` instead of `expectations`.
*   Update the LLM Judge prompt text to use the word "assertions" instead of "expectations".

### Step 3: Refactor Eval Loader (`src/utils/eval-loader.ts`)
Update the loader to return the new `EvalSuite` type.
*   Implement a backwards-compatibility mapping layer: if the JSON has `evals`, map it to `tasks`; if it has `expectations`, map it to `assertions`. This ensures `evals.json` files from Skill Creator don't break immediately while we transition the internal model.

### Step 4: Refactor CLI Commands
Update `functional.ts` and `trigger.ts` to use the new terminology and structures.
*   **`functional.ts`:** 
    *   Iterate over `tasks` instead of `evals`.
    *   Construct `EvalTrial` objects for Baseline and Target runs.
    *   Aggregate results into `TaskResult` (calculating a `score` of 1 or 0 for the single trial).
    *   Build the final `EvalSuiteReport`.
    *   Update console output text (e.g., "Evaluating assertions..." instead of "Evaluating expectations...").
*   **`trigger.ts`:**
    *   Similar updates to iterate over `tasks` and construct `EvalTrial` and `TaskResult` objects using the programmatic grader.

### Step 5: Update Tests and Mocks
*   Update all unit tests in `tests/` to use the new types, method names, and terminology.
*   Update `mock-skill/evals/evals.json` to use the new keys (`tasks`, `assertions`) to test the preferred structure.

## Tasks

- [x] **Task 1: Update Type Definitions (`src/types/index.ts`)** (80187ba)
- [x] **Task 2: Refactor Evaluator to Graders (`src/core/evaluator.ts`)** (80187ba)
- [x] **Task 3: Refactor Eval Loader (`src/utils/eval-loader.ts`)** (80187ba)
- [x] **Task 4: Refactor CLI Commands (`src/commands/trigger.ts`, `src/commands/functional.ts`)** (80187ba)
- [x] **Task 5: Update Tests and Mocks** (80187ba)
- [x] **Task 6: Final Verification (Unit and Integration)** (80187ba)

## Alternatives Considered
*   **Keep current terminology:** Rejected because it deviates from industry standards (Anthropic, Braintrust, LangSmith), making the codebase harder to understand for engineers familiar with modern eval frameworks, and less extensible for future features like multi-trial scoring.
*   **Strict JSON enforcement:** We considered failing if `evals.json` uses the old `evals`/`expectations` keys. We decided against this to maintain compatibility with existing skills generated by Skill Creator, opting instead for a mapping layer in the loader.

## Migration & Rollback
*   **Migration:** The loader will handle mapping legacy JSON structures to the new internal model. The internal TypeScript changes are comprehensive but contained within the `src/` directory.
*   **Rollback:** If issues arise, we can revert the git commit containing these changes, as no external state (like databases) is modified. The `.project-skill-evals` output format will change, but those are ephemeral reports.

## Verification
*   Run `npm run test:unit` to ensure all logic and new typings are correct.
*   Run `npm run test:trigger` and `npm run test:functional` against the `mock-skill` to verify the end-to-end evaluation process still works as expected and produces reports with the new terminology.