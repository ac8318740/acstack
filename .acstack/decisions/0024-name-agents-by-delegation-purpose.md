# Name agents by why you delegate, not by persona

ACStack ships three delegation briefs named for their purpose: Investigate (a read-only search that keeps raw discovery out of the lead's context), Review (a clean-context reviewer that sees only the diff and the requirements), and Parallel scope (a worker that owns one independent slice). The task-executor and test-writer agents are removed, and task-checker becomes the Review brief. Research from Cognition and Anthropic shows that parallel writers make conflicting implicit decisions, while read-only investigators, clean-context reviewers, and map-reduce over independent scopes reliably help.

## Considered options

- Keep the persona roles (executor, checker, test-writer, verifier). Rejected: an executor is the lead doing its own work behind another hop, and the roles restated rules owned elsewhere.
- Ship no agent files, only briefs in prose. Rejected: Claude Code, Codex, and pi each load named agents, and a named Review agent makes the pre-commit review repeatable.

## Consequences

- Guidance offers two working modes, Solo and Team, and favors neither
- The three rules that existed only in task-executor and test-writer move into the core Implementation discipline before those agents are deleted
- Codex and pi agent copies, `pi/extension.ts`, and tests change with the agent set
