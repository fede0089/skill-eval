# Plan: Redesign Mock Skill (Polite Greeter)

## Objective
Update the `mock-skill` to have a more realistic and cohesive purpose ("Polite Greeter") to properly demonstrate the new multi-file evaluation capability.

## Key Files & Context
- `mock-skill/SKILL.md` (Update skill description and instructions)
- `mock-skill/evals/greetings.json` (New: core capabilities)
- `mock-skill/evals/edge-cases.json` (New: regressions and boundary tests)
- `mock-skill/evals/evals.json` (Delete)
- `mock-skill/evals/evals2.json` (Delete)

## Implementation Steps
1. **Delete Old Evals:** Remove `evals.json` and `evals2.json` from `mock-skill/evals/`.
2. **Update SKILL.md:** Rewrite instructions to define a "Polite Greeter" skill with explicit rules:
   - Always start responses with "Hello".
   - If the user provides a name, say "Hello dear <name>!".
   - If no name is provided, say "Hello dear user!".
3. **Create `greetings.json`:** Define standard evaluation tasks (e.g., user provides name vs. user provides no name).
4. **Create `edge-cases.json`:** Define boundary tasks (e.g., irrelevant queries like "What is the capital of France?", or weird usernames).

## Verification
- Run `npm run test:trigger mock-skill` to ensure the skill triggers properly for greetings and ignores irrelevant queries.
- Run `npm run test:functional mock-skill` to verify that both `greetings.json` and `edge-cases.json` pass their expectations and are loaded correctly.