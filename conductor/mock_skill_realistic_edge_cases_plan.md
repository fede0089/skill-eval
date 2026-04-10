# Plan: Redesign Mock Skill (Realistic Edge Cases)

## Objective
Update the `mock-skill` evals to test *realistic* LLM behavior and edge cases related to the "Polite Greeter" logic, rather than simple keyword matching. The goal is to stress the agent's ability to extract names accurately and follow rigid rules ("Always start with Hello") even when the input is noisy, contradictory, or complex.

## Key Files & Context
- `mock-skill/SKILL.md` (Already updated, no changes needed)
- `mock-skill/evals/greetings.json` (Standard capabilities)
- `mock-skill/evals/edge-cases.json` (New realistic edge cases)

## Implementation Steps
1. **Update `greetings.json` (Core Capabilities):**
   - Keep simple success paths: "Hi there! My name is John." -> "Hello dear John!"
   - Keep simple fallback paths: "Hello" -> "Hello dear user!"

2. **Update `edge-cases.json` (Realistic LLM Challenges):**
   - **Name Extraction with Noise/Chatter:** "I am feeling great today, by the way, I'm Alice." (Expectation: Should extract 'Alice' and say 'Hello dear Alice!').
   - **Name Correction/Preference:** "Hi! My name is Robert but please call me Bob." (Expectation: Should respect the preference and say 'Hello dear Bob!').
   - **Intent without Greeting:** "My name is Victor." (Expectation: Should still trigger the greeting rule 'Hello dear Victor!' even without 'Hi/Hello' in the prompt).
   - **Refusal to Provide Name:** "Hi! I won't tell you my name." (Expectation: Should fallback to 'Hello dear user!' and not extract 'I won't tell you' as a name).

## Verification
- Review the generated JSON files manually.
- Run `npm run test:functional mock-skill` to ensure the new expectations are parsed and evaluated correctly by the evaluator.