# Plan: Remove 'generalist' from evaluator and documentation

## Objective
Remove references to `generalist` as a valid dispatch tool for skill triggering. The `generalist` agent does not specifically trigger skills, so counting it as a trigger event is inaccurate. It should be removed from both the code (`src/core/evaluator.ts`) and the documentation (`README.md`).

## Key Files & Context
- `src/core/evaluator.ts`: Contains the logic to determine if a skill triggered by looking at the dispatch tools.
- `README.md`: Mentions `generalist` as an example of a skill dispatch tool.

## Implementation Steps
### 1. Update `src/core/evaluator.ts`
- In `isSkillTriggered` (structured stats block), change `const dispatchTools = ['activate_skill', 'generalist'];` to `const dispatchTools = ['activate_skill'];`.
- In `isSkillTriggered` (plain text parsing block), change `const dispatchTools = ['activate_skill', 'generalist'];` to `const dispatchTools = ['activate_skill'];`.
- Update the comment `// e.g. "Calling tool: activate_skill", "Tool: generalist", etc.` to remove `"Tool: generalist"`.

### 2. Update `README.md`
- Locate the line: `> - **Minimum requirement:** Permissions to use the skill dispatch tool (e.g., \`activate_skill\` or \`generalist\` for Gemini CLI).`
- Change it to: `> - **Minimum requirement:** Permissions to use the skill dispatch tool (e.g., \`activate_skill\` for Gemini CLI).`

## Verification
- Run `npm run build` to compile TypeScript.
- Run `npm run test:unit` to ensure no tests are broken by this removal.
- Run `npm run test:trigger` to verify basic evaluation logic is intact.