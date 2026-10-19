# Orchestration spec

ACStack chooses verification effort to fit changed behavior while preserving required checks.

## FR-001: Choose checks before nontrivial work

- **Given**: A request changes meaningful behavior
- **When**: An agent plans implementation
- **Then**: The agent considers plausible failures, useful checks, tests-first work, and independent review
- **Then**: One agent may investigate, test, implement, and verify straightforward work
- **Then**: Explicit stronger process requests still apply
- **Then**: Scope changes or inadequate checks trigger reconsideration
- **Source**: `orchestrator/AGENTS.md`, Implementation discipline

## FR-002: Require meaningful regression evidence

- **Given**: Existing coverage cannot detect mistakes in meaningful changed behavior
- **When**: An agent implements the change
- **Then**: The agent adds requirements-based automated tests when practical
- **Then**: Bug fixes receive regression protection, while refactors may reuse adequate coverage
- **Then**: Nonbehavioral edits require no new tests, and the agent judges configuration by its effect
- **Then**: Impractical automated testing requires an explanation, the nearest executable check, and disclosure of missing regression protection
- **Then**: Test counts and mocked assertions alone do not establish adequacy
- **Source**: `orchestrator/AGENTS.md`, Implementation discipline

## FR-003: Prefer practical tests-first development

- **Given**: A practical failing test can guide a bug fix or clear new behavior
- **When**: An agent implements the change
- **Then**: The agent prefers writing the failing test first and confirms the intended failure
- **Given**: Work needs exploration before the agent settles behavior
- **When**: The agent settles the behavior
- **Then**: The agent tests it before completion and explains departures from tests-first work
- **Then**: Neither code nor assertions invent unsettled requirements
- **Source**: `orchestrator/AGENTS.md`, Implementation discipline

## FR-004: Require independent review for consequential uncertainty

- **Given**: Work affects security boundaries, money, irreversible data changes, or unresolved correctness or impact uncertainty
- **When**: An agent seeks completion
- **Then**: Another agent or qualified reviewer provides independent review
- **Then**: Unavailable review blocks a completion claim
- **Given**: Tests have a separate owner
- **When**: An implementer changes source
- **Then**: The implementer preserves that ownership and routes test defects back without weakening tests
- **Source**: `orchestrator/AGENTS.md`, Implementation discipline

## FR-005: Preserve required completion gates

- **Given**: Direct or delegated implementation will edit configured frontend files
- **When**: The implementer prepares the first edit
- **Then**: The implementer reads the shared pre-edit procedure and loads design context once when the gate is on

- **Given**: A project configures completion, release, formatting, design, or browser checks
- **When**: An agent verifies work
- **Then**: The verification owner completes applicable checks even without a delegated task-checker
- **Then**: Security, validation, accessibility, data-loss protection, and commit-time spec sync remain required
- **Then**: The report names evidence, blocked checks, and remaining risks
- **Source**: `orchestrator/AGENTS.md`, `skills/implement/design-pass.md`

## FR-006: Retire legacy sequencing guarantees

- **Given**: Configuration contains either deprecated workflow TDD boolean, including explicit `true`
- **When**: An agent chooses sequencing or delegation
- **Then**: Neither boolean controls the choice or supplies an effective default
- **Then**: Existing files remain unchanged unless edited by the user
- **Then**: ACStack removes the former strict sequencing and delegation guarantee
- **Source**: `orchestrator/AGENTS.md`, Deprecated workflow booleans

## FR-007: Enforce metadata privacy before host project activation

- **Given**: A Claude Code or pi session starts
- **When**: The host resolves the project root
- **Then**: It recognizes canonical metadata or positive legacy record markers instead of treating every `acstack/` source directory as metadata
- **Then**: It falls back to the Git checkout root or working directory when no metadata root exists
- **Then**: It invokes the production CLI's `project-data ensure` before checking project configuration or writing private metadata
- **Given**: Policy enforcement fails or recognized legacy records remain
- **When**: The host prepares project activation
- **Then**: It reports the problem and skips project activation and private writes
- **Then**: Legacy warnings name the explicit migration command without silently moving records
- **Then**: Installed launchers under `~/.claude/acstack/bin/` retain their existing paths
- **Source**: `hooks/project-data.sh`, `hooks/session-start.sh`, `pi/extension.ts`
