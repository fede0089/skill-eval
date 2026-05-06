# Phase 1: Single Historical Reference Comparison (E2E Vertical Slice)
*Goal: Minimum viable A/B test. A user can evaluate the local skill against ONE historical reference (`--compare-ref <ref>`), with results displayed in the CLI Table. This requires end-to-end integration of data models, Git extraction, and runner instantiation.*
- [x] Task: Refactor TaskResult and CLI commands to support the new skillTrials dictionary and parse the --compare-ref flag. (cc5a35e)
    - [x] Write Tests
    - [x] Implement
- [x] Task: Implement Two-Step Extraction (`git archive`) to isolate the historical reference. (67e32cd)
    - [x] Write Tests
    - [x] Implement
- [x] Task: Integrate the AgentRunner to evaluate the extracted ref and update `table-renderer.ts` to display local vs ref results. (5b680c3)
    - [x] Write Tests
    - [x] Implement
- [x] Task: Conductor - User Manual Verification 'Single Historical Reference Comparison (E2E Vertical Slice)' (Protocol in workflow.md) (070b9c0)

# Phase 2: N-Version Comparison & Concurrency Limits
*Goal: Extend the evaluation to support multiple historical references simultaneously (`--compare-ref ref1 ref2`) while strictly adhering to API rate limits via the `AgentPool`.*
- [x] Task: Update extraction and runner loops to handle $N$ references concurrently. (4373081)
    - [x] Write Tests
    - [x] Implement
- [x] Task: Enforce global concurrency limits across all skill variants using `AgentPool` to prevent rate-limiting. (4373081)
    - [x] Write Tests
    - [x] Implement
- [ ] Task: Conductor - User Manual Verification 'N-Version Comparison & Concurrency Limits' (Protocol in workflow.md)

# Phase 3: Reporters Update & System Robustness
*Goal: Complete the feature by updating all output formats (JSON/HTML), ensuring robust error handling (aborting on Git failures), and implementing post-run teardown cleanup.*
- [ ] Task: Refactor `json-reporter.ts` and `html-reporter.ts` to process and display dynamic version keys.
    - [ ] Write Tests
    - [ ] Implement
- [ ] Task: Implement strict error abortion for `git archive` failures and ephemeral directory cleanup (`.project-skill-evals/skill-refs/`).
    - [ ] Write Tests
    - [ ] Implement
- [ ] Task: Conductor - User Manual Verification 'Reporters Update & System Robustness' (Protocol in workflow.md)