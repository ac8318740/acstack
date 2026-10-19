---
name: map
description: The entry point for planned work. A map is a graph of question and work nodes. Charts one if none exists – an opening grill, meaning a round of interview questions, that fixes the destination and surfaces the fog, meaning what cannot yet be stated precisely – and works the frontier, the nodes ready to be worked now, if one does. No tiers and no routing – the graph is however big the fog made it, and nothing declares which. Invoke whenever decisions need settling before work can start, the request is foggy or underspecified, or a map already exists and has open nodes. Use implement instead when the way is already clear.
argument-hint: "[map name, or the request to chart]"
---

## User input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

# Map

## Tracker

Nodes live behind a pluggable tracker. A backend declares four operations –
create, read, update, list. ACStack builds everything else from those four:
frontier, claim, resolve and walk.

Two backends ship in this skill's directory: `trackers/github.md` for repos
with GitHub auth, and `trackers/files.md` as the fallback.

`workflow.maps.tracker` in `.acstack/project.yaml` (`github` or `files`) records
the project's choice. If the key names a backend, read the matching doc and use
its operations. If the key is absent, pick at materialisation time – the moment
you first write the map's nodes down.

Recommend `github` when the repo qualifies, `files` otherwise. Confirm the
choice with the user. Then write the key, so later sessions need not re-decide.
## Which mode

One command runs two modes, and what already exists picks between them. Check
the configured tracker for existing maps – `ls .acstack/maps/` on the files
backend, `gh label list --search "map:" --json name` on GitHub.

If `$ARGUMENTS` names a map, or exactly one exists, work its frontier – the
nodes ready to work now. If none exists, chart. If several exist and
`$ARGUMENTS` does not pick one, ask.

There are no tiers. One question is a small map or no map. Fifty questions is
still one map.

## Charting

1. **Fix the destination first.** Grill for what done looks like (invoke the
   `grilling` skill). The destination is the root of everything that follows –
   settle it before any other question.

2. **Load the frontend branch on a frontend destination.** `frontend.md`
   beside this skill holds five more rules. Read it when the destination
   touches `frontend.directory`, the path in `.acstack/project.yaml` where the
   frontend lives. Every other map skips it.

3. **Open with a breadth-first grill.** Work the conversation frontier in
   rounds per the grilling skill. Explore the codebase for facts as you go –
   facts are your job, never the user's. Try a throwaway prototype before you
   ask the user anything (grilling's "Run it before you ask it").

4. **Apply the fog test to what surfaced.** A question you can state precisely
   now is `open`. One you cannot state is `fog` – record it without forcing it
   sharp. The test is whether you can *state* the question precisely, not
   whether you can answer it.

5. **Classify fog.** Read `alignment.md`. Blocking fog changes the design.
   Deferred fog does not.

### Progressive materialisation

Before deciding whether the map must persist:

- Invoke `/acstack:design-doc` for shared behavior, component boundaries, or data-flow decisions
- Apply that condition to conversation-only work as well as persisted maps
- Skip design documents when those decisions are absent, including pure copyediting
- When a design is required, require current design approval before implementation; changed source or contribution inputs reopen review

The machinery appears only when it must persist. After the opening grill:

- **No fog surfaced** – say so and proceed to the work
- **At most one session's worth** – settle it in conversation and invoke
  `record-context` on each decision
- **More than one session's worth** – materialise the map and work the frontier
  across sessions

The test is mechanical. Will the fog outlive this session?

### Materialising

Read [materialising.md](materialising.md) and follow its full procedure before creating map nodes.

## Working the frontier

All commands below are the files backend's shape – on GitHub, compose the
same queries per `trackers/github.md`.

Before step 1, copy the bold title of each numbered step below into your todo
list word for word, ahead of any task-specific items. A step you skip stays in
the list, marked `skip: <reason>`.

1. **Orient.** The packaging walk (`acstack node walk --map <name>`) – the root
   and pinned nodes in full, everything else gisted, meaning title and status
   only. Zoom in with `node read <id>` when a gist matters – it drops the
   generated diagram blocks, and `--visuals` puts them back. Do not load
   every body.

    Also check `node list --map <name> --status claimed`. A claim marks a node
    someone is working, so a dead session's claim hides it from the frontier
    forever. If a claim exists and you know of no session working it, ask the
    user and release it (`--status open`).

2. **Query the frontier.** `acstack node frontier --map <name>` – open nodes
   with no unresolved blockers, shallowest provenance depth first, number
   only as a tiebreak. Provenance depth is how many `answers` links separate
   a node from the root, so the broadest questions come first. The query never
   returns the root.

3. **Route by `mode` – the only field the machine routes on** (`kind` picks
   the node's diagram shape, never its route):
    - `hitl` nodes: run grilling rounds over them. A round is the whole hitl
     frontier.
    - `afk` nodes: claim and run without the user. Choose direct work or useful delegation
     under the shared Implementation discipline in `orchestrator/AGENTS.md`.

     Implementation work follows `/acstack:implement`'s procedure – it owns
     the claim-execute-resolve flow and adaptive verification. Do not restate that flow here. Invoke it.

4. **Claim, then resolve** – `afk` nodes only. A `hitl` resolution happens
   inside the grilling round, with no claim step. Both are compositions over
   `update`:

   ```bash
   ~/.claude/acstack/bin/acstack node update <id> --map <name> --status claimed
   ~/.claude/acstack/bin/acstack node update <id> --map <name> --status resolved \
     --append-body "## Answer

   <what was decided or done, and why>"
   ```

   Work stays inside the claim, with no per-phase bookkeeping. If the work stalls or fails, release the claim
   (`--status open`) and the node is plainly open again.

5. **After every resolution**, in order:
    - Invoke `record-context`
    - Create nodes for anything the resolution surfaced
    - Classify new fog by whether it changes the design
    - Create the critique node when the resolved node changed the frontend,
      per `frontend.md`
    - Regenerate the diagram on the resolved node's parent (see Regenerating
      diagrams)
    - Reopen design review when source, saved comments, or contribution inputs change
    - Recompute the frontier

    The regeneration comes after the new nodes exist. A surfaced node hangs
    off the node you just resolved, inside that same subtree.

    A shallow node arriving late jumps the queue – that is correct, something
    big just opened up.

6. **Graduate fog as it sharpens.** When you can state a fog node precisely,
   run `update <id> --status open` – one field, one write. Rewrite the title
   and body to the sharp statement if they drifted.

Never filter on leaf position or "has a resolved question above it". Work
nodes can hang anywhere, including straight off the root – a bug is work with
no question above it.

## Regenerating diagrams

A parent's diagram draws its subtree, so any status change below it leaves
that diagram wrong. Regenerate on the resolved node's parent after every
resolution, and on every parent at each frontier recompute. The map skill's
`visuals.md` holds the commands and the write rules (Regenerating a parent's
diagram).

## Done

The map clears when the frontier is empty and no fog remains. Deferred fog can
let implementation start, but archive still needs an answer or an out-of-scope
resolution.

The durable residue is what the map leaves behind – the living specs through
commit-time sync, the ADRs and glossary entries through `record-context`. You
have already extracted it along the way.

Report what the map settled. Point at anything the map left `out-of-scope`.

Then invoke `archive` to close the map out. It re-checks the gate itself and
refuses if anything is still open. It verifies the residue actually landed,
resolves the root, and asks before disposing of the nodes.
