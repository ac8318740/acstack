<!-- Auto-generated from code changes. Run /bootstrap for full spec. -->

# CLI spec

This spec covers the bundled `acstack` command-line interface.

## Review artifacts and legacy migration

### FR-001: Retire generated map review commands without aliases

- **Given**: A user reads the CLI help
- **Then**: The CLI offers `design-doc` and `design-review` commands instead of `map` and `align-viewer`
- **When**: A user invokes either retired command
- **Then**: ACStack rejects it and names `design-doc` as the replacement
- **Then**: ACStack never dispatches an external executable under either reserved name
- **Source**: `cli/src/index.ts`, `cli/src/commands/design-doc.ts`

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
- **Given**: A reviewer opens a legacy alignment pack directly
- **Then**: The viewer cannot submit legacy approval
- **Source**: `cli/src/lib/alignment-pack-renderer.ts`, `cli/src/viewer/`, `cli/scripts/build-viewer.mjs`, `.acstack/decisions/0018-alignment-packs-use-local-viewers.md`

### FR-006: Retain review evidence independently of temporary map nodes

- **Given**: Archive runs for a cleared map
- **Then**: Removing temporary nodes never authorizes deletion of canonical review history or decision logs
- **Given**: Legacy pack state exists
- **When**: An archive helper runs after residue extraction
- **Then**: The helper retains the legacy source
- **Source**: `cli/src/lib/alignment-pack-lifecycle.ts`, `skills/archive/SKILL.md`

## Map nodes

### FR-031: Mark design elements with their own node kind

- **Given**: A node carries `kind: element` on either tracker
- **Then**: `acstack node kinds` lists `element`, and the diagram draws it as a parallelogram
- **Then**: `node frontier` never returns an element node, in either mode
- **Then**: An open element is loose and a resolved one is locked
- **Source**: `cli/src/lib/nodes.ts`, `cli/src/lib/diagram.ts`, `.acstack/decisions/0022-design-elements-are-a-sixth-node-kind.md`

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

## Design docs

### FR-009: Serve a map's design doc with optional Markdown export

- **Description**: The CLI builds a design doc from a map's element nodes, serves a live review, and optionally exports Markdown from the same nodes
- **Given**: A map has `element` nodes, each with a collapsed `Design element` YAML block
- **When**: A user runs `acstack design-doc <map> --markdown <new.md>`
- **Then**: ACStack reads the map through `workflow.maps.tracker`, files or GitHub, and validates it before serving or writing Markdown
- **Then**: `--check` validates and prints warnings without serving
- **When**: The map, an element folder, or a fixture changes while the review runs, or `design-review refresh <map>` is called
- **Then**: The server rebuilds the page and pushes it over a token-gated event stream; the viewer keeps selection, drawer state, viewport, drafts, and open modals
- **Then**: Mock frames reload through `snapshot-request`, waiting at most 300 ms, then `init.restore` with scroll, selections, and app state for the same path
- **Then**: A contradiction keeps the last good page and shows the error
- **Then**: Comments on an earlier revision stay listed read-only in Comments, tagged "On an earlier version, before <element> changed"; the new review records them, so they stay approval obligations and appear in the handoff prompt across restarts
- **Then**: The browser uses the shared viewer and the Markdown names the same elements, relationships, and concerns
- **Then**: Each Mermaid container has one identity shared by its subgraph and relationship endpoints
- **Then**: Markdown creation refuses existing files, including symlinks
- **Then**: The command prints a localhost review URL, feedback location, and SSH forwarding instructions when running over SSH
- **Then**: The review defaults to port 19990 and accepts a different port through `--port`
- **Then**: `--orientation` accepts `top-to-bottom` or `left-to-right`, defaulting to `top-to-bottom`
- **Then**: The browser and Mermaid follow the selected orientation without changing source identity, comment scope, or approval
- **Then**: The CLI rejects invalid orientations before creating review or Markdown files
- **Source**: `cli/src/commands/design-doc.ts`, `cli/src/lib/design-doc.ts`, `cli/src/lib/design-map.ts`, `cli/src/lib/alignment-pack-renderer.ts`

### FR-010: Fail on design contradictions and warn on oddities

