---
name: design-doc
description: Author a design doc on a map and review it through a live local or SSH connection that saves comments for the agent and answers back to the map.
---

# Author and review a design doc

A design doc is drawn from a map. Each design element is its own map node, and the map is the only source. The browser view supports drill-down, questions beside the elements they target, and feedback saved on the agent's device.

```mermaid
flowchart LR
    A[Agree on the design scope] --> B[Write element nodes on the map]
    B --> C[Check, then review in the browser]
    C -->|contradiction| B
    C --> D[Reviewer comments and answers]
    D --> E[Reconcile comments]
    D -->|answers resolve question nodes| F[Pick up follow-ups at the next frontier]
    F --> B
    E -->|revise| B
    E -->|ready| G[Approve the exact revision]
    G --> H[Implement and retain review evidence]
```

## Agree on the design scope

- Read the writing and visual-docs skills before authoring prose
- Inspect the source to establish current responsibilities
- Ask the user about unresolved product decisions before inventing behavior
- Distinguish existing behavior from proposed changes throughout the document
- Open the root body with a ten-second synthesis of the whole proposal: what changes, how it works, consequential limits, trade-offs, and decisions needed
    - Make this standalone account understandable to an adult without project context
    - State limits directly; remove rhetorical framing and "X, not Y" contrast formulas
- Use the worked journey to show who does what and where the proposal changes today's flow
- Use `examples/design-doc/acstack/maps/acstack-design/` as the worked example

## Write element nodes on the map

A design doc belongs to one map. Use `/acstack:map` to chart it if none exists.

- Create one node per design element with `kind: element`
    - Its `label` is the name the diagram draws
    - Its `summary` is the element's standalone responsibility, not a code fragment or a list of implementation steps
    - Its body prose is the element's detail; the config block below holds its structure
- Approving the design approves every element, and an approved element is a requirement
    - The CLI's warnings and status call an approved element `locked` and an unapproved one `loose`; the viewer shows neither
    - Create elements open
    - **Never lock or approve an element on your own.** Do it only on the user's explicit instruction in conversation, after reporting what changed, with `~/.claude/acstack/bin/acstack design-review approve-element <map> <id>`
    - When the element has a mock with several variants, add `--variant <mock path>=<variant id>` for each, naming the variant the user chose (for example "approve variant 2"); its tweaks take their defaults
    - Otherwise only the user approves, by approving the design; there is no per-element lock in the viewer
    - You may edit an approved element. Approval records a digest of each element's config, title, name, summary, and detail (not the generated diagram block), so an edit unapproves the element: it shows "Changed since approval" with Re-approve and stops being a requirement
    - The tracker node stays resolved; the digest alone marks the element as changed until the user re-approves it
- Elements never appear on the frontier. Questions about them do
- Put the element's config in one collapsed block, so the node stays readable on GitHub:

````markdown
<details>
<summary>Design element</summary>

```yaml
kind: component        # actor | component | store | external-system
parent: "003"          # optional: the element that contains this one
channels: [cli, web]   # optional
connections:           # each connection declared once, on the acting element
    - to: "007"
      direction: one-way # one-way | bidirectional
      label: Reads design source
```
</details>
````

- Choose `kind` from `actor`, `component`, `store`, or `external-system`
    - An actor participates from outside the system, such as a person or an external autonomous agent
    - An agent built into the system is a component
- Use `parent` only for genuine containment, not dependencies or shared concerns
    - Each component represents one entity, shown as either a collapsed card or an expanded container, never both
    - Let nesting express containment without a duplicate "Contains" arrow
    - Never connect an ancestor and its descendant; nesting already expresses containment
    - Show interactions between the responsible components rather than between a container and its contents
- Declare each connection once, on the element that acts
    - Read every arrow as source → verb → target: `Checkout CLI → Reads → Order files`
    - Reading files points from the reader to the store, not along the returned data
    - Use a second connection, declared on the other element, when the opposite action needs a different label
    - Use `bidirectional` only when the same label describes both directions
- Use `channels` for software interfaces: `web`, `mobile`, `desktop`, `cli`, `agent`, `email`, `sms`, and `voice`
    - Put interface labels on the software that provides them, not on an actor that uses them
- Reference elements by node id. Quote ids so YAML keeps them as text
- Keep peer elements at comparable levels of abstraction, and model only real entities
- Put supporting explanations under nested, literal Markdown headings that name their contents
    - Each level summarizes its children; keep the opening synthesis before the first heading so it stays visible
    - The viewer folds H1-H6 sections through the next same-level or higher-level heading; skipped levels nest under the nearest parent
