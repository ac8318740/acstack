---
name: compact-and-continue
description: Anchor the session's load-bearing state so it survives an imminent context compaction, then hand the user a /compact line steered at the work. Writes only what nothing on disk holds – the next action, decisions already made, blockers, file ownership – and references everything else. Invoke before compacting a long session, when the context window is filling and the work must stay in THIS session rather than move to another agent. Model-invocable, because the agent is the only party that can see its own context filling.
argument-hint: "[focus note – what must not be lost]"
---

## User input

```text
$ARGUMENTS
```

Treat the argument as the focus for the session after compaction – the thing
that must survive above all else.

# Compact and continue

Compaction replaces the conversation with a summary. The summary carries the
narrative better than any template, but it is lossy.

A handful of items are too load-bearing to risk losing. This skill writes
those items to an anchor file. A SessionStart hook re-injects the file the
moment the session resumes, so the work continues here rather than moving to
a fresh agent.

## Only the lead session runs this

An agent that another agent launched stops here. One Bash call tells you
whether you are one. Replace `<nonce>` with eight random hex characters, picked
fresh, and never with a value already used in this session:

<!-- lead-check: tests/test-skill-gates.sh extracts and runs the block below -->

```bash
n=acstack-whoami-<nonce>
s="${CLAUDE_CODE_SESSION_ID:-none}"
p="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects"
case "${PI_SESSION_FILE:-}" in
  */run-[0-9]*/session.jsonl|*/forks/*.jsonl) echo "child: $PI_SESSION_FILE"; exit 0;;
  ?*) [ -z "${CLAUDE_CODE_SESSION_ID:-}" ] && { echo "lead"; exit 0; };;
esac
for _ in $(seq 1 20); do
  m=$(grep -lF "$n" "$p"/*/"$s"/subagents/agent-*.jsonl 2>/dev/null </dev/null | head -1)
  [ -n "$m" ] && { echo "child: $m"; exit 0; }
  grep -qF "$n" "$p"/*/"$s".jsonl 2>/dev/null </dev/null && { echo "lead"; exit 0; }
  sleep 0.5
done
echo "lead"
```

`lead` means carry on. `child: <path>` means stop, and tell whoever launched
you that this skill runs only in the lead session. Report your state upward
instead – in your final message, or through your host's agent-messaging tool
(`SendMessage` on Claude Code). The lead then hands off
or compacts.

A child session would write the lead's quiet marker and the shared
`<project folder>/HANDOFF.md` anchor, where the project folder is the path
`~/.claude/acstack/bin/acstack project-data path` prints. Both belong to the lead alone.

Read [`../handoff/lead-check.md`](../handoff/lead-check.md) before you change that command, or when
its answer looks wrong. It says what the command checks and why.

## What the anchor carries

Read [`../handoff/anchor.md`](../handoff/anchor.md) and follow it: reference state rather than copying it, carry the five things only an anchor can, and redact secrets. The anchor lands in the project folder.

## Write the anchor

Write `"$(~/.claude/acstack/bin/acstack project-data path)/HANDOFF.md"`. The frontmatter is **mandatory and machine-read**.
The hook ignores any file without the marker, so it never touches a user's own
unrelated `HANDOFF.md`.

Set `map` to the name of the active map, or to `ad-hoc` when none is active.
Set `created` to the current time, in ISO 8601 UTC. The title repeats the
`map` value.

**Example** – the anchor for a session working the `tracker-backend` map:

```markdown
---
acstack_handoff: 1
map: tracker-backend
created: 2026-08-22T14:05:00Z
---
# ACStack handoff – tracker-backend

## Next action
Fix the two `node frontier` cases in `cli/src/lib/frontier.test.ts` that fail
on a map with no resolved nodes.

## Decisions made
- The files backend ships first. It needs no network, so a fresh clone works
  offline.
- One node type covers both questions and work. Node 14 holds the reasoning.

## Open questions / blockers
- Node 21 waits on the user. Does a resolved node keep its `blocked-by` links?

## Agent-team plan
- Scope A – cli-nodes-opus – own worktree – files: `cli/src/lib/frontier.ts`, `cli/src/lib/frontier.test.ts`
- Scope B – hooks-sonnet – own worktree – files: `hooks/session-start-handoff.sh`
- Shared interface: the `node frontier --json` output shape; Scope A tells Scope B before changing it
- Integration: the lead merges both worktrees and checks CLI and hook wiring before acceptance

## Suggested skills
- implement – the frontier holds three work nodes an agent can settle alone
- record-context – node 14 settled a term the glossary does not hold yet

## References
- Map state: `~/.claude/acstack/bin/acstack node walk` and `~/.claude/acstack/bin/acstack node frontier`
- Files in flight: `git status --short`
```

## Silence the context-pressure nudge

With the anchor written, write the quiet marker. The context-pressure Stop hook
reads the marker and stays silent for the rest of this session. You have
already arranged the compaction, so the hook has nothing left to nudge about:

```bash
d="${ACSTACK_CONTEXT_PRESSURE_DIR:-${TMPDIR:-/tmp}/acstack-context-pressure}"
sid="${CLAUDE_CODE_SESSION_ID:-${PI_SESSION_ID:-}}"; [ -n "$sid" ] && mkdir -p "$d" && : > "$d/$sid.quiet" || true
```

`CLAUDE_CODE_SESSION_ID` (`PI_SESSION_ID` on pi) is this session's own id. If
the variable is unset, skip this step and tell the user the hook keeps nudging,
which is noisy but harmless. `../handoff/lead-check.md` says when the marker clears.

## Hand over the compact line

A skill cannot run `/compact` itself. Write the user a `/compact` line steered
at this work. Name the next action, and anything they flagged in the focus
note.

Tell them to run that `/compact` line, then to type `continue`. The hook
re-injects the anchor and retires it, so the anchor never loads twice.

`<project folder>/HANDOFF.md` holds conversation content. In global mode, the
default, it sits outside the repository. In tracked mode it sits in the main
checkout's committed `.acstack/`, so warn the user not to commit the anchor or
consumed handoffs.

## Notes

- **The reload fires only when the session start source is `compact`**. It
  does not fire on a fresh start, on resuming an earlier session, or after
  clearing the context.

    A stale anchor therefore never leaks into unrelated work. The `handoff`
    skill moves the work to a genuinely new session

- **Consume-once.** The hook retires the anchor as it injects it, moving it to
  `<project folder>/handoffs/<map>/<created>.md` (legacy
  `<project folder>/changes/<name>/handoffs/` when that directory still exists).
  Collisions get a `-2` suffix

- **Subagents and teammates have isolated context.** This protects the
  orchestrator's coordination state, which is the long-lived part. Per-scope
  work does not need it

- The best defence against the compaction wall is delegating aggressively so
  the orchestrator's context window stays lean. This is the backstop