- **Description**: Building a design doc rejects inconsistent element nodes and warns about suspicious ones
- **Given**: A map's element nodes declare kind, containment, channels, and connections; its root may declare concerns in a `Design doc` block
- **When**: ACStack builds the design doc
- **Then**: Element kinds are `actor`, `component`, `store`, or `external-system`
- **Then**: Optional channels are `web`, `mobile`, `desktop`, `cli`, `agent`, `email`, `sms`, or `voice`
- **Then**: Each connection is declared once, on its source element, and takes the id `<from>-<to>`
- **Then**: ACStack fails on a missing or malformed config block, a config block on another kind, an unknown, out-of-scope, or self connection, a duplicate connection, a containment cycle, an ancestor-descendant connection, and an unknown concern element
- **Then**: ACStack fails on an element with no connection or parent unless it is the only element
- **Then**: ACStack warns on a fog element, a locked element inside a loose one, and an open question on a locked element
- **Then**: `--check` fails while any element's config matches no digest the user approved
- **Then**: Out-of-scope elements leave the design doc; the map holds at most 200 elements and 100 concerns
- **Source**: `cli/src/lib/design-doc.ts`, `cli/src/lib/design-lifecycle.ts`, `cli/src/lib/alignment-packs.ts`

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
- **Then**: A focused toggle returns focus to its replacement control unless the reviewer moves focus elsewhere
- **Then**: Expansion preserves the clicked component's top-left screen position and zoom by moving the camera when necessary
- **Then**: The previous layout guides sibling order without replacing measured content sizes or routing checks
- **Then**: Design containers favor aligned cards and straight connectors when attachment, label, and route-clearance checks permit them
- **Then**: Straightening preserves card positions and shared connection slots, retaining bends when a straight route would be unsafe
- **Then**: Connections crossing a containing component's header can use measured whitespace, with small gaps around intersected subtitle text
- **Then**: Layout first tries compact spacing, with connections entering containers through the top
- **Then**: If the renderer cannot place a route or label safely, it falls back to side entry with wider spacing
- **Then**: Titles, badges, source metadata, and unrelated headers remain protected
- **Then**: Routes and relationship labels avoid measured controls, including comment actions above cards and containers
- **Then**: Missing or stale header measurements keep the whole header blocked
- **Then**: The renderer tries nearby tracks for parallel-route conflicts before increasing diagram-wide spacing
- **Then**: The renderer makes diagonal layout bends orthogonal only when the route preserves its ports and clears cards and headers
- **Then**: If no safe route exists, the viewer retains the previous valid diagram
- **Then**: Relationship names identify their source, action, and target
- **Then**: Source metadata uses a separate toggle
- **When**: A reviewer edits a comment without changing comment counts
- **Then**: The accepted layout remains unchanged
- **When**: Comment counts change
- **Then**: The viewer refreshes header geometry while retaining accepted layout guidance
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
- **Then**: Writes also require an `Origin` equal to the review page's own; a missing, `null`, or foreign `Origin` is rejected
- **Then**: Invalid hosts, oversized bodies, malformed comments, unknown targets, and mismatched versions cannot mutate feedback
- **Source**: `cli/src/lib/review-server.ts`, `cli/src/lib/design-review.ts`, `cli/src/commands/design-doc.ts`, `cli/src/viewer/main.tsx`

### FR-017: Hand saved design comments to an agent

- **Given**: A reviewer opens a live design review
- **When**: The reviewer chooses Send to agent
- **Then**: The viewer waits for pending comments to save before copying the feedback prompt
- **Then**: The prompt identifies the exact `review.json` path and the map on the agent's device
- **Then**: The prompt asks the agent to revise element nodes, reconcile comments, and never lock an element, without a prompt-injection warning
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

## Project data outside the repository

### FR-018: Locate one project folder per repository

