---
name: quick-fix
description: "Structured workflow for fixing bugs, issues, and broken behavior. Enforces codebase exploration before touching code, root cause analysis, minimal change principle, and full verification. Use when (1) something is broken and needs fixing, (2) behavior is wrong and needs correcting, or (3) user reports a bug. Lighter than a full debug investigation but more disciplined than ad-hoc fixes. Not for new features – use the Implementation Discipline directly."
argument-hint: "<description of what's broken>"
---

# Quick fix

Structured fix workflow: understand -> locate -> root-cause -> fix -> verify.

## Input

```
$ARGUMENTS
```

If `$ARGUMENTS` is empty, ask the user to describe what's broken.

## Before you start

Read the shared Implementation discipline in `orchestrator/AGENTS.md`.
Choose checks and delegation under that policy while investigating the bug.


## Step 1: Understand the problem

Before touching any code:

1. Restate the problem in one sentence. What is the expected behavior vs actual behavior?
2. Classify the problem type:
    - **Crash/error**: Stack trace or error message available
    - **Wrong behavior**: Code runs but produces incorrect results
    - **Regression**: Something that used to work stopped working
    - **Performance**: Too slow, too many resources

If the user provided an error message or stack trace, note the key details (file, line, error type).

## Step 2: Explore the codebase

Investigate directly or delegate when another agent improves confidence:

1. **Locate the code**: Find the files involved, including existing regression coverage

2. **Read the integration points**: Read the broken function's callers and callees, not just the function:
    - What calls this code? (upstream)
    - What does this code call? (downstream)
    - What data flows through it? (inputs/outputs)
    - Are there tests covering this behavior?

3. **Check recent changes**: If this is a regression, run:
   ```bash
   git log --oneline -20 -- <file>
   ```
   to see if a recent commit introduced the problem.

Produce a brief exploration summary:

```
Files involved: <list>
Integration points: <upstream -> target -> downstream>
Existing tests: <list or "none">
Recent changes: <relevant commits or "none suspicious">
```

## Step 3: Root cause analysis

Based on the exploration, identify the root cause – not just the symptom.

Bad: "The function returns null" (symptom).
Good: "The function returns null because the query filter uses `org_id`, but the test user's org isn't in the result set" (root cause).

If the root cause remains unclear, investigate further or seek independent help rather than guessing.

## Step 4: Plan the fix

Before coding, state:

1. **What** will change (which file(s), which function(s))
2. **Why** this fixes the root cause (not just the symptom)
3. **What won't change** (confirm the fix is minimal – no drive-by refactors)

If the fix touches more than 3 files, pause. Confirm the scope with the user – the fix may be bigger than a quick fix.

## Step 5: Implement via the Implementation discipline

Apply the shared policy to the minimal fix.

- Reproduce the bug with a failing regression test before fixing it when practical
- Confirm the intended failure, then implement the fix
- Explain any departure from tests-first work
- Preserve regression protection and separate test ownership when chosen
- Follow `../implement/design-pass.md` when its frontend design gate applies


## Step 6: Verify

Run build verification using commands from `.acstack/project.yaml`:

```bash
# Run the project's configured test, lint, and typecheck commands
# Read these from project.yaml – do not hardcode
```

Use the configured frontend gates under the shared policy.
Do not proceed with failed required checks or unverified configured browser behavior.


## Step 7: Report

```
=== Quick Fix Complete ===

Problem: <one-line description>
Root cause: <what was actually wrong>
Fix: <what changed and why>
Files modified: <list>
Verification: <actual commands and results>
Blocked checks: <checks that could not run and why, or none>
Missing regression protection: <behavior left unprotected, or none identified>
Remaining risks: <known risks and uncertainty, or none identified>
```

Remind the user to `/acstack:commit` when they're satisfied.
