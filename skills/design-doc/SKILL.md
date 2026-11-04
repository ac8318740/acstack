---
name: design-doc
description: Author a structured design document and review it through a live local or SSH connection that saves comments for the agent.
---

# Author and review a design document

Author one design source for interactive browser review and a GitHub-readable Markdown companion with Mermaid.
The React Flow browser view supports drill-down, contextual questions, and feedback saved on the agent's device.

```mermaid
flowchart LR
    A[Agree on the design scope] --> B[Author entry and element files]
    B --> C[Validate and review in the browser]
    C -->|invalid source| B
    C --> D[Save comments for the agent]
    M[Map contributions when bound] --> E[Reconcile feedback and contributions]
    D --> E
    E -->|revise| B
    E -->|ready| F[Approve the exact revision]
    F --> G[Implement and retain review evidence]
    G -->|review inputs change| B
```

## Agree on the design scope

- Read the writing and visual-docs skills before authoring prose
- Inspect the source to establish current responsibilities
- Ask the user about unresolved product decisions before inventing behavior
- Distinguish existing behavior from proposed changes throughout the document
- Open with the proposed change, the review questions, and the trade-offs the reviewer must judge
- Use the worked journey to show who does what and where the proposal changes today's flow
- Use `examples/design-doc/acstack/` as the worked example

## Author entry and element files

- Default new project designs to `<project folder>/designs/<id>/design.yaml`, unless the user chooses another location
    - The project folder is the path `~/.claude/acstack/bin/acstack project-data path` prints
- Keep the entry and its referenced files in one directory tree
- Use stable IDs matching `[a-zA-Z][a-zA-Z0-9_-]{0,79}`
- Give the entry `id`, `name`, `summary`, and an `elements` array of relative YAML paths
- Optionally add `detail` with a relative Markdown path for the overview and worked journey
- Give each element `id`, `name`, `summary`, and `kind`
- Write each summary as a standalone responsibility, not a code fragment or a list of implementation steps
- Keep peer elements at comparable levels of abstraction
- Reuse element names in the overview, relationships, and detail; connect readable names to code identifiers when they differ
- Model only real entities; the document overview is context, not an architecture node
- Choose `kind` from `actor`, `component`, `store`, or `external-system`
    - An actor participates from outside the system, such as a person or an external autonomous agent
    - An agent built into the system is a component
- Use optional `parent` only for genuine containment, not dependencies or shared concerns
    - Each component represents one entity, shown as either a collapsed card or an expanded container, never both
    - Keep relationships across containers explicit rather than inventing a shared owner
    - Let nesting express containment without a duplicate "Contains" or "Embeds" arrow
    - Do not draw an arrow between an ancestor and its descendant; nesting already expresses containment
    - Show interactions between the responsible components rather than between a container and its contents
- Use optional `detail` to reference supporting Markdown
    - Overview and element details support Markdown, GFM tables, fenced Mermaid diagrams, and nested `<details><summary>...</summary>...</details>` sections
    - Leave blank lines around Markdown inside HTML disclosure sections
    - Mermaid renders offline in an isolated frame; scripts and unsafe HTML in prose are stripped. Diagram source appears only when rendering fails
    - Repository paths and other source metadata are optional context in that Markdown, not prerequisites for a design
- Use optional `channels` for zero or more software interfaces
    - Allowed values: `web`, `mobile`, `desktop`, `cli`, `agent`, `email`, `sms`, and `voice`
    - A web app, CLI, or agent can be its own component
    - Put interface labels on the software that provides them, not on an actor because that actor uses them
    - Channels describe access to software; channels do not replace elements
- Declare each relationship identically in both endpoint files under `relationships`
    - Include `id`, `from`, `to`, `direction`, and `label`
    - Choose `direction` from `one-way` or `bidirectional`
    - Keep canonical `from` and `to` identical in both copies, including bidirectional relationships
    - Read every arrow as source → verb → target: `Checkout CLI → Reads → Order files`
    - Use the acting entity as `from`; reading files points from the reader to the store, not along the returned data
    - Keep that action convention consistent throughout the document
    - Use separate arrows when opposite actions need different labels
    - Use `bidirectional` only when the same label accurately describes both directions, not merely because a workflow includes feedback