- **Given**: The CLI runs inside a Git repository
- **When**: It resolves project data
- **Then**: It keys the repository as `<main checkout folder name>-<first 6 hex of sha256(realpath of the Git common dir)>`
- **Then**: Every worktree of the repository resolves the same project folder, `<ACSTACK_HOME>/projects/<key>`
- **Then**: `ACSTACK_HOME` overrides the default `~/.acstack`; `XDG_CONFIG_HOME` and `XDG_DATA_HOME` no longer locate ACStack files
- **Then**: A real folder is global mode; a link to `<main checkout>/.acstack` is tracked mode
- **Then**: Central path helpers resolve project configuration, the domain map, browser configuration, and verification knowledge directly inside the project folder
- **Given**: No entry exists and the main checkout commits `.acstack/project.yaml`
- **When**: The CLI resolves project data
- **Then**: It creates the tracked-mode link (a junction on Windows) without changing the Git index
- **Given**: No entry exists and a sibling entry with the same folder name records a missing repository, or is a broken link
- **When**: The CLI resolves project data
- **Then**: `acstack project-data path` warns about the orphan and names `acstack project-data relink <entry>`; no command refuses because of an orphan, since it may belong to an unrelated repository with the same folder name
- **Given**: Both a global folder and a committed `.acstack/` exist, or the repository still holds legacy data
- **When**: The CLI resolves project data
- **Then**: It refuses with a message naming `project-data mode` or `project-data migrate`, and creates nothing
- **Given**: The working directory is outside Git
- **When**: A command needs project data
- **Then**: The CLI reports that there is no project
- **Then**: `acstack project-data path` prints the folder path even before the folder exists, and exits non-zero outside Git
- **Source**: `cli/src/lib/constants.ts`, `cli/src/lib/project.ts`, `cli/src/commands/project-data.ts`

### FR-019: Move data only on an explicit command

- **Given**: A user runs `acstack project-data mode tracked` or `mode global`
- **When**: The project is in the other mode
- **Then**: ACStack moves the folder to `<main checkout>/.acstack` and links it, or removes the link and moves `.acstack/` into the global folder
- **Then**: It refuses to overwrite an existing destination, refuses tracked mode for a bare repository, and restores the previous state when linking fails
- **Then**: Cross-device moves copy into a temporary sibling and rename it into place, so an interrupted copy never leaves a half-filled destination
- **Given**: A repository moved and left an orphaned entry
- **When**: The user runs `acstack project-data relink <entry>`
- **Then**: ACStack renames that named orphan to the new key, and refuses when it is not an orphan or the new key already exists
- **Then**: Commands report other worktrees whose own `.acstack/` changes ACStack no longer reads
- **Then**: No command changes the Git index or force-adds files
- **Source**: `cli/src/commands/project-data.ts`, `cli/src/lib/project-data.ts`

### FR-020: Run no project-data policy at startup

- **Given**: Any CLI invocation starts
- **When**: The CLI dispatches the command
- **Then**: It writes no `.gitignore` rules and runs no project-data enforcement
- **Given**: Legacy data remains in the repository or in `~/.config/acstack` or `~/.local/share/acstack`
- **When**: `acstack project-data path` runs
- **Then**: It warns on stderr that ACStack no longer reads those locations and names `project-data migrate`
- **Source**: `cli/src/index.ts`, `cli/src/commands/project-data.ts`, `cli/src/lib/project-data.ts`

### FR-021: Migrate legacy data with collision checks

- **Given**: The user updates installed tools, stops old agents and review servers, and backs up
- **When**: The user runs `acstack project-data migrate` from a repository
- **Then**: ACStack first moves the oldest `acstack/` layout and loose root records into `.acstack/`, as before, with rollback on failure
- **Then**: When `.acstack/` is in the Git index, it links the project folder to it (tracked mode)
- **Then**: Otherwise it moves `.acstack/` into the global project folder and records the repository in `project.json`
- **Then**: It removes the managed block older releases kept in the root `.gitignore`
- **Then**: It moves `~/.config/acstack/*` to `~/.acstack/` and `~/.local/share/acstack/*` to `~/.acstack/cache/`
- **Then**: It preflights every destination and refuses before moving anything when one exists
- **Then**: It leaves the Git index unchanged
- **Source**: `cli/src/commands/project-data.ts`, `cli/src/lib/project-data.ts`

### FR-022: Retire alignment settings without rewriting existing configuration

- **Given**: Configuration contains legacy `workflow.alignment_packs` settings
- **When**: ACStack loads configuration
- **Then**: All legacy alignment settings have no effect
- **Then**: ACStack leaves the existing configuration bytes unchanged
- **When**: A user lists defaults or tries to set a legacy alignment key
- **Then**: The CLI offers no alignment defaults and rejects the unsupported write
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

### FR-024: Reserve label space before widening the diagram

- **Given**: A measured design has clear connectors but relationship labels cannot fit
- **When**: The viewer retries the layout
- **Then**: It uses the failed labels' dimensions to increase track and attachment spacing at their endpoints and shared container
- **Then**: The first label-only retry keeps the normal card gaps and container padding
- **Then**: Repeated label failures also increase card gaps and container padding within the bounded layout attempts
- **Then**: A layout that already fits keeps its original spacing
- **Source**: `cli/src/viewer/alignment-graph.ts`, `cli/src/viewer/compact-layout.test.ts`

