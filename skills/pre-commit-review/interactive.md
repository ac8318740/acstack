# Pre-commit review: interactive mode

Step 6 of `SKILL.md` in interactive mode, the default.

Present in-scope findings in **waves of up to 4** using the question tool (AskUserQuestion on Claude Code). On a host without one, use a numbered list in chat. Group related findings together.

Keep adjacent suggestions in a separate advisory list, not the required fix waves.
If one is worth pursuing, ask for explicit approval to add it to scope. "Fix all"
for the main review does not include that advisory list. Approved cleanup may run
in parallel with non-overlapping ownership or isolated worktrees, without delaying
the main change.

Format each wave like:

```
I found these issues in your changes. For each, choose: FIX / SKIP / DISCUSS

1. [MUST | HARDCODE] `path/to/file.py:42`
   Hardcoded timeout value `30` – should use config constant.
   Suggested fix: Move to config, reference from there.

2. [SHOULD | SSOT] `path/to/api/client.ts:15`
   Duplicated error handling pattern – same try/catch in 3 functions.
   Suggested fix: Extract shared wrapper function.

3. [SHOULD | READABILITY] `path/to/component.tsx:88`
   The new helper exposes parsing state its caller should not need.
   Suggested fix: Return the parsed result and keep parsing state internal.

4. [SHOULD | EDGE-CASE] `path/to/manager.py:120`
   No null check on response before accessing `.status`.
   Suggested fix: Add guard clause with appropriate error.

Reply with numbers to fix (e.g., "1,2,4") or "all" or "skip all", and any notes on approach.
```

After user responds:

- Fix selected items under the shared Implementation discipline in `orchestrator/AGENTS.md`, directly or through useful delegation
- Present next wave if more findings remain
- Continue until all in-scope findings are addressed or the user says "done" / "skip the rest"
- Use focused checks while fixing; one verification owner gathers final completion evidence under the shared policy, reusing valid results
