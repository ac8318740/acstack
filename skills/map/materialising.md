# Materialising a map

Create map nodes with the selected tracker after charting requires persistence.

Read this procedure when [the map skill](SKILL.md#materialising) reaches materialisation, before creating any node.

Pick the tracker (see [Tracker](SKILL.md#tracker)), then create the nodes with its `create`
operation. First the root:

```bash
# files backend – github.md has the equivalent
~/.claude/acstack/bin/acstack node create --map <name> --title "<destination>" \
  --kind destination --label "<at most four words>" --summary "<one sentence>" \
  --body "<the destination, as settled>"
```

- The root is the destination. Pass no `--status` flag, so it opens.

    The root's state follows its subtree. It stays open while any node below
    it is open, fog or claimed. `archive` resolves it when the map clears.
    Nothing else writes the root's status, and the frontier never returns it.

- The root counts as pinned without the flag, and on GitHub it carries the
  `root-node` label. The walk returns pinned nodes in full at the start of
  every session, so every session orients to the root.

- On GitHub, every node body opens with a header line that encodes its edges.
  [`trackers/github.md`](trackers/github.md) holds the format. The files backend writes none.

- Every node carries a required `kind` and `label`, its short diagram name.
  Work nodes and the destination add a one-sentence business `--summary`.
  [`trackers/files.md`](trackers/files.md) holds the kinds, the caps, and the CLI's contract.

- Every node body carries a diagram, two at most. A childless `notes` node is
  the one exception.

    [`visuals.md`](visuals.md) holds which visual each kind gets, where it sits in the body,
    and the rules a hand-drawn one follows. Read it before the first body.

- Standing preferences for the effort become one resolved node. Style rules
  and constraints the grill surfaced go there. Create it with
  `--answers <root id> --kind notes --label "<at most four words>" --pinned`.

- Every other surfaced question becomes a node. Give it `open` or `fog` per
  the fog test.

    Pass `--answers <id>` to name the node whose resolution surfaced it. That
    link is the node's provenance, the trail back to the root. Pass
    `--blocked-by` only where you genuinely cannot settle one node before
    another.

- `mode` defaults to `hitl` – human in the loop, meaning a person answers it.

    A node earns `afk` – away from keyboard, meaning an agent settles it alone
    – only by containing no decision. Research earns it, and so does work
    whose questions are all settled. Get this wrong and an agent quietly
    decides something that was the human's.

- Write every title and body per the `writing` skill.
- Nodes describe behaviour, not file paths. A node can sit on the frontier for
  weeks while the codebase moves – you resolve the paths at claim time.

- Draw every parent's diagram once every node exists, per [Regenerating
  diagrams](SKILL.md#regenerating-diagrams). A parent draws its subtree, so nothing can draw one earlier.
  The root is a parent too, and it draws the whole map.

- When a design is required:
    - Record `Design entry: <repository-relative-path>` in the root node body
    - Bind the entry back to the map with `planning: {tracker: files | github, map: <name>}`
    - Require `design-review status` to return that same `planning` binding before using its approval for this map
    - Record proposals in the node body's `## Design contributions` section using the format in `/acstack:design-doc`
    - Reconcile proposals and saved feedback explicitly; surface conflicts as decision nodes
- On the files backend, the root Git ignore rules exclude `.acstack/maps/` unless the user opts in
  ([`trackers/files.md`](trackers/files.md) gives the reason).