### FR-025: Balance horizontal placement in design diagrams

- **Given**: An authored design branches toward destinations inside and outside component boundaries
- **When**: The viewer positions its measured nodes
- **Then**: It uses balanced horizontal placement while retaining downward flow and nested component boundaries
- **Then**: It lets the layered layout choose local connector order before assigning fixed, corner-safe attachment slots
- **Then**: Local connectors can change slots while cross-boundary connectors keep their reserved slots
- **Then**: Route clearance, label placement, and expand/collapse anchor checks still apply
- **Source**: `cli/src/viewer/alignment-graph.ts`, `cli/src/viewer/compact-layout.test.ts`, `cli/src/viewer/crossing-layout.test.ts`

### FR-026: Answer and lock through the map's tracker

- **Given**: A hitl node targets an element, meaning its `answers` parent is an element node
- **When**: The reviewer saves an answer in the viewer
- **Then**: The server checks the exact revision tuple and that the question is still open, then appends `## Answer` and resolves the node through its tracker
- **Then**: On GitHub the server edits the issue body and closes it with `gh`; a retry after a failed close does not append the answer twice
- **When**: The reviewer re-approves an element changed since approval, from its drawer or the blocker modal
- **Then**: The server records a fresh config digest and any capture the page supplies; the viewer shows no per-element Lock, Loose, or Locked state otherwise
- **When**: The reviewer changes an answer
- **Then**: The server appends a dated `## Answer (changed YYYY-MM-DD)` section; on GitHub it edits the closed issue's body without reopening it
- **Then**: Answers and locks stay behind the review server's token and host checks
- **Then**: Questions answering the root, and research (afk) or fog nodes, stay off the page
- **Source**: `cli/src/lib/design-map.ts`, `cli/src/lib/design-lifecycle.ts`, `cli/src/viewer/design-approval.tsx`, `cli/src/commands/design-lifecycle-workflow.test.ts`

### FR-027: Reconcile feedback before exact-input approval

- **Given**: A design has posted comments
- **When**: The agent submits `design-review reconcile <map>` decisions
- **Then**: Every comment receives one explicit disposition with a rationale
- **Then**: Historical feedback remains unchanged; reconciliation and approval records reside in the current canonical `review.json`
- **Then**: Previously selected histories and unresolved historical reconciliations remain obligations across later revisions
- **Then**: Only a fresh reconciliation in the current version can settle those obligations
- **Then**: History discovery fails closed on invalid canonical evidence or its 1,024-entry and 16 MiB aggregate limits
- **Then**: Approval binds the element nodes' content, selected feedback histories, comment revision, and the digest of open nodes targeting elements
- **Then**: Lock state is not an approval input, so locking never invalidates approval
- **Then**: Changes to those inputs invalidate effective approval; regenerating presentation leaves it unchanged
- **Then**: Any unsettled node targeting an element, in any mode and including fog, blocks approval; other open nodes do not
- **Then**: Approval locks every loose element through the tracker, recording what the page captured for each
- **Then**: A re-run after an approval that failed midway records the already-resolved elements without resolving them again
- **Given**: An agent edits a locked element's config
- **Then**: The element is unapproved: shown loose, listed as a `changed` blocker with Re-approve, and its tracker node stays resolved
- **Then**: Re-approving in the viewer, or `design-review approve-element <map> <id>` on the user's instruction, records a fresh digest
- **When**: The developer tries to approve while blockers remain
- **Then**: The viewer lists every blocker as `{kind, targetId, label, nodeId}`, and each item opens its element's drawer and, for an answerable question, focuses that question
- **When**: The developer chooses approval in the header or document details
- **Then**: Both controls open one shared confirmation modal without approving until confirmation
- **Then**: Both controls use the same saved-comment and exact-input checks and show `Approved` after success
- **Then**: A temporary approval-request failure permits retry with a fresh input check without reloading or changing comments
- **Source**: `cli/src/lib/design-doc.ts`, `cli/src/lib/design-lifecycle.ts`, `cli/src/lib/design-review.ts`, `cli/src/viewer/design-approval.tsx`, `cli/src/commands/design-lifecycle-workflow.test.ts`, `cli/src/viewer/__tests__/drawer-lifecycle.test.ts`

### FR-030: Open an element's mocks in a sandboxed modal

