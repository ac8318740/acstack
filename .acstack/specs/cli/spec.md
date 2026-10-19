<!-- Auto-generated from code changes. Run /bootstrap for full spec. -->

# CLI spec

This spec covers the bundled `acstack` command-line interface.

## Alignment packs

### FR-001: Generate a versioned pack from a map

- **Description**: The CLI converts a files-backend map into a deterministic alignment pack
- **Given**: A project has a map at `.acstack/maps/<name>/`
- **When**: A user runs `acstack map --map <name>`
- **Then**: ACStack writes a standalone HTML pack under `.acstack/alignment-packs/<safe-map>/`
- **Then**: The pack version includes the map name and a stable hash of map node content, including each node's summary
- **Then**: Each item carries a business definition (the node summary, or the body's first paragraph) and a technical definition (the full body)
- **Then**: The root `.gitignore` controls pack tracking without a generated nested ignore file
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
- **Then**: The viewer lays out groups and items with orthogonal links
- **Then**: A link hops where it crosses another, and breaks around its label
- **Then**: A folded group shows as one box, and the links it hides merge into one labelled link
- **Then**: A drawer shows the selected item's business definition, its collapsed technical definition, its links, and its source
- **Then**: A reviewer can comment on a box, a link, or highlighted text, and the viewer keeps the comments in browser storage per pack version
- **Given**: A reviewer opens a legacy alignment pack directly, not through `acstack align-viewer`
- **Then**: The viewer cannot submit a review and names the command that starts a review
- **Source**: `cli/src/lib/alignment-pack-renderer.ts`, `cli/src/viewer/`, `cli/scripts/build-viewer.mjs`, `.acstack/decisions/0018-alignment-packs-use-local-viewers.md`

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
- **Given**: `.acstack/project.yaml` omits alignment pack settings
- **When**: ACStack loads alignment pack config
- **Then**: ACStack enables auto generation and approval gates
- **Then**: The root managed ignore baseline keeps new generated packs local unless user rules opt them in
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

## Authored design documents

### FR-009: Serve an authored design with optional Markdown export

- **Description**: The CLI serves a live design review and optionally exports Markdown from the same validated source
- **Given**: A YAML entry references one YAML file per architecture element and optional supporting Markdown
- **When**: A user runs `acstack design-doc <entry> --markdown <new.md>`
- **Then**: ACStack validates the complete source before serving the design or writing Markdown
- **Then**: The browser uses the shared viewer and the Markdown names the same elements, relationships, and concerns
- **Then**: Markdown creation refuses existing files, including symlinks
- **Then**: The command prints a localhost review URL, feedback location, and SSH forwarding instructions when running over SSH
- **Then**: The review defaults to port 19990 and accepts a different port through `--port`
- **Source**: `cli/src/commands/design-doc.ts`, `cli/src/lib/design-doc.ts`, `cli/src/lib/alignment-pack-renderer.ts`

### FR-010: Validate architecture identities and mirrored relationships

- **Description**: Design validation rejects inconsistent architecture records and references outside the entry directory
- **Given**: An authored design declares elements, containment, relationships, and cross-element concerns
- **When**: ACStack loads the design
- **Then**: Element kinds are `actor`, `component`, `store`, or `external-system`
- **Then**: Optional channels are `web`, `mobile`, `desktop`, `cli`, `agent`, `email`, `sms`, or `voice`
- **Then**: Relationship declarations match at both endpoints, including identity, direction, and label
- **Then**: ACStack rejects relationships between an ancestor and any descendant, in either direction, and asks the author to use nesting
- **Then**: Concerns name affected elements and explain their requirement and design response
- **Then**: ACStack rejects duplicate identities, missing references, containment cycles, and escaped paths, including resolved symlink escapes with Windows or POSIX separators
- **Then**: ACStack limits each file to 256 KiB, the document to 4 MiB, elements to 200, concerns to 100, and relationships per element to 200
- **Source**: `cli/src/lib/design-doc.ts`, `cli/src/lib/alignment-packs.ts`

### FR-011: Review architecture separately from document context

- **Description**: The shared viewer presents design context separately from architecture entities and preserves entity identity while folding
- **Given**: A reviewer opens a design document in the shared viewer
- **When**: The viewer opens
- **Then**: The introductory drawer explains the proposal and worked journey without creating a synthetic architecture entity
- **Then**: The overview summary and authored prose share body typography and a left edge, with larger headings marking the hierarchy
- **When**: A reviewer comments on the overall document or highlights its introductory text
- **Then**: The viewer attaches the comment to the document's structural root, preserving any selected quote
- **Then**: Opening that comment's target returns to the introductory drawer
- **When**: A reviewer expands or folds a component
- **Then**: The component appears once, as a folded responsibility card or an expanded selectable container
- **Then**: Folding preserves the selected visible entity or redirects a hidden selection to its visible ancestor
- **Then**: Expansion preserves the component's exact top-left screen position and zoom without a corrective viewport movement
- **Then**: Relationship names identify their source, action, and target
- **Then**: Source metadata uses a separate toggle
- **When**: A reviewer hovers over a card, container, or relationship label, or focuses it with the keyboard
- **Then**: Its comment action appears above its top-right corner without changing the content layout
- **Then**: Touch users can reveal the action by selecting the item
- **Then**: Browser-local comments remain feedback and do not record durable approval
- **Source**: `cli/src/viewer/alignment-graph.ts`, `cli/src/viewer/diagram.tsx`, `cli/src/viewer/main.tsx`, `cli/src/viewer/drawer.tsx`

### FR-012: Resize details without covering the selected text

- **Description**: Reviewers resize the details drawer while comment drafts remain outside it
- **Given**: A reviewer opens the desktop details drawer
- **When**: The reviewer drags its outside edge or uses the focused separator's arrow, Home, or End keys
- **Then**: The drawer changes width within 280–720 pixels while reserving at least 320 pixels for the canvas
- **Then**: Closing and reopening the drawer preserves its width for the current session
- **When**: The reviewer selects text to comment
- **Then**: The comment popover stays within the canvas, left of the desktop drawer or above the stacked mobile drawer
- **Then**: The popover follows changes to the canvas and drawer bounds
- **When**: The reviewer writes a selected-text comment
- **Then**: The quoted source remains softly highlighted while the draft is open
- **When**: The reviewer posts, cancels, clicks outside the popover, or presses Escape
- **Then**: The popover and its temporary highlight disappear

- **When**: The viewer shows an element's metadata
- **Then**: A labeled colored pill identifies its type while channel labels remain neutral
- **Source**: `cli/src/viewer/drawer.tsx`, `cli/src/viewer/comment-position.ts`, `cli/src/viewer/main.tsx`, `cli/src/viewer/diagram.tsx`, `cli/src/viewer/viewer.css`

### FR-013: Read posted comments from highlighted quotes

- **Given**: A posted comment quotes text in the current document
- **When**: The viewer can locate the quoted text within its recorded target
- **Then**: The source stays softly highlighted after posting and reloading
- **When**: The reviewer hovers over the highlight
- **Then**: A panel previews the associated comments without covering the drawer
- **Then**: The panel grows to a height limit, with complete content scrollable and scrollbar space reserved
- **When**: The reviewer clicks a highlighted quote outside a control or opens the comment through the keyboard-accessible comments list
- **Then**: The panel stays open until dismissed
- **When**: The reviewer clicks an annotated header button
- **Then**: The header still selects its node
- **Then**: A single-comment panel places labeled Edit and Close icons together in its header, with Edit first
- **When**: The reviewer edits a comment in the saved-comment panel or Comments view
- **Then**: Saving updates the same comment across both views and after reload, preserving its quote, target, and highlight
- **Then**: Cancel or Escape leaves the saved comment unchanged
- **When**: The reviewer deletes a comment
- **Then**: Its highlight disappears unless another comment references the same text
- **Given**: The viewer cannot locate the quoted text unambiguously
- **Then**: The comment remains accessible in the comments list without marking unrelated text
- **Then**: Browser-local quote-location metadata stays out of the review API payload
- **Source**: `cli/src/viewer/main.tsx`, `cli/src/viewer/drawer.tsx`, `cli/src/viewer/posted-comments.tsx`, `cli/src/viewer/quote-anchors.ts`

### FR-014: Separate details from one comments view with explicit scope

- **Given**: A reviewer opens the drawer
- **When**: The reviewer chooses Details
- **Then**: The drawer shows document or element details without a comment list or composer
- **When**: The reviewer chooses Comments from Details
- **Then**: One Comments view opens with a scope selector, count, composer, and comment cards
- **Then**: The initial scope follows the selected element, or the document when the reviewer has no selection
- **Then**: All comments, Document, and individual elements use the same layout and comment actions
- **Then**: The scope menu lists every commented element independently of the canvas selection
- **Then**: The scope menu omits targets without comments and deduplicates equivalent component representations
- **Then**: All comments remains available when no comments exist
- **When**: The reviewer chooses Document scope
- **Then**: The view includes only document-root comments and targets new comments to the document
- **When**: The reviewer chooses a commented element's scope
- **Then**: The view includes only that element's comments and targets new comments to that element
- **Then**: A component's folded and expanded representations share the same comment scope without including descendant comments
- **Then**: A grouped relationship includes comments for its represented relationships without including unrelated comments
- **Then**: With no selection, a design document's Comments view targets the document root
- **Then**: The expanded drawer uses its Comments tab without a duplicate comments icon
- **When**: The reviewer activates the All comments icon in the collapsed right rail
- **Then**: The same Comments view opens in All comments scope, with every comment and no authored details
- **Then**: A design document's composer shows Comment on document and targets the document root
- **Then**: Legacy packs without a document root keep All comments read-only and offer valid element scopes
- **When**: The reviewer selects an element while viewing Comments
- **Then**: The Comments view scopes to that element, including when the reviewer selects the same element again
- **When**: The reviewer activates a diagram Comment action
- **Then**: The scoped Comments view opens with its composer focused
- **Then**: A target without comments supports its first comment without adding an empty target to the scope menu
- **When**: The reviewer posts a target's first comment or deletes its last comment
- **Then**: The scope menu adds or removes that target without dropping unrelated comments
- **When**: The reviewer opens a comment's target from the comments list
- **Then**: The Details view opens at that target
- **When**: The reviewer changes tabs, scopes, or selections, or collapses the drawer
- **Then**: Unposted comments remain associated with their targets, and unfinished comment edits remain associated with their comments
- **Then**: Posting, saving, or cancelling clears only the corresponding draft
- **Source**: `cli/src/viewer/main.tsx`, `cli/src/viewer/drawer.tsx`, `cli/src/viewer/comment-editor.tsx`

### FR-015: Choose options through one accessible dropdown

- **Given**: A reviewer opens a viewer dropdown
- **Then**: The shared component renders the menu with the viewer's typography, colors, selection indicator, and focus treatment
- **Then**: The trigger identifies its expanded state and associated listbox to assistive technology
- **When**: The reviewer uses arrow keys, Home, End, or typeahead
- **Then**: The menu activates and reveals the corresponding option
- **When**: The reviewer confirms an option
- **Then**: The menu applies that option, closes, and returns focus to the trigger
- **When**: The reviewer presses Escape or clicks outside the menu
- **Then**: The menu closes without changing the selection
- **When**: The reviewer presses Tab
- **Then**: Focus leaves the dropdown without a focus trap
- **Then**: The menu stays inside the viewport and scrolls when its options exceed the available height
- **Source**: `cli/src/viewer/dropdown.tsx`, `cli/src/viewer/viewer.css`

### FR-016: Save design comments for the agent during review

- **Given**: A reviewer opens the design through its running review server
- **When**: The reviewer posts, edits, or deletes a comment
- **Then**: The viewer sends the complete comment snapshot without approving the design
- **Then**: The server saves the design version, revision, and complete annotations in one versioned `review.json` under `.acstack/design-reviews/`
- **Then**: Live design reviews do not generate `annotations.jsonl` or `feedback.md`
- **Then**: The command prints the JSON file's absolute path for the agent
- **Then**: Deleting the last comment removes it from the saved feedback
- **Then**: The viewer reports a saved state only after the server acknowledges the snapshot
- **When**: Saving fails
- **Then**: The viewer keeps the reviewer's local comments and offers a retry
- **When**: The review restarts for the same source version
- **Then**: Saved comments remain available
- **When**: The source changes
- **Then**: Earlier feedback remains associated with its original version
- **Then**: Stale revisions cannot overwrite a newer saved snapshot
- **Then**: The server binds to loopback and requires its page token for feedback access
- **Then**: Invalid hosts, oversized bodies, malformed comments, unknown targets, and mismatched versions cannot mutate feedback
- **Source**: `cli/src/lib/review-server.ts`, `cli/src/lib/design-review.ts`, `cli/src/commands/design-doc.ts`, `cli/src/viewer/main.tsx`

### FR-017: Hand saved design comments to an agent

- **Given**: A reviewer opens a live design review
- **When**: The reviewer chooses Send to agent
- **Then**: The viewer waits for pending comments to save before copying the feedback prompt
- **Then**: The prompt identifies the exact `review.json` and authored design entry paths on the agent's device
- **Then**: The prompt requests source revisions and explanations of unresolved decisions without a prompt-injection warning
- **When**: Saving fails or the saved revision conflicts
- **Then**: The viewer preserves local comments and reports the error without copying a success prompt
- **When**: Clipboard access is unavailable or denied
- **Then**: The viewer displays a selectable prompt and a manual copy action
- **Then**: Returning to the review keeps comments, unposted text, and the server available
- **Then**: Back to review and Escape return keyboard focus to Send to agent without scrolling
- **Then**: The version, save status, and action controls share a vertical center on desktop and mobile
- **Then**: Mobile save errors appear below the controls without separating the version from the actions
- **Then**: The handoff creates no additional persisted feedback file
- **Then**: Legacy approval and offline views do not expose the live handoff action
- **Source**: `cli/src/commands/design-doc.ts`, `cli/src/lib/review-server.ts`, `cli/src/viewer/review-sync.ts`, `cli/src/viewer/main.tsx`

## Hidden project data

### FR-018: Resolve canonical metadata without claiming ordinary source directories

- **Given**: The CLI searches upward from its working directory
- **When**: It finds `.acstack/` or recognized legacy project records
- **Then**: It selects the nearest matching project root
- **Then**: Central path helpers resolve project configuration, the domain map, browser configuration, and verification knowledge under `.acstack/`
- **Given**: An `acstack/` directory contains neither recognized configuration files nor recognized record directories
- **When**: The CLI searches for project metadata
- **Then**: The directory alone does not identify a legacy project
- **Then**: Authored source such as `examples/design-doc/acstack/` remains ordinary source
- **Source**: `cli/src/lib/constants.ts`, `cli/src/lib/project.ts`

### FR-019: Enforce native Git ignore policy without configuration or index changes

- **Given**: `.acstack/` exists without requiring `.acstack/project.yaml`
- **When**: A user runs `acstack project-data ensure`
- **Then**: ACStack places a managed block at the start of the root `.gitignore`
- **Then**: The block reopens `/.acstack/` and ignores `/.acstack/**`, including unknown future parts
- **Then**: Existing user rules follow the block with their bytes, line endings, and exceptions preserved
- **Then**: Repeated enforcement leaves an already reconciled file unchanged
- **Then**: Native exceptions can opt parts in independently by reopening their parent directories before selecting files or trees
- **Then**: ACStack changes neither the Git index nor existing tracked-file status and adds no automatic tracking exceptions
- **Given**: `.acstack/` is absent
- **When**: A user runs `acstack project-data ensure`
- **Then**: ACStack creates neither metadata nor an ignore file
- **Given**: The root ignore path names a symlink, a nonregular file, invalid UTF-8, or malformed managed markers
- **When**: ACStack reconciles the policy
- **Then**: ACStack refuses the rewrite without changing the existing file
- **Source**: `cli/src/commands/project-data.ts`, `cli/src/lib/project-data.ts`

### FR-020: Reconcile policy before command dispatch

- **Given**: The CLI finds a project containing `.acstack/`
- **When**: Any invocation other than explicit `project-data migrate` starts
- **Then**: ACStack reconciles the root ignore policy before running built-in commands or dispatching external `acstack-<name>` helpers
- **Then**: Policy failure stops dispatch rather than allowing unprotected writes
- **Given**: A project command requires canonical metadata but only recognized legacy records exist
- **When**: The command resolves its project
- **Then**: ACStack requests explicit migration instead of creating an empty canonical directory
- **Source**: `cli/src/index.ts`, `cli/src/lib/utils.ts`, `cli/src/lib/project-data.ts`

### FR-021: Migrate only the selected checkout with collision checks and rollback

- **Given**: The user updates installed tools, stops old agents and review servers, and backs up the selected checkout
- **When**: The user runs `acstack project-data migrate` from that checkout's root
- **Then**: ACStack moves recognized legacy `acstack/` records to `.acstack/`
- **Then**: It moves `docs/adr/` to `.acstack/decisions/` and `.decisions/` to `.acstack/decision-logs/`
- **Then**: It moves root `CONTEXT.md`, `.test-baseline`, and `agent-browser.json` under `.acstack/`
- **Then**: It moves owned verification knowledge to `.acstack/verification/VERIFICATION-KNOWLEDGE.md`, leaving helper programs and unrelated user files in place
- **Then**: It leaves configured knowledge outside the checkout untouched
- **Then**: It preflights existing destinations, conflicting incoming records, and unsafe symlinked source parents before moving data
- **Then**: It refuses to merge or overwrite an existing `.acstack/` destination
- **Then**: It preserves record bytes and symlink target meaning while removing only recognized generated nested ignore files
- **Then**: It preserves custom nested ignore rules and leaves the Git index unchanged
- **Then**: It installs the root ignore baseline without automatic tracking exceptions or migrating another checkout
- **When**: A migration operation fails
- **Then**: ACStack reverses completed operations and reports any incomplete rollback
- **Source**: `cli/src/commands/project-data.ts`, `cli/src/lib/project-data.ts`

### FR-022: Accept the legacy pack tracking boolean without applying it

- **Given**: Configuration states `workflow.alignment_packs.commit_generated_packs` as a boolean
- **When**: The CLI reads or changes configuration
- **Then**: The key remains accepted for compatibility
- **Then**: Its value has no tracking effect; native root `.gitignore` rules control tracking
- **Then**: ACStack adds no YAML tracking key or generated nested ignore file
- **Source**: `cli/src/lib/project-config.ts`, `cli/src/lib/alignment-pack-lifecycle.ts`

### FR-023: Separate design relationship routes before publishing the diagram

- **Given**: An authored design has relationships inside and across nested component boundaries
- **When**: The viewer lays out the measured cards, headers, and relationship labels
- **Then**: It corrects eligible elbowed routes' incoming and outgoing attachment order using their approach and departure directions
- **Then**: These corrections follow route geometry rather than relationship declaration order or component ownership alone
- **When**: Distinct relationship tracks run less than 12 diagram units apart for more than 12 units
- **Then**: It attempts bounded corrections before placing labels and publishing the diagram
- **Then**: Corrections preserve the connected nodes, allowed attachment positions, and orthogonal segments without entering cards or component headers
- **Then**: Layout retries can increase attachment spacing within the available card width
- **When**: The bounded attempts cannot produce clear routes and labels
- **Then**: The viewer reports the failure instead of publishing the conflicting diagram
- **Source**: `cli/src/viewer/alignment-graph.ts`, `cli/src/viewer/edge-routing.test.ts`

### FR-024: Reserve label space without globally expanding the diagram

- **Given**: A measured design has clear connectors but relationship labels cannot fit
- **When**: The viewer retries the layout
- **Then**: It uses the failed labels' dimensions to increase track and attachment spacing at their endpoints and shared container
- **Then**: Label-only retries keep the normal card gaps and container padding
- **Then**: A layout that already fits keeps its original spacing
- **Source**: `cli/src/viewer/alignment-graph.ts`, `cli/src/viewer/compact-layout.test.ts`

### FR-025: Balance horizontal placement in design diagrams

- **Given**: An authored design branches toward destinations inside and outside component boundaries
- **When**: The viewer positions its measured nodes
- **Then**: It uses balanced horizontal placement while retaining downward flow and nested component boundaries
- **Then**: Route clearance, label placement, and expand/collapse anchor checks still apply
- **Source**: `cli/src/viewer/alignment-graph.ts`, `cli/src/viewer/compact-layout.test.ts`
