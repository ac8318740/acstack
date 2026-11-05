# Skills spec

Workflow skills apply shared implementation, communication, and design-review guidance.

## FR-001: Use the shared implementation discipline

- **Given**: An agent runs implement, quick-fix, or map work
- **When**: The agent chooses testing and delegation
- **Then**: The skill refers to `orchestrator/AGENTS.md` rather than requiring a universal agent sequence
- **Then**: Focused checks verify individual nodes and fixes; one owner gathers final completion evidence and reuses valid results
- **Given**: Pre-commit review runs
- **When**: The reviewer assesses the change
- **Then**: The reviewer assesses coverage without assuming another checker already did so
- **Then**: Relevant review dimensions follow plausible failures instead of requiring blanket audits or repeated discovery
- **Then**: Adjacent suggestions remain separate and advisory in interactive and auto-fix modes
- **Then**: The reviewer asks before expanding scope; approved independent cleanup may run in parallel without blocking the main change
- **Source**: `skills/implement/SKILL.md`, `skills/quick-fix/SKILL.md`, `skills/map/SKILL.md`, `skills/pre-commit-review/SKILL.md`

## FR-002: Assign frontend checks to the verification owner

- **Given**: Configured frontend files changed and the design gate is on
- **When**: The verification owner prepares completion evidence
- **Then**: The owner discovers changed files and runs the detector before audit and polish
- **Then**: Detector exit code 2 fails verification, other nonzero codes produce warnings, and advisory results never change the verdict
- **Then**: A delegated checker returns the file list and findings without editing files
- **Then**: The parent session types audit and polish
- **Then**: A chosen independent checker rechecks polished code before configured real-browser verification
- **Then**: Without a delegated checker, the parent rechecks polished code
- **Then**: Factual claims remain unchanged during unattended polish
- **Then**: The report repeats deferred design commands against their findings
- **Source**: `skills/implement/design-pass.md`

## FR-003: Omit deprecated workflow booleans from setup

- **Given**: A user configures a new project
- **When**: Setup offers workflow choices or generates project YAML
- **Then**: Setup neither offers nor generates `workflow.tdd.strict` or `workflow.tdd.orchestrator_strict`
- **Then**: Setup describes adaptive verification through the shared policy
- **Source**: `skills/setup/SKILL.md`, `skills/setup/first-run.md`, `skills/setup/report.md`, `skills/setup/row-fixes.md`

## FR-004: Load shared design context before frontend edits

- **Given**: An agent will edit a file under configured `frontend.directory`
- **When**: The agent prepares its first edit for the task
- **Then**: The agent follows the shared pre-edit procedure and checks the design gate through its JSON response
- **Then**: The guidance reuses the project's font family and a small type scale, with identical typography for equivalent text
- **Then**: Typography variations express meaningful visual hierarchy
- **Then**: Related elements share edges or baselines, with consistent spacing and indentation expressing their hierarchy
- **Then**: Status text and adjacent controls share a vertical center, including nested action groups
- **Then**: Browser checks measure alignment and spacing in normal, pending, error, and narrow layouts
- **Then**: Dropdown menus reuse shared project components and tokens instead of browser-native menus or screen-specific copies
- **Then**: Changed dropdowns retain keyboard navigation, screen-reader semantics, visible focus, dismissal, and viewport fit
- **Then**: An enabled gate requires one context load through the returned launcher before editing
- **Then**: A disabled gate requires no impeccable call
- **Then**: The agent follows resolved context and reports ownership directives without rerunning context or updating impeccable
- **Then**: The agent leaves `PRODUCT.md` and `DESIGN.md` to their owners and leaves the post-write hook to impeccable
- **Source**: `skills/implement/design-pass.md`

## FR-005: Apply one shared communication standard