- **Given**: A selected design element has mocks
- **When**: The reviewer opens the drawer's Mocks tab and picks one
- **Then**: A near full-screen modal opens with a one-line header, one toolbar (mock switcher, an Illustrative tag, a variant segmented control, a Tweaks popover, and Pick elements, each only when it applies), a stage that fills the remaining space, and a comment rail with one composer; it traps focus, closes on Escape, and labels its controls
- **Then**: Mermaid frames size themselves to the rendered diagram, so no mock is cut off at a fixed height
- **Then**: Inline HTML loads in a `sandbox="allow-scripts"` `srcdoc` frame whose content security policy comes first in its head and allows only HTTPS connections
- **Then**: OpenDesigner builds are self-contained HTML in the same srcdoc frame; ACStack adds its bridge only when the build carries none
- **Then**: An OpenDesigner mock switches between its variants and draws its tweaks as ACStack controls, sending OpenDesigner-computed `tweaks` payloads without reloading the frame
- **Then**: Markdown and Mermaid use the existing sanitized renderer; JSON and CSV fixtures render as text-only tables
- **Then**: The viewer talks to frames only through a vendored copy of OpenDesigner's bridge, which enforces the protocol's trust checks, load tracking, and rate limit
- **Then**: Frame-supplied fields render as text only
- **When**: The reviewer comments on a mock, optionally after picking one or more elements in it
- **Then**: The comment targets the element and stores the mock path, the variant, the current tweak values, and each picked element's selector, bounding box, text, and component with its props and fixture
- **Then**: The frame receives numbered marks only, never comment text; clicking a comment reveals its element or flags it as unanchored
- **When**: The reviewer locks the element or approves the design
- **Then**: The lock records, for each OpenDesigner mock the reviewer viewed, the variant shown, its tweak values, and every state that variant offers
- **When**: A link names an element's mock and variant
- **Then**: The Mocks modal opens directly on that mock and variant
- **Source**: `cli/src/viewer/mocks.ts`, `cli/src/viewer/mocks-modal.tsx`, `cli/src/viewer/mock-frame.tsx`, `cli/src/viewer/od-bridge/`, `cli/src/lib/alignment-packs.ts`

### FR-032: Attach checked mocks to design elements

- **Given**: An element node's `Design element` block lists `mocks:` entries, each naming one of `od`, `html`, `markdown`, `mermaid`, or `fixture`
- **When**: The design doc loads
- **Then**: File paths resolve inside `<project folder>/maps/<map>/elements/<element-id>/`; absolute paths, `..` segments, missing files, and symlinks out of the folder fail the build
- **Then**: JSON and CSV fixtures over 20 KB, or not matching their optional JSON Schema, fail the build
- **Then**: A lock's digest covers each binding mock's file contents (a fixture with its schema) and, for `od`, the OpenDesigner page entry and variant source files, so editing one unapproves a locked element; illustrative mocks and built output stay out
- **Then**: An `od` entry must name an OpenDesigner design and page that exist in the checkout's `.open-designer/`
- **Then**: The build warns on a loose element's mock with fewer than two variants, a locked element with only illustrative mocks, inline HTML while OpenDesigner is installed, and a mock file over 5 MB
- **Then**: The page carries only mock summaries; content loads when the modal opens, from a token-gated `GET /api/mocks` that builds `od` mocks with `open-designer build`
- **Then**: OpenDesigner mocks return their variants, tweak definitions, and design-system token map, so `add` and `scale` tweaks compute against real token values
- **Then**: Each summary carries a revision digest of the mock's sources; a running review watches referenced OpenDesigner design folders, and the viewer refetches a mock when its revision changes, keeping the old content on screen until the new one arrives
- **When**: A loose element has a mock with several variants
- **Then**: Approval lists a `variant` blocker whose link opens that mock in the element's Mocks view
- **Then**: Locking the element is refused unless its capture names one of that mock's variants
- **When**: An agent runs `design-review approve-element <map> <id>` on the user's instruction
- **Then**: Each multi-variant mock needs `--variant <mock path>=<variant id>`; the error names the mocks and their variants, and the capture keeps the variant's tweak defaults and every state
- **Source**: `cli/src/lib/design-mocks.ts`, `cli/src/lib/design-doc.ts`, `cli/src/lib/design-map.ts`, `cli/src/lib/design-lifecycle.ts`, `cli/src/lib/review-server.ts`, `cli/src/commands/design-doc.ts`, `cli/src/viewer/mocks-modal.tsx`

