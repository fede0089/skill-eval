# Specification: Eval Terminology Refactor (Anthropic Alignment)

## Problem Statement
The current terminology used in `skill-eval` (e.g., `eval`, `expectations`) is inconsistent with industry-standard evaluation frameworks like Anthropic's. This makes the tool harder to integrate into standard LLM evaluation workflows and more difficult for engineers familiar with such frameworks to understand.

## Objectives
- Align internal and external terminology with Anthropic's evaluation framework.
- Restructure data models to support future scalability (e.g., multiple trials per task).
- Maintain backwards compatibility for existing evaluation files (`evals.json`).

## Requirements
### 1. Terminology Alignment
- **Task (`EvalTask`):** A single test case (input/prompt + success criteria).
- **Trial (`EvalTrial`):** A single execution of a Task.
- **Assertions:** Success criteria for a Task.
- **Grader:** Evaluation logic (Programmatic or Model-Based).
- **Transcript:** Record of a Trial.
- **Suite (`EvalSuite`):** A collection of Tasks.
- **Baseline:** Run without the skill.
- **Target:** Run with the skill.

### 2. Implementation Constraints
- Update all internal type definitions.
- Refactor `Evaluator` and `FunctionalEvaluator` into Grader concepts.
- Update LLM Judge prompt to use "assertions".
- Implement a mapping layer in `eval-loader.ts` to support legacy `evals` and `expectations` keys.
- Update reporting output to use the new terminology.

## Success Criteria
- All unit and integration tests pass with the new terminology.
- `mock-skill` evaluation runs successfully and produces reports with the new structure.
- Loading legacy `evals.json` files still works.