- Put questions for the reviewer in the entry's optional `questions` array, not in reviewer comments
    - Include a unique stable `id`, `target: {type: node | edge, id: <element-or-relationship-id>}`, `question`, `proposal`, and `recommendation`
    - State the proposed behavior and the reason for your recommendation; do not ask for judgment without showing what the reviewer would accept
    - Target one existing element or relationship; keep edge questions in the entry rather than duplicating them in endpoint files
    - Choose the answer format per question: omit `choices` for free text, supply `choices: [<label>, ...]` for single choice, or add `multiple: true` for multi-select
    - Use choices for concrete alternatives; use text when the reviewer must explain a decision. Supply 2–12 unique labels of at most 500 characters; do not include `Other`, which the viewer adds with a write-in field
    - The Questions tab starts with collapsed rows and offers Expand all / Collapse all; top-right question indicators identify unanswered targets
    - Questions and Comments share a compact scope picker: All targets covers the whole design, target selection filters the list, and Document overview identifies overview-only comments. Question indicators include questions on folded or merged targets; passage links open the exact question's scope. Drafts survive scope changes
    - View target details and the pop-out action beside Design detail and concerns open the same inspector modal. Detail sections start expanded there; closing preserves the original disclosure, draft, selection, and drawer position
    - Optionally add up to 20 `highlights`, each with `element`, `start: {line, column}`, and `end: {line, column}`. Positions address that element's declared Markdown detail, use 1-based UTF-16 columns, and exclude the end position. The modal expands sections and scrolls to the first highlighted passage; see the worked example
    - Unanswered passages in Details and the modal have a reserved question gutter. Hover or focus to reveal View question; touch controls stay visible. Shared passages offer a counted question picker. Navigation opens and focuses the matching question without losing drafts; agents configure only source ranges, not icon positions
- Keep kind, concern, and channel separate: what an entity is, what requirement spans entities, and how interactions occur
- Put cross-element requirements in the entry's optional `concerns` array
    - Include `id`, `name`, `elements`, `requirement`, and `response`
    - Name at least two affected element IDs
    - Explain both the requirement and the design response in meaningful prose
    - The viewer shows these explanations in each affected element's drawer

See [source-example.md](source-example.md) for an entry with an edge question, a concern, and two matching endpoint files.

## Validate and start review

```sh
~/.claude/acstack/bin/acstack design-doc path/to/design.yaml \
  --markdown /tmp/design-review.md
```

- Keep the command running while the reviewer works
- Open the printed localhost URL when the browser and agent share a device
- On separate devices, run the printed SSH forwarding command from the browser's device, then open the localhost URL
- Use `--port <port>` when another review already uses the default port
- Choose `--orientation left-to-right` for horizontal flow in the browser and Mermaid; the default is `top-to-bottom`
- Changing orientation preserves source identity, comments, and approval
- Use a new Markdown path to protect existing files
- Keep Markdown beside source files when its relative source links must resolve on GitHub
- Generate the companion from the same YAML and supporting Markdown; revise the source instead of hand-editing its Mermaid
- Fix validation errors before asking the user to review
- Keep each source file within 256 KiB and the document within 4 MiB
- Keep the document within 200 elements, 100 concerns, 100 questions, and 200 relationships per element
- Referenced paths cannot escape the entry directory, including through symlinks

## Review the design and saved feedback

- Review through the running server rather than an exported HTML file
- Read the document overview and worked journey separately from the architecture entities
- Select elements to read their responsibilities, types, channels, and concern explanations
- Check that each entity appears once, whether collapsed or expanded
- Inspect both collapsed and expanded views at a readable zoom
    - Keep related elements close, with consistent padding around their group
    - Prefer shared card edges for related elements; allow connector bends around headers instead of unnecessary staggering
    - Reserve room for labels without spreading unrelated groups apart
    - Compare width, height, and text readability; a smaller area alone can hide a taller diagram
- Read every relationship aloud as source → verb → target
- Inspect containment and crosscutting relationships before reviewing implementation detail
- Open Questions, or select a target's question indicator, then expand a row to read its proposal, recommendation, and target detail link
- Save each answer explicitly; switching tabs or collapsing the drawer preserves drafts, but Send to agent does not post answer drafts
- Answers are separate from reviewer comments and stay attached to the reviewed design version
- Answer the opening review questions and discuss the stated trade-offs
- Review the generated Markdown companion on GitHub when useful
- GitHub publication remains separate from the live comment connection
- Use human feedback as the clarity loop; code tests do not establish whether the explanation makes sense
- Choose Send to agent to finish pending saves and copy the feedback prompt
- Copy the displayed prompt manually if the browser denies clipboard access
- Paste the prompt into the agent's chat to request revisions
- Read the prompt's `review.json` file and authored design entry
- Resolve comment targets against the authored design to recover names and context
- Use the developer's comments as requests to revise the design
- Retry a failed save before closing the review
- Preserve local edits when the server reports a conflicting revision
- Edit the authored files following feedback, then restart the review for the changed design
- Keep earlier feedback with its original design version rather than silently moving comments to changed text
- Comments do not approve a design or authorize implementation
- Unanswered questions block approval; saving answers is not approval and still requires agent reconciliation
- Approval records the exact authored source, ordered saved comments and answers, and current map contributions

