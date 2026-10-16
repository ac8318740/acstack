# Skills spec

Implementation skills apply the shared policy while preserving their task-specific checks.

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
- **Then**: An enabled gate requires one context load through the returned launcher before editing
- **Then**: A disabled gate requires no impeccable call
- **Then**: The agent follows resolved context and reports ownership directives without rerunning context or updating impeccable
- **Then**: The agent leaves `PRODUCT.md` and `DESIGN.md` to their owners and leaves the post-write hook to impeccable
- **Source**: `skills/implement/design-pass.md`
