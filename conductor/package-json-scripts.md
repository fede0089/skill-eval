# Objective
Update `package.json` scripts to include proper test commands for both `trigger` and `functional` evaluation commands using the `./mock-skill`.

# Key Files & Context
- `package.json`

# Implementation Steps
1. Modify `package.json` to replace the existing `test` script.
2. Add a `test:trigger` script: `"npm run build && node ./dist/index.js trigger --skill ./mock-skill"`
3. Add a `test:functional` script: `"npm run build && node ./dist/index.js functional --skill ./mock-skill"`
4. Update the `test` script to run both: `"npm run test:trigger && npm run test:functional"`

# Verification & Testing
1. Run `npm run test:trigger` and verify it executes properly.
2. Run `npm run test:functional` and verify it executes properly.
3. Run `npm test` and verify both commands are executed sequentially without errors.