## Reconcile feedback and approve

Reconcile saved feedback for any design. Optionally bind a map for shared behavior, component boundaries, or data-flow decisions:

- Store `Design entry: <path>` in the map root body
    - Write the path relative to the project folder, such as `designs/<id>/design.yaml`, or relative to the repository for a design kept in the repository
    - ACStack resolves it against the project folder first, then the current checkout
- Add `planning: {tracker: files | github, map: <name>}` to the entry
- Use the same contribution format in files and GitHub node bodies
- Put one fenced JSON array under `## Design contributions`

```json
[
  {
    "id": "interface-choice",
    "designId": "checkout-design",
    "targets": ["checkout"],
    "statement": "The checkout component exposes the command interface"
  }
]
```

- Use document, element, relationship, or concern IDs as targets
- Read `~/.claude/acstack/bin/acstack design-review status <entry>` for contribution keys and the exact revision tuple
- Select older feedback with `--review-file <canonical-review.json>` when the source changed
- Preserve the selected historical snapshot; reconciliation belongs to the current revision
- Resolve blocking decision nodes or mark them out of scope
- Surface contradictory proposals as decision nodes rather than choosing one silently
- Write reconciliation input with the four status fields: `sourceRevision`, `reviewRevision`, `commentsDigest`, and `mapInputsDigest`
- Add a `decisions` array with `comments`, `contributions`, `outcome`, and nonempty `rationale` in each decision; add `answers` when the selected review has saved question answers
- Reference each selected comment index, answer index, and current contribution key exactly once; comment and answer indexes are zero-based in the selected review's arrays
- Incorporate settled answers into the authored design and remove their questions from the open list
- Reconcile the historical question answers explicitly after changing source; do not copy them onto a new question revision
- A question left in a new source revision requires a fresh answer; previous snapshots retain the original question and answer
- Choose `applied`, `retained`, or `needs-human`; `needs-human` keeps approval blocked
- Run `~/.claude/acstack/bin/acstack design-review reconcile <entry> --input <json-file>` with the same optional `--review-file`
- Empty comment, answer, and contribution sets need no invented reconciliation
- Reopen `~/.claude/acstack/bin/acstack design-doc <entry>` after authored source changes
- Choose Approve this revision in the document details after reconciliation
- Keep unposted drafts intact; approval saves only posted comment edits
- Require `approval.valid: true` from status before implementation
- Reopen the gate after authored source, saved feedback, or meaningful contribution inputs change
- Presentation regeneration alone preserves approval
- Keep `workflow.design_review` unchanged; it controls the separate frontend design pass

## Import legacy review history explicitly

- ACStack removes `map --map` and `align-viewer` without aliases
- Author the new design first; the old planning graph cannot define its architecture
- Keep map planning in `node walk`, `node frontier`, and `node diagram`
- Use a nonsymlink legacy directory under `<project folder>/alignment-packs/`
- Write an explicit JSON mapping array of `{from: {type, id}, to: {type, id}}` pairs
- Map every commented legacy target to a valid current target
- Choose document context explicitly when a legacy target is ambiguous

```sh
~/.claude/acstack/bin/acstack design-review migrate <entry> \
  --legacy-dir <path> --mapping <json-file> [--feedback <json-file>]
```

- Supply `--feedback` only for an explicit exported feedback JSON file
- Migration reads saved pack versions, approvals, annotations, and the corresponding decision log in the project folder
- Migration preserves original artifacts and decision logs byte-for-byte
- Canonical `review.json` retains imported history, source fingerprints, and original comments, quotes, authors, timestamps, and provenance
- Imported comments append to existing feedback; duplicate source comments import once
- Historical approval remains history, never current approval
- An actual import advances the comment revision once and invalidates prior effective approval
- Repeating the same source and mapping imports nothing again
- Invalid inputs fail before any write; publication uses the canonical review lock
- Reconcile imported feedback and obtain current exact-revision approval before implementation or archive
- Never migrate automatically at startup or archive
- Retain design sources, canonical reviews, import history, and decision logs independently of `workflow.maps.persist`
- Never change the Git index or force-add review records