- Element and root prose support Markdown, GFM tables, fenced Mermaid diagrams, and nested `<details>` sections
    - Leave blank lines around Markdown inside HTML disclosure sections
    - Mermaid renders offline in an isolated frame; scripts and unsafe HTML are stripped

### Mocks on an element

Give an element concrete mocks, flows, and sample data under `mocks:` in its config block. The reviewer opens them from the Mocks tab.

```yaml
mocks:
  - title: Checkout page      # optional; defaults to the path
    od: {design: checkout, page: home}
  - html: checkout.html
    illustrative: true        # an illustration, not a requirement
  - markdown: journey.md
  - mermaid: flow.mmd
  - fixture: order.json       # or a .csv file
    schema: order.schema.json # optional JSON Schema
```

- Each entry names exactly one kind: `od`, `html`, `markdown`, `mermaid`, or `fixture`
- Keep mock files in the element folder, `<project folder>/maps/<map>/elements/<element-id>/`
    - Paths are relative to that folder and never leave it
    - Never use a top-level `designs/` folder
- Prefer OpenDesigner for UI mocks. `od` names an OpenDesigner design and one of its pages
    - The review server builds it with `open-designer build <design> --page <id>` each time the reviewer opens it
    - Give a loose element's mock at least two variants, so the reviewer can compare different options
    - Use inline HTML only when OpenDesigner is not installed or a single static page is enough
- Type fixtures with JSON Schema, unless the code that reads them is untyped
    - Fixtures show structure, not volume: keep each one under 20 KB
    - OpenDesigner pages import the same fixture file as props, so keep one copy in the element folder
- Every mock on a locked element is a requirement unless it sets `illustrative: true`

### Design-wide config on the root

The root's title and summary name the design. Its body is the overview and worked journey. Put cross-element requirements in a `Design doc` block:

````markdown
<details>
<summary>Design doc</summary>

```yaml
concerns:
    - id: offline-review
      name: Offline review
      elements: ["007", "008"]
      requirement: Reviewers can inspect the design without uploading project details.
      response: The server embeds validated graph data with bundled browser assets.
```
</details>
````

- Name at least two affected elements per concern
- Keep kind, concern, and channel separate: what an entity is, what requirement spans entities, and how interactions occur

### Questions for the reviewer

A question targets an element when its `answers:` parent is that element node.

- A hitl question that targets an element shows beside it in the viewer
- Agent work (afk), including research, is settled on the map; the viewer lists it as an approval blocker, without a reviewer answer form
- Questions answering the root do not target the design
- For a connection, target one of its endpoints
- State the proposed behavior and your recommendation in the body; do not ask for judgment without showing what the reviewer would accept
- Choose the answer format in an optional `Design question` block; omit it for free text:

````markdown
<details>
<summary>Design question</summary>

```yaml
choices: [Refresh the preview, Keep the stale preview]  # 2–12 unique labels; the viewer adds Other
multiple: false                                         # true for select all that apply
highlights: ["Refreshes the preview after a conflict"]  # passages quoted from the target element's prose
```
</details>
````

- Each highlight must appear exactly once in the target element's prose; quote a longer passage when it repeats

## Check, then review in the browser

```sh
~/.claude/acstack/bin/acstack design-doc <map> --check
~/.claude/acstack/bin/acstack design-doc <map> --markdown /tmp/design-review.md
```

- `--check` validates the design and prints warnings without serving it
- The build fails on contradictions:
    - an element without a config block, or a config block on another kind
    - an unknown, out-of-scope, or self connection, or the same connection declared twice
    - a containment cycle, or a connection between an ancestor and its descendant
    - an element with no connection or parent, unless it is the only element
    - a concern or highlight that names nothing on the map
    - a mock file that is missing or outside its element folder, an unknown OpenDesigner design or page, or a fixture over 20 KB or not matching its schema
    - an element changed since the user approved it, until it is re-approved
- It warns on oddities:
    - a fog element, a locked element inside a loose one, or an open question on a locked element
    - a loose element's mock with fewer than two variants
    - a locked element with only illustrative mocks
    - inline HTML while OpenDesigner is installed
    - a mock file over 5 MB
