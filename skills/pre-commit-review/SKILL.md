---
name: pre-commit-review
description: "Clean-context review of uncommitted changes before commit. Collects the diff and the requirements, launches a `reviewer` agent that sees only those, then the author filters its findings against what the user asked and fixes the ones that stand. /acstack:commit invokes it for nontrivial changes not yet reviewed; it can also run on its own. Use --auto-fix when working autonomously; otherwise it consults the user."
argument-hint: "[--auto-fix] [scope description]"
---

# Pre-commit review

Review before commit in `orchestrator/AGENTS.md` owns the protocol: when review runs, what the reviewer sees, and who filters. This skill is the procedure.

## User input

```text
$ARGUMENTS
```

## Mode

- **Auto-fix**: the arguments contain `--auto-fix` or ask to fix everything, or you are working autonomously and decided to commit yourself. The user is likely away, so do not block on questions
- **Interactive** (default): the user invoked this skill or `/acstack:commit`. When in doubt, use interactive

## Step 1: Collect the review surface

```bash
git diff HEAD
git status --short
```

Include untracked files the change adds. Gather the requirements: the user's request, the map node or task acceptance criteria, and any brief you worked from.

If the change is trivial (typos, formatting, other nonbehavioral edits), say so and stop.

## Step 2: Launch the reviewer

Launch the `reviewer` agent (see `docs/host-tools.md` in the plugin root). Give it only:

- The diff and the list of changed paths
- The requirements, quoted as written
- Known risks and any check results you already have, with the command and revision

Do not send your plan, your reasoning, or the conversation; a clean context is the point.
If no subagent can launch, review the change yourself against `agents/reviewer.md`, and report that the review was not clean-context.
For a change that `orchestrator/AGENTS.md` says always needs this review (security boundaries, money, irreversible data), a self-review does not count: report the block.

## Step 3: Filter the findings

You know what the user asked; the reviewer does not. For each finding:

- **Keep** it when it is a real defect or affects what the user asked for
- **Decline** it with a one-line reason when it is wrong or outside the request
- **Ask** the user when keeping it would change what they asked for

Adjacent cleanup stays advisory and needs the user's approval before any edit, in both modes.

## Step 4: Fix

- **Auto-fix**: read `auto-fix.md` and follow it
- **Interactive**: read `interactive.md` and follow it

Report the reviewer's verdict, the findings you kept, the ones you declined with reasons, and the advisory list.
