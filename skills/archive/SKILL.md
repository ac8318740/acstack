---
name: archive
description: Close out a cleared map – one whose frontier is empty with no fog and no claims left – by verifying the durable residue, meaning what the effort leaves behind in living specs, ADRs and the glossary, was extracted, then closing the root and disposing of the nodes per workflow.maps.persist. Invoke when a map has just been cleared, when the last node on a map resolves, or when the user asks to archive or close out a map. Refuses and asks first if anything is still open. Also archives legacy .acstack/changes/ directories from the pre-map workflow.
argument-hint: "[map or legacy change name]"
---

## User input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Purpose

Archive verifies implemented specs, durable decisions, and retained review evidence before closing the root and disposing of temporary map nodes.

## Step 1: Locate the map

If `$ARGUMENTS` names a map, use it. Otherwise list maps on the configured
tracker (`workflow.maps.tracker`): `ls .acstack/maps/` on the files backend,
`gh label list --search "map:" --json name` on GitHub.

If exactly one, use it. If several, ask. If `$ARGUMENTS` names a legacy
`.acstack/changes/` directory instead, jump to Legacy below.

## Step 2: Verify no open work remains

A map counts as cleared when nothing remains to work – no open nodes, no
fog, no claims. Check all three on the files backend:

```bash
~/.claude/acstack/bin/acstack node list --map <name> --status open --json
~/.claude/acstack/bin/acstack node list --map <name> --status fog --json
~/.claude/acstack/bin/acstack node list --map <name> --status claimed --json
```

On GitHub, compose the same checks per `trackers/github.md` in the map skill.
`gh issue list --label "map:<name>" --state open` must come back empty, or
hold the issue labelled `root-node` alone. Any other open issue is open, fog
or claimed, and all three fail the gate.

Never run the files commands against a GitHub-tracked map. They come back
empty because the directory does not exist, so the gate would pass on no
evidence.

All three must come back empty, apart from the root.

The root is the map's one node with no `answers`, and on GitHub it carries the
`root-node` label. It stays open until Step 4 closes it. Ignore it in all
three lists – a list holding the root alone still passes the gate.

Count open nodes directly rather than through the frontier query, because the
frontier only lists nodes with no unresolved blockers. Two nodes that block
each other show an empty frontier while both questions stay open. An empty
frontier is therefore no proof of a cleared map.

If anything remains, stop and list the fog, open questions, or claims.
Ask the user to resolve them or explicitly mark dropped scope out of scope before retrying.
Do not dispose of an uncleared map.

For a bound design, read the root's `Design entry` reference and run:

```bash
~/.claude/acstack/bin/acstack design-review status <entry>
```

- Require returned `planning.tracker` and `planning.map` to match the map being archived
- Stop on a missing or different binding; another map's approval does not authorize this archive
- Require `approval.valid: true` for the current exact revision tuple
- Require completed reconciliation of saved feedback and current map contributions
- Return invalid approval or unresolved reconciliation to `/acstack:design-doc`
- Recheck after source, saved comments, or contribution inputs change
- Never promote historical approval or migrate legacy data during archive

## Step 3: Extract the residue

Walk the resolved nodes – read them in order, root first, then each node that
hangs off it. On the files backend, run `acstack node walk --map <name> --full`.
On GitHub, compose the walk per `trackers/github.md`.

Check each resolution left what it should have:

1. **Living specs** – behaviour the effort built should already be in
   `.acstack/specs/` via commit-time sync. Spot-check the affected domains.

   Verify against source and verification evidence, not proposals copied from map nodes.
   Fix gaps on sight per the Spec Correction Protocol.

2. **ADRs and glossary** – apply `record-context`'s existing tests to unrecorded decisions.
   An ADR requires a hard-to-reverse, surprising decision with a real trade-off.
   A glossary entry requires an agreed term; neither is the common outcome.

3. **Scope and provenance** – record dropped scope, unresolved limits, and reopening conditions before disposal.
   Keep durable node identities and their provenance with the affected specs or decision records.

   Preserve enough context to trace implemented behavior back to its decisions without retaining proposals as requirements.
   Stop if unresolved scope still needs a decision rather than an explicit out-of-scope resolution.

4. **The decision log** – read `<main checkout>/.acstack/decision-logs/<name>.tsv`
   if it exists. The main checkout is `dirname` of `git rev-parse
   --path-format=absolute --git-common-dir`.

    afk runs append one row per decision an agent made alone. Hand each
    lasting decision to `record-context`. A later row supersedes an earlier
    one it contradicts.

## Step 4: Close the root

The root carries no status of its own – it stays open while any node below it
still needs work. Step 2 proved nothing does. Resolve the root now.

```bash
# files backend
~/.claude/acstack/bin/acstack node update <root id> --map <name> --status resolved

# github backend
gh issue close <root issue number> --reason completed
```

A root the map already resolved or closed stays that way. Never reopen it.

## Step 5: Dispose of the nodes

**Confirm first when you invoked this yourself.** A user who typed
`/acstack:archive` has already asked for disposal – proceed.

If you reached this skill on your own after a map cleared, name what you
will delete or move. Then wait for the user's go-ahead. Deletion is
irreversible and they never asked for it.

`workflow.maps.persist` in `.acstack/project.yaml` decides (default `false`):

| Value             | Action                                                       |
| ----------------- | ------------------------------------------------------------ |
| `false` (default) | delete `.acstack/maps/<name>/`                                 |
| `true`            | move the nodes to `.acstack/archive/[YYYY-MM-DD]-[name]/nodes/` |

Default is delete because keeping the nodes leaves a second copy of every
decision, and the two drift. On the GitHub tracker there is nothing to
dispose – closed issues are already the archive.

Retain these records independently of `workflow.maps.persist`:

- Authored design entries and referenced source files
- Canonical `review.json` files, posted feedback, reconciliation, and exact-revision approval evidence
- Imported legacy history and original `.acstack/alignment-packs/` artifacts
- Main-checkout `.acstack/decision-logs/<name>.tsv` files
- Handoffs that contain review evidence or provenance not retained elsewhere

Never recursively delete alignment, review, decision-log, or handoff directories as archive cleanup.
Do not invoke a cleanup helper that erases those records.

If a retained source or review record sits inside the proposed node disposal path, stop and resolve its safe retention first.
Respect native Git ignore rules; never force-add private records.

## Step 6: Report

- Nodes resolved / out-of-scope counts
- Residue: domains spot-checked, ADRs and glossary entries written
- Disposal: node deletion or archive path, plus retained review evidence and provenance
- Reminder: commit with `/acstack:commit`

## Legacy: archiving a `.acstack/changes/` directory

The pre-map workflow created changes that hold proposal.md, design.md and
tasks.md. They still archive the old way, so an upgrade never strands work:

1. Read the change's artifacts. Derive the affected domains from the file
   paths in `tasks.md` via `.acstack/domain-map.yaml`.

2. For each domain, merge what the feature ADDED, MODIFIED or REMOVED into
   `.acstack/specs/[domain]/spec.md`.

3. Write a `delta.md` into the change directory.

    Then run the CLI's `acstack archive <name>`. It moves the artifacts,
    delta included, to `.acstack/changes/archive/[YYYY-MM-DD]-[change-name]/`.
    It also removes the change from `.acstack/changes/`.
