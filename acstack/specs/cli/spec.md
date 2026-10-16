<!-- Auto-generated from code changes. Run /bootstrap for full spec. -->

# CLI spec

This spec covers the bundled `acstack` command-line interface.

## Alignment packs

### FR-001: Generate a versioned pack from a map

- **Description**: The CLI converts a files-backend map into a deterministic alignment pack
- **Given**: A project has a map at `acstack/maps/<name>/`
- **When**: A user runs `acstack map --map <name>`
- **Then**: ACStack writes a standalone HTML pack under `acstack/alignment-packs/<safe-map>/`
- **Then**: The pack version includes the map name and a stable hash of map node content, including each node's summary
- **Then**: Each item carries a business definition (the node summary, or the body's first paragraph) and a technical definition (the full body)
- **Then**: ACStack writes `.gitignore` into `acstack/alignment-packs/` unless the project sets `commit_generated_packs`
- **Given**: A map name holds characters other than letters, digits, `.`, `_` and `-`, or is `.` or `..`
- **When**: A user runs `acstack map` or `acstack align-viewer` with it
- **Then**: ACStack refuses the name before reading or writing any file
- **Source**: `cli/src/commands/alignment.ts`, `cli/src/lib/alignment-pack-lifecycle.ts`

### FR-002: Store a traceable alignment graph

- **Description**: An alignment pack records source references, graph content, view state, and review state
- **Given**: Pack data names groups, nodes, edges, aggregate edges, and source references
- **When**: ACStack parses the pack
- **Then**: ACStack accepts only the declared pack shape and rejects approval for another pack version
- **Given**: The current view state hides cross-group child edges
- **When**: ACStack derives aggregate edges
- **Then**: Each aggregate edge keeps its concrete child edge IDs and source references
- **Source**: `cli/src/lib/alignment-packs.ts`

### FR-003: Render packs as local review artifacts

- **Description**: ACStack renders each pack as a standalone HTML file with a bundled diagram viewer
- **Given**: An alignment pack is ready to view
- **When**: ACStack renders the pack
- **Then**: The HTML inlines the pack JSON and the viewer bundle (React, React Flow, ELK, Lucide, react-markdown) and loads nothing remote
- **Then**: The viewer draws items top-down with orthogonal links
- **Then**: A link hops where it crosses another, and breaks around its label
- **Then**: A folded group shows as one box, and the links it hides merge into one labelled link
- **Then**: A drawer shows the selected item's business definition, its collapsed technical definition, its links, and its source
- **Then**: A reviewer can comment on a box, a link, or highlighted text, and the viewer keeps the comments in browser storage per pack version
- **Given**: A reviewer opens the HTML file directly, not through `acstack align-viewer`
- **Then**: The viewer is read-only and names the command that starts a review
- **Source**: `cli/src/lib/alignment-pack-renderer.ts`, `cli/src/viewer/`, `cli/scripts/build-viewer.mjs`, `docs/adr/0018-alignment-packs-use-local-viewers.md`

### FR-004: Serve a review and record the decision

- **Description**: The `align-viewer` command serves the pack on localhost and records the review the page posts back
- **Given**: A user runs `acstack align-viewer --map <name>`
- **When**: The server starts on `127.0.0.1` port 19990, or `ACSTACK_ALIGN_PORT`
- **Then**: ACStack prints the URL and, in an SSH session, the `ssh -L` forward to set up, then opens the page through `acstack-open`
- **Given**: The page posts Approve or Request changes with its one-time token
- **When**: The server receives the review
- **Then**: ACStack writes the review state into the pack, the comments into `annotations.jsonl`, and `feedback.md`, then stops
- **Then**: The page copies a prompt for the reviewer's agent to the clipboard and shows it with a Copy button
- **Given**: A post lacks the right token, comes from a host other than localhost, or exceeds 1 MB
- **Given**: A post arrives while the server records another review
- **Then**: The server refuses it and records nothing
- **Given**: A review requests changes with no comments
- **Then**: ACStack refuses it
- **Given**: A user runs `acstack align-viewer --map <name> --feedback <path>`
- **Then**: ACStack records the review from the file without serving the page
- **Given**: Feedback names a different pack version
- **Then**: ACStack rejects it and leaves source map files unchanged
- **Source**: `cli/src/commands/alignment.ts`, `cli/src/lib/alignment-review-protocol.ts`

### FR-005: Convert annotations into feedback for agents

- **Description**: Annotation helpers keep reviewer comments tied to the pack graph
- **Given**: A reviewer records an annotation event
- **When**: ACStack appends it
- **Then**: ACStack writes one JSON object per line with pack version, target, evidence, comment, author, and time
- **Given**: Annotation JSONL matches the current pack version
- **When**: ACStack exports feedback Markdown
- **Then**: The file groups comments by target and gives each target its graph context, including a node's technical definition and a link's node names
- **Source**: `cli/src/lib/alignment-feedback.ts`

### FR-006: Manage pack lifecycle state

- **Description**: Alignment pack state stays local until a user confirms durable residue extraction
- **Given**: `acstack/project.yaml` omits alignment pack settings
- **When**: ACStack loads alignment pack config
- **Then**: ACStack enables auto generation and approval gates, and keeps generated packs out of commits
- **Given**: Pack working state exists for a map
- **When**: Archive runs before a user confirms durable residue extraction
- **Then**: ACStack refuses to delete the pack directory
- **Given**: A user has confirmed durable residue extraction
- **When**: Archive runs for that map
- **Then**: ACStack deletes the local pack directory without deleting maps, specs, ADRs, or decisions
- **Source**: `cli/src/lib/alignment-pack-lifecycle.ts`, `cli/src/lib/project-config.ts`

## Map nodes

### FR-007: Carry a business summary on a node

- **Description**: A files-backend node can carry an optional one-line `summary` for a business reader
- **Given**: A user runs `acstack node create` or `acstack node update` with `--summary <text>`
- **When**: ACStack writes the node
- **Then**: ACStack stores the trimmed summary in frontmatter after `label`
- **Then**: ACStack refuses a blank summary on create and a multi-line summary on either command
- **Given**: `acstack node update` receives an empty `--summary`
- **Then**: ACStack clears the summary
- **Source**: `cli/src/lib/nodes.ts`, `cli/src/commands/node.ts`

## Project configuration

### FR-008: Preserve deprecated workflow booleans without defaults

- **Description**: The CLI retains boolean config compatibility without assigning legacy workflow defaults
- **Given**: A project sets `workflow.tdd.strict` or `workflow.tdd.orchestrator_strict`
- **When**: A user gets, sets, lists, or unsets either key
- **Then**: The CLI treats the value as a boolean and preserves unrelated configuration and comments
- **Given**: A project omits either key
- **When**: A user reads effective configuration
- **Then**: The CLI supplies no default for that key
- **Then**: Unrelated config writes do not insert or remove either key
- **Source**: `cli/src/lib/project-config.ts`
