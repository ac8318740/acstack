---
name: implement
description: Implement clear requests with adaptive testing and verification under the shared Implementation discipline in orchestrator/AGENTS.md. A map is a stored graph of question and work nodes. Claims afk nodes – away from keyboard, meaning nodes an agent settles alone – from the map frontier, the nodes ready to be worked now, when a map exists; runs the same discipline directly on the request when none does. A unit of work carries its own size – one node is a quick change, forty is a long effort, and nothing declares which. Invoke whenever the way is clear and something needs building, changing or extending, however small. Use quick-fix instead when something is broken and needs a root cause found, and map instead when decisions still need settling before anyone can build.
argument-hint: "[map name, or the request to implement]"
---

## User input

```text
$ARGUMENTS
```

## What this skill does

- Apply the shared Implementation discipline in `orchestrator/AGENTS.md`
- Use a map node as the work item when a map exists, otherwise use the request itself
- Keep tracker claims and resolutions as the progress record
- Choose delegation for confidence or independent scopes rather than a fixed sequence

## Steps

### 1. Find the work

Check the configured tracker for maps (`workflow.maps.tracker` in
`acstack/project.yaml`; the map skill's `trackers/` docs declare the
operations – files backend shown below).

**A map exists** (or `$ARGUMENTS` names one):

```bash
~/.claude/acstack/bin/acstack node frontier --map <name> --mode afk --json
```

On the github backend `--map` refuses – pipe `gh issue list` into `node
frontier --stdin` instead (see the map skill's `trackers/github.md`).

These are the workable nodes: open, unblocked, and containing no decision.
Pull them regardless of depth – work can hang anywhere, including straight
off the root.

Before claiming one, check whether the map is ready to build from:

- If any `fog` node changes the alignment artifact, stop and point the user at
  `/acstack:map`.
- If `workflow.alignment_packs.approval_gate` is true and no reviewer approved
  the alignment artifact, stop and point the user at `/acstack:map`.
- If a `fog` node needs later evidence and does not change the artifact, leave
  it on the map with its reopening trigger.

If the frontier holds only `hitl` nodes – human in the loop, meaning a
person must answer them – stop and point the user at `/acstack:map`. Those
need a human, not a pipeline.

**No map**: the request in `$ARGUMENTS` is the work item. Same discipline,
no tracker writes. This is the whole quick path – a small change is just a
small unit of work, and nothing has to declare it small.

### 2. Read project configuration

Read `acstack/project.yaml` for build/test/lint commands and directory paths.

### 3. Create feature branch

Branch from the default branch, named after the map (or a short slug of the
request). If the branch already exists, ask the user whether to continue on
it or start fresh.

### 4. Orient, then claim

With a map, orient once per session before claiming:

```bash
~/.claude/acstack/bin/acstack node walk --map <name>
```

On the github backend, pipe `gh issue list` into `node walk --stdin` instead
(see the map skill's `trackers/github.md`).

The walk prints the map in one pass: the root and pinned nodes in full,
everything else as a one-line gist.

The root holds the destination. Pinned nodes hold standing preferences –
style rules and constraints that apply to the whole effort.

The resolved chain above a work node – the already-answered questions it
hangs off, followed up to the root – carries its why. Read that chain before
touching code.

Also check `node list --map <name> --status claimed`. A claim marks a node
as work in progress. One left behind by a dead session hides its node from
the frontier forever.

If a claim exists and you know of no other session working it, ask the
user and release it (`--status open`).

Claim each node as you start it:

```bash
~/.claude/acstack/bin/acstack node update <id> --map <name> --status claimed
```

Nodes describe behaviour, not paths. **Resolve paths at claim time**.

Investigate relevant source, callers, tests, and docs directly or through useful delegation.
Pass discovered paths and requirements to any delegated agents to avoid repeated searches.

### 5. Execute within the claim

Apply the shared Implementation discipline to the claimed node or bare request.

- Choose useful checks before nontrivial edits
- Test, implement, format, and verify against requirements
- Get independent review when the shared policy requires it
- Read `design-pass.md` when the design gate is on and configured frontend files changed
- Delegate configured real-browser verification after the required gates pass
- Fix failures and repeat the affected checks
- Release a stalled claim (`--status open`) when the session must stop


**Decision log**: on afk nodes, append one row per decision point to
`<main checkout>/acstack/.decisions/<name>.tsv`. A decision point is a fork chosen, a
unit verified, a revert, or a blocker.

Read `decision-log.md` before the first row. It holds how to find the main
checkout, the columns, and the `.gitignore` the directory needs.

**Parallelism**: use teams when independent nodes benefit from parallel work.
Assign non-overlapping files, and schedule shared-file changes sequentially.

### 6. Resolve

When required verification passes, resolve the node in one call:

```bash
~/.claude/acstack/bin/acstack node update <id> --map <name> --status resolved \
  --append-body "## Answer

<what was built, which files, what the tests pin down>"
```

Write the `## Answer` text per the `writing` skill.

With no map, skip the tracker write – still invoke `record-context` when a
decision landed. With a map, then:

- Invoke `record-context` – implementation decisions can earn ADRs too.
- Classify anything the work surfaced:
    - Agent-clearable fog gets research, tests, or a throwaway prototype.
    - Design-changing fog becomes a `hitl` node and returns to `/acstack:map`.
    - Local fog that does not change the artifact stays inside the claim notes.
- Rebuild or rerun the alignment review when the work changes the artifact.
- Recompute the frontier – resolutions unblock nodes.

### 7. Build verification

After each node (and before ending the session), run the commands from
`acstack/project.yaml`: build, full test suite, lint and typecheck. All must
pass before claiming the next node.

### 8. Completion

Stop when the afk frontier is empty, or when only `hitl` nodes remain (hand
those to `/acstack:map`). With no map, stop when required verification is green.

Report: nodes resolved, tests passing, lines added/removed. Remind the user:
`/acstack:commit` to commit – spec sync extracts the durable record from the
diff.

## Key rules

- Apply `orchestrator/AGENTS.md` as the shared verification policy
- Respect separate test ownership when chosen
- Claim on start, resolve after verification, and release on stall
- Investigate before editing, directly or through useful delegation


- **Resume is a query** – picking up where you left off means asking the
  tracker what is workable now, not reconstructing history. A fresh session
  runs the frontier query and continues. Never re-read an effort end to end
  to find where it stopped.

- **Do NOT commit or push** – the user manages git via `/acstack:commit`.