- **Given**: An agent writes a reply or durable artifact
- **When**: The writing skill loads its communication guidance
- **Then**: The skill reads the canonical marked block in `output-styles/ac-writing-style.md` and its writing examples
- **Then**: The guidance preserves necessary information while using clear words, comparable siblings, consistent names, and parent summaries
- **Then**: The guidance chooses structure from the ideas rather than enforcing word counts or bullet quotas
- **Given**: An agent implements or reviews code
- **When**: The agent applies the shared architecture principles
- **Then**: The agent checks coherent responsibilities, comparable peer components, and small interfaces that hide real complexity
- **Then**: Code review and pre-commit review inspect connected callers without requiring nesting, pass-through layers, or arbitrary size limits
- **Given**: Relationships need visual explanation
- **When**: The visual-docs skill structures the document
- **Then**: The skill chooses diagrams and sections to explain those relationships without requiring a diagram-node-to-heading correspondence
- **Source**: `skills/writing/SKILL.md`, `skills/writing/examples.md`, `skills/visual-docs/SKILL.md`, `skills/code-review/SKILL.md`, `skills/pre-commit-review/SKILL.md`, `output-styles/ac-writing-style.md`

## FR-006: Author a design doc on a map for human review

- **Given**: An agent runs the design-doc skill
- **When**: The agent prepares the design doc
- **Then**: The agent separates existing behavior from the proposed change and explains the review questions, trade-offs, and worked journey in the map root
- **Then**: The agent writes one `element` node per real entity, with a collapsed `Design element` block for kind, parent, channels, and connections
- **Then**: Each connection is declared once, on the acting element; nesting expresses containment without a duplicate arrow
- **Then**: Cross-element concerns live in the root's `Design doc` block
- **Then**: Peer elements use comparable abstractions and consistent names across the overview, relationships, and detail
- **Then**: The agent creates elements open and never locks one; only the user locks
- **Then**: Questions for the user hang off the element they target with `answers`, with an optional `Design question` block of choices, `multiple`, and quoted highlights
- **Then**: The agent runs `design-doc <map> --check` and fixes contradictions before review
- **Then**: Interactive review and the Markdown companion derive from the same map nodes
- **Then**: Plugin worked examples remain public source under `examples/design-doc/acstack/`
- **Then**: The agent starts a live design review through localhost or SSH and optionally exports Markdown for GitHub
- **Then**: Posted, edited, and deleted comments save on the agent's device without approving the design
- **Then**: Answers resolve their question nodes through the tracker; the agent picks up follow-ups at its next frontier recompute
- **Then**: Send to agent waits for saved comments and provides a clipboard prompt naming the review JSON and the map
- **Then**: The agent reads the printed `review.json`, resolves comment targets against the map, and revises element nodes
- **Then**: The agent reconciles every comment explicitly before approval; approval locks every loose element
- **Then**: Map planning invokes design-doc for changes to behavior, boundaries, or data flow
- **Source**: `skills/design-doc/SKILL.md`, `skills/map/SKILL.md`, `skills/map/materialising.md`, `examples/design-doc/acstack/`

## FR-007: Ask where a new project's records live

- **Given**: Setup finds no `project.yaml` in the project folder
- **When**: Setup prepares project metadata
- **Then**: Setup creates the folder `acstack project-data path` prints and writes `project.yaml` there
- **Then**: Setup asks whether records stay outside the repository (global mode, recommended) or are committed with it (tracked mode)
- **Then**: For tracked mode, setup runs `project-data mode tracked` and tells the user to commit `.acstack/` from the main checkout
- **Then**: Setup never stages or commits `.acstack/` and writes no `.gitignore` rules
- **Source**: `skills/setup/first-run.md`, `skills/setup/SKILL.md`, `docs/config-reference.md`

## FR-008: Keep shared decision logs in the project folder

- **Given**: An afk run needs to write its decision log
- **When**: The agent resolves where to write it
- **Then**: The log belongs at `<project folder>/decision-logs/<name>.tsv`, shared by every worktree
- **Given**: `project-data path` fails because legacy records exist
- **When**: The agent prepares a log write
- **Then**: The agent stops, passes the message on, and tells the user to update tools, stop old processes, and run `project-data migrate`
- **Then**: The agent neither moves records nor creates a partial project folder
- **Given**: Archive closes the map
- **When**: It extracts lasting decisions from the log
- **Then**: Archive retains the original decision log independently of `workflow.maps.persist`
- **Source**: `skills/implement/decision-log.md`, `skills/archive/SKILL.md`

