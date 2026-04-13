# Product Guidelines

## 1. CLI Output Verbosity
**Minimalist:** The CLI should default to minimal, essential output. For deeper debugging or detailed logs, users should be required to pass explicit flags (e.g., `--debug`). This ensures the tool remains non-intrusive when integrated into workflows.

## 2. Error Handling UX
**Actionable Errors:** When errors occur, the CLI must provide clear, human-readable explanations of what went wrong. Furthermore, it should suggest actionable fixes or next steps rather than simply failing silently or dumping raw stack traces.

## 3. Terminal Output Styling
**Rich UI:** The terminal output should leverage a modern feel. Use progress bars, spinners, and vivid colors to clearly indicate status, success, and failures during skill evaluations, making the feedback loop immediate and highly readable.

## 4. Documentation Style
**Self-Documenting Code:** The codebase should prioritize clarity through strong naming conventions and modular design over heavy inline comments. Focus on writing self-evident code, keeping comments reserved for complex logic or non-obvious design decisions.