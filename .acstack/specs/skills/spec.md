# Skills spec

Workflow skills apply shared implementation, communication, and design-review guidance.

## FR-001: Use the shared implementation discipline

- **Given**: An agent runs implement, quick-fix, or map work
- **When**: The agent chooses testing and delegation
- **Then**: The skill refers to `orchestrator/AGENTS.md` rather than requiring a universal agent sequence
- **Given**: Pre-commit review runs
- **When**: The reviewer assesses the change
- **Then**: The reviewer assesses coverage without assuming another checker already did so
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
- **Source**: `skills/setup/SKILL.md`, `skills/setup/first-run.md`, `skills/setup/report.md`

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
- **Given**: Relationships need visual explanation
- **When**: The visual-docs skill structures the document
- **Then**: The skill chooses diagrams and sections to explain those relationships without requiring a diagram-node-to-heading correspondence
- **Source**: `skills/writing/SKILL.md`, `skills/writing/examples.md`, `skills/visual-docs/SKILL.md`, `output-styles/ac-writing-style.md`

## FR-006: Author a design for human review

- **Given**: An agent runs the design-doc skill
- **When**: The agent prepares the review source
- **Then**: The agent separates existing behavior from the proposed change and explains the review questions, trade-offs, and worked journey
- **Then**: The agent models real entities with atomic files, genuine containment, mirrored relationships, and explained cross-element concerns
- **Then**: New project designs default to `.acstack/designs/<id>/design.yaml` unless the user chooses another location
- **Then**: Plugin worked examples remain public source under `examples/design-doc/acstack/`
- **Then**: The agent starts a live design review through localhost or SSH and optionally exports Markdown for GitHub
- **Then**: Posted, edited, and deleted comments save on the agent's device without approving the design
- **Then**: Send to agent waits for saved comments and provides a clipboard prompt naming the review JSON and authored entry
- **Then**: A clipboard failure leaves the prompt available for manual copying
- **Then**: The agent reads the printed `review.json`, resolves comment targets against the authored design, and revises that source
- **Then**: The agent uses the developer's comments as requests to revise the design
- **Then**: The skill preserves feedback with its source version and explains failed saves and conflicting revisions
- **Then**: Nesting expresses containment without a duplicate containment arrow
- **Then**: Automatic map invocation, map reconciliation, durable approval, archiving, and legacy command removal remain outside this implemented slice
- **Source**: `skills/design-doc/SKILL.md`, `examples/design-doc/acstack/`

## FR-007: Offer independent tracking choices for every project-data part

- **Given**: Setup creates `.acstack/` for a new project
- **When**: Setup prepares project metadata
- **Then**: Setup runs `project-data ensure` immediately, before writing metadata
- **Then**: Setup offers all 17 project-data parts through multi-select questions with none preselected
- **Then**: The choices include project configuration, the domain map, specs, maps, authored designs, archives, changes, alignment packs, and design reviews
- **Then**: The choices also include architecture decisions, the glossary, browser configuration, verification knowledge, the test baseline, decision logs, continuation anchors, and agent handoffs
- **Then**: Selecting nothing leaves every part ignored
- **Then**: Selected parts receive native root `.gitignore` exceptions after existing rules, with parent directories reopened first
- **Then**: Setup preserves user rules without changing the Git index or force-adding ignored files
- **Then**: Setup neither offers nor generates `workflow.alignment_packs.commit_generated_packs` or a YAML tracking setting
- **Source**: `skills/setup/first-run.md`, `skills/setup/SKILL.md`, `docs/config-reference.md`

## FR-008: Keep shared decision logs in the explicitly migrated main checkout

- **Given**: An afk run needs to write its decision log
- **When**: The agent resolves the main checkout
- **Then**: The log belongs at `<main checkout>/.acstack/decision-logs/<name>.tsv`, not in the worktree
- **Given**: The main checkout still contains legacy project records
- **When**: The agent prepares a log write
- **Then**: The agent stops with instructions to update tools, stop old processes, and explicitly migrate that checkout
- **Then**: The agent neither migrates another checkout automatically nor creates a partial `.acstack/` there
- **Given**: The main checkout uses the canonical layout
- **When**: The agent prepares a log write
- **Then**: The agent runs `project-data ensure` first without adding a nested ignore file
- **Source**: `skills/implement/decision-log.md`