## FR-009: Require design approval before implementation and archive

- **Given**: A map has `element` nodes
- **When**: Implementation or archive checks `design-review status <map>`
- **Then**: The agent requires valid approval for the current element nodes, saved comments, and open nodes targeting elements
- **Then**: Invalid approval or unresolved reconciliation returns the work to design-doc
- **Then**: Element nodes never reach the frontier on either tracker
- **Given**: Archive prepares node disposal
- **When**: Fog, open questions, claims, or undecided scope remain
- **Then**: Archive stops until the work resolves or the user explicitly drops the scope
- **Source**: `skills/implement/SKILL.md`, `skills/map/SKILL.md`, `skills/map/materialising.md`, `skills/map/alignment.md`, `skills/map/trackers/`, `skills/archive/SKILL.md`

## FR-010: Retain review evidence

- **Given**: Archive disposes of temporary map nodes
- **When**: It checks durable records
- **Then**: It retains canonical reviews, original alignment artifacts, and decision logs independently of `workflow.maps.persist`
- **Then**: It retains handoffs containing review evidence or provenance absent elsewhere
- **Then**: It stops if a retained record lies inside the proposed node disposal path
- **Then**: It preserves native Git ignore rules without force-adding private records
- **Source**: `skills/design-doc/SKILL.md`, `skills/archive/SKILL.md`

## FR-011: Explain the Markdown inspection shortcut

- **Given**: A user applies the terminal workspace with Yazi enabled
- **When**: The agent follows the terminal-workspace skill
- **Then**: The skill explains lowercase `i` opens Markdown in Frogmouth and gives `pipx install frogmouth` for the separate installation
- **Then**: The skill states existing `i` bindings take precedence and `e` keeps editing in `$EDITOR`
- **Source**: `skills/terminal-workspace/SKILL.md`

## FR-012: Preserve valid check evidence across continuation

- **Given**: A session prepares a handoff or compaction anchor
- **When**: It references prior check evidence
- **Then**: It preserves the tested revision, relevant environment, command, and result or log references
- **Then**: The handoff or compaction alone does not require rerunning the suite
- **Then**: Evidence held only in conversation is anchored rather than lost
- **Source**: `skills/handoff/SKILL.md`, `skills/compact-and-continue/SKILL.md`

## FR-013: Recommend ac-teams for the terminal workspace

- **Given**: A user enables pi in the terminal workspace
- **When**: The agent explains setup, configuration, or updates
- **Then**: The skill recommends ac-teams for delegation, shared tasks, and messaging
- **Then**: The skill does not recommend separate delegation or todo packages, or offer `pi.todo`
- **Then**: The update instructions use ac-teams for npm version checks and pinned-package examples
- **Source**: `skills/terminal-workspace/SKILL.md`, `skills/terminal-workspace/components.md`, `skills/terminal-workspace/config-choices.md`, `skills/terminal-workspace/turn-off-and-update.md`

## FR-014: Review ignored data and clean build outputs at teardown

- **Given**: A user runs the teardown-worktree skill
- **When**: It classifies each worktree before removal
- **Then**: It lists ignored paths with sizes and classes each as rebuildable or preserve
- **Then**: It classes a path rebuildable only when a tool-native command regenerates it from tracked files
- **Then**: It skips a worktree holding a preserve path unless the user approves losing that named path
- **Then**: It offers to clean rebuildable build outputs in worktrees that stay, only where no live agent or process runs
- **Then**: It never runs `git clean -x`, stops an agent, removes a worktree, or deletes a Docker volume to reclaim space
- **Source**: `skills/teardown-worktree/SKILL.md`, `skills/teardown-worktree/artifacts.md`
