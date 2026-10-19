# Pre-commit review: auto-fix mode

Step 6 of `SKILL.md` in auto-fix mode.

For each finding (MUST first, then SHOULD, then CONSIDER):

1. Apply the shared Implementation discipline in `orchestrator/AGENTS.md` to the finding, directly or through a task-executor
2. Verify the fix doesn't break anything (run lint, typecheck, and test commands from project.yaml)
3. If fix breaks something, revert and try alternate approach
4. Move to next finding

After all fixes, run full verification using commands from `.acstack/project.yaml`:

```bash
# Run the project's configured test, lint, and typecheck commands
# Read these from project.yaml – do not hardcode
```

Report a summary of the fixes.
