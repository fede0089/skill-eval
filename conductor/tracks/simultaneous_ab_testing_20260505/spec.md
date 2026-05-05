# Overview
This track implements a feature to allow the `functional` and `trigger` commands to perform simultaneous A/B testing between a local Skill in development and one or multiple historical versions of that same Skill hosted in Git.

# Functional Requirements
1. **User API (CLI):**
   - Add a variadic `--compare-ref [refs...]` flag to the `trigger` and `functional` commands.
   - Base Usage: Evaluate Zero-Skill Baseline vs Local Skill (labeled `local`).
   - Comparative Usage: Evaluate Zero-Skill Baseline, Ref Skills (extracted from provided refs), and Local Skill simultaneously.
2. **Data Model Updates:**
   - Refactor `TaskResult` to support $N$ versions of a skill.
   - `skillTrials` will be a dictionary using version identifiers: `"local"` and `"ref:<ref_name>"`.
   - Update aggregated metrics (`EvalSuiteReport.metrics`) to support dynamic version keys.
3. **Architecture of Isolation ("Two-Step Extraction"):**
   - **Phase 1 (Global Setup):** Validate the `--skill` path belongs to a Git repository. Abort if `--compare-ref` is provided and this fails. Create a temporary directory `.project-skill-evals/skill-refs/<compare-ref>/` for each ref and extract the repository state using `git archive`. If `git archive` fails for any ref, **abort the entire evaluation immediately**.
   - **Phase 2 (Concurrent Evaluation):** Instantiate additional Runners for each historical variant using the temporary paths. The local skill should be evaluated **as-is** (including uncommitted changes).
   - **Phase 3 (Teardown):** Purge the `.project-skill-evals/skill-refs/` directory upon completion or interruption.
4. **Execution and Visualization:**
   - **Concurrency:** Limit concurrent API calls globally using the existing `AgentPool` to ensure the API rate limit is not exceeded regardless of the number of versions.
   - **Dynamic UI:** `table-renderer.ts` must dynamically generate columns for each variant in `skillTrials` showing absolute metrics side-by-side.
   - **Reporters:** Update the JSON Reporter, HTML Reporter, and CLI Table to correctly handle and display the dynamic `skillTrials`.

# Implementation Strategy
- **Vertical Slicing:** The implementation plan MUST be structured into incremental, vertical slices. Each phase should deliver a working, end-to-end (E2E) verifiable increment of the feature rather than building horizontally (e.g., doing all data models first without UI).

# Acceptance Criteria
- [ ] Users can run `skill-eval functional` with `--compare-ref main v1.0` and see three sets of results (local, main, v1.0) compared to the baseline.
- [ ] The evaluation limits global concurrency effectively using `AgentPool` across all skill variants.
- [ ] The CLI Table, JSON Report, and HTML Report all correctly represent the N-version results.
- [ ] The evaluation aborts correctly if `git archive` fails for any provided historical reference.
- [ ] Temporary files in `.project-skill-evals/skill-refs/` are correctly cleaned up after successful and interrupted runs.

# Out of Scope
- Calculating or displaying relative mathematical "Uplifts" between variants in the UI.
- Optimizing Git extraction (we will extract the full repository via `git archive` even if the skill is in a subdirectory).