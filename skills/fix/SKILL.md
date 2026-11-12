---
name: fix
description: "Find the root cause of something broken, then route the fix. Use when something is broken, behaves wrongly, or the user reports a bug. It reads the integration points before touching code, names the root cause rather than the symptom, and pauses when the fix spreads. Size is not implied: the fix then runs through implement, or through grilling or a map when it raises decisions. Not for new features; use implement."
argument-hint: "<description of what's broken>"
---

# Fix

Find the root cause, then hand the fix to the route it needs.

## Input

```
$ARGUMENTS
```

If `$ARGUMENTS` is empty, ask the user to describe what's broken.

## Step 1: State the problem

Restate it in one sentence: expected behavior against actual behavior. Note the file, line, and error type from any error message or stack trace.

## Step 2: Read the integration points

Investigate directly or delegate under the shared Implementation discipline in `orchestrator/AGENTS.md`. Read the broken code's surroundings, not just the function:

- What calls it (upstream), and what it calls (downstream)
- What data flows through it
- Which tests cover this behavior
- For a regression, recent commits: `git log --oneline -20 -- <file>`

## Step 3: Name the root cause

Name the cause, not the symptom.

- Symptom: "The function returns null"
- Root cause: "The function returns null because the query filters on `org_id`, and the test user's org is not in the result set"

If the cause stays unclear, investigate further or get independent help rather than guessing.

## Step 4: Route the fix

State what will change, why that fixes the root cause, and what stays unchanged.

- **Pause when the fix spreads** past three files or into behavior nobody asked about. Confirm the scope with the user first
- **Decisions to settle** (which behavior is correct, or a trade-off) go to the `grilling` skill, or `/acstack:map` when they outlive the session
- **Otherwise** implement the fix under `/acstack:implement`. Reproduce the bug with a failing regression test first when practical

Report the root cause alongside the implement report.
