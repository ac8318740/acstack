# Pre-commit review: auto-fix mode

Step 4 of `SKILL.md` in auto-fix mode.

Fix the findings you kept (MUST first, then SHOULD, then CONSIDER). Adjacent cleanup
stays advisory unless the user approves it; auto-fix is not approval to expand scope.

1. Apply the shared Implementation discipline in `orchestrator/AGENTS.md`
2. Run focused checks for the fix and affected behavior
3. If the fix breaks something, revert only your own conflicting changes and try another approach
4. Move to the next finding

One verification owner gathers required completion evidence for the final revision,
reusing valid results under Build verification in `orchestrator/AGENTS.md`.
Do not repeat all completion commands for every finding.
Approved adjacent work may run in parallel in its own checkout (Team mode in
`orchestrator/AGENTS.md`), without blocking the main change.

Report fixes, evidence, blockers, and advisory suggestions separately.