- Fix contradictions before asking the user to review
- Keep the command running while the reviewer works
- The open page updates live: the server watches the map folder, element folders, and fixtures, and pushes each rebuild
    - Selection, the drawer, the diagram's viewport, drafts, and open modals stay; mock frames reload with their scroll and state
    - On the GitHub tracker, run `~/.claude/acstack/bin/acstack design-review refresh <map>` after each `gh` write; edits by other people show on a manual refresh
    - A contradiction mid-edit keeps the last good page and shows why it stopped updating
- Open the printed localhost URL when the browser and agent share a device
- On separate devices, run the printed SSH forwarding command from the browser's device, then open the localhost URL
- Options: `--port <port>` selects another review port; `--orientation left-to-right` switches the default `top-to-bottom` flow
- The Markdown companion derives from the same nodes; use a new path to protect existing files
- The tracker comes from `workflow.maps.tracker`; GitHub maps need `gh` authenticated against the repo

## Review the design and saved feedback

- Review through the running server rather than an exported HTML file
- Select elements to read their responsibilities, types, channels, and concern explanations
- Read every relationship aloud as source → verb → target
- Open Questions, or select a target's question indicator, to read and answer questions
- Saving an answer writes `## Answer` on the question node and resolves it through the tracker
    - Pick up follow-ups at your next frontier recompute
- An element changed since approval shows Re-approve in its drawer and in the approval blockers
- Answered questions stay under Answered with the answer; Change answer appends a dated `## Answer (changed YYYY-MM-DD)` section on the node, so its history stays readable
- Choose Send to agent to finish pending saves and copy the feedback prompt
- Read the prompt's `review.json` file, resolve each comment against the map, and revise element nodes
- Comments do not approve a design or authorize implementation
- A design change moves new comments to the new revision; comments on the earlier one stay listed in Comments, tagged with the change (for example, "On an earlier version, before App changed"), appear in the handoff prompt, and still need reconciling, even after a restart
- The page refuses writes made against a design it no longer shows

## Reconcile feedback and approve

- Read `~/.claude/acstack/bin/acstack design-review status <map>` for the exact revision tuple, open questions, `blockers`, `pendingFeedback`, and warnings
- `pendingFeedback` lists every feedback file still blocking approval, including older versions
    - `missing`: the agent has not recorded how it handled this file's comments
    - `stale`: the design, map inputs, or comments changed after that record
    - `needs-human`: a recorded decision needs the reviewer's answer
- For each entry, read its `reviewPath` and run `~/.claude/acstack/bin/acstack design-review status <map> --review-file <reviewPath>` for that file's current tuple
- Write reconciliation input with `sourceRevision`, `reviewRevision`, `commentsDigest`, and `mapInputsDigest`
- Add a `decisions` array with `comments`, `outcome`, and a nonempty `rationale` in each decision
    - Reference each zero-based comment index exactly once
    - Choose `applied`, `retained`, or `needs-human`; `needs-human` keeps approval blocked
- Run `~/.claude/acstack/bin/acstack design-review reconcile <map> --review-file <reviewPath> --input <json-file>` for each file
- Check status again before asking the user to approve
    - Finish every `missing` or `stale` entry; handling only the newest feedback leaves older comments blocking approval
    - Ask the user the specific question for any `needs-human` entry; do not mark it settled yourself
    - Require `pendingFeedback: []` before asking for final approval; element approvals do not settle comments
- Every unresolved node targeting an element blocks approval, including afk work and fog. Zero human questions does not mean ready for approval
    - Settle actionable afk blockers before requesting approval. Record findings in the affected elements before resolving work nodes; never close them merely to clear the gate
    - Report missing decisions or unavailable evidence when blocked. Label an unapprovable review as a draft
    - Present the resulting revision for approval after research. A request to implement does not remove blockers or authorize agent approval; research resolution does not prove runtime safety
- Changed elements block approval; the blocker list offers Re-approve for each
- Approval also waits while a loose element has a mock with several variants
    - The user chooses one by locking the element while that variant is on screen; never choose for them
- The user chooses Approve this version; approval locks every loose element
    - While anything blocks approval, the viewer lists each blocker and links to its element (and answer form for a reviewer question)
- Require `approval.valid: true` from status before implementation
- Changed element nodes, saved comments, or targeting nodes reopen the gate
- Keep `workflow.design_review` unchanged; it controls the separate frontend design pass
- Retain canonical reviews in `<project folder>/design-reviews/` independently of `workflow.maps.persist`
