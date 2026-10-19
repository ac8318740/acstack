---
name: design-doc
description: Author a structured design document and review it through a live local or SSH connection that saves comments for the agent.
---

# Author and review a design document

Create a small YAML entry and one YAML file per element, then review the design with comments saved on the agent's device.

```mermaid
flowchart LR
    A[Agree on the design scope] --> B[Author entry and element files]
    B --> C[Validate and start review]
    C -->|invalid source| B
    C -->|valid source| D[Review in the browser]
    D --> E[Save comments for the agent]
    E -->|requested changes| B
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

- Default new project designs to `.acstack/designs/<id>/design.yaml`, unless the user chooses another location
- Keep the entry and its referenced files in one directory tree
- Use stable IDs matching `[a-zA-Z][a-zA-Z0-9_-]{0,79}`
- Give the entry `id`, `name`, `summary`, and an `elements` array of relative YAML paths
- Optionally add `detail` with a relative Markdown path for the overview and worked journey
- Give each element `id`, `name`, `summary`, and `kind`
- Write each summary as a standalone responsibility, not a code fragment or a list of implementation steps
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
- Keep kind, concern, and channel separate: what an entity is, what requirement spans entities, and how interactions occur
- Put cross-element requirements in the entry's optional `concerns` array
    - Include `id`, `name`, `elements`, `requirement`, and `response`
    - Name at least two affected element IDs
    - Explain both the requirement and the design response in meaningful prose
    - The viewer shows these explanations in each affected element's drawer

```yaml
id: checkout-design
name: Checkout design
summary: The checkout CLI reads orders from a local store.
elements: [checkout.yaml, orders.yaml]
concerns:
  - id: local-data
    name: Local data
    elements: [checkout, orders]
    requirement: Orders must stay on the developer's machine.
    response: The CLI reads local files without a network service.
```

```yaml
# checkout.yaml
id: checkout
name: Checkout CLI
summary: Inspects locally stored orders.
kind: component
channels: [cli]
relationships:
  - id: read-orders
    from: checkout
    to: orders
    direction: one-way
    label: Reads
```

```yaml
# orders.yaml
id: orders
name: Order files
summary: Persist the orders inspected by the checkout CLI.
kind: store
relationships:
  - id: read-orders
    from: checkout
    to: orders
    direction: one-way
    label: Reads
```

## Validate and start review

```sh
~/.claude/acstack/bin/acstack design-doc path/to/design.yaml \
  --markdown /tmp/design-review.md
```

- Keep the command running while the reviewer works
- Open the printed localhost URL when the browser and agent share a device
- On separate devices, run the printed SSH forwarding command from the browser's device, then open the localhost URL
- Use `--port <port>` when another review already uses the default port
- Use a new Markdown path to protect existing files
- Keep Markdown beside source files when its relative source links must resolve on GitHub
- Fix validation errors before asking the user to review
- Keep each source file within 256 KiB and the document within 4 MiB
- Keep the document within 200 elements, 100 concerns, and 200 relationships per element
- Referenced paths cannot escape the entry directory, including through symlinks

## Review the design and saved feedback

- Review through the running server rather than an exported HTML file
- Read the document overview and worked journey separately from the architecture entities
- Select elements to read their responsibilities, types, channels, and concern explanations
- Check that each entity appears once, whether collapsed or expanded
- Inspect both collapsed and expanded views at a readable zoom
    - Keep related elements close, with consistent padding around their group
    - Reserve room for labels without spreading unrelated groups apart
    - Compare width, height, and text readability; a smaller area alone can hide a taller diagram
- Read every relationship aloud as source → verb → target
- Inspect containment and crosscutting relationships before reviewing implementation detail
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
- This slice does not reconcile maps, persist approval, archive designs, or remove legacy commands
- Automatic invocation by map remains deferred until the reviewer accepts the example
