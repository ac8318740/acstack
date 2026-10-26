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
- **Then**: Review depth follows plausible failures in affected security, resource lifecycle, concurrency, and performance paths
- **Then**: Evidence of connected risk, rather than file proximity, justifies wider scope
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
- **Then**: One verification owner gathers applicable checks for the final revision, even without a delegated task-checker
- **Then**: Focused local checks cover changed behavior, affected callers, and relevant integrations without repeating all completion commands at every handoff or commit
- **Then**: A configured command alone does not require its entire suite; full local runs require explicit instructions or impact that narrower checks cannot adequately cover
- **Then**: Opening a PR does not require running every test locally; required CI checks pass before merge
- **Then**: Agents confirm CI covers deferred checks and report local results, deferred checks, and unverified behavior separately
- **Then**: Reused evidence names its command, working directory, tested revision, relevant environment, and result
- **Then**: Relevant source, test, configuration, dependency, generated-input, or environment changes invalidate affected results
- **Then**: Uncertain validity or changed external state requires rerunning affected checks
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

## FR-008: Load communication guidance independently of project activation

- **Given**: A host dispatches the registered SessionStart or SubagentStart hook
- **When**: The communication hook runs
- **Then**: It returns the complete canonical marked standard as event-specific additional context
- **Then**: Injection requires neither initialized project metadata nor successful orchestrator activation
- **Then**: The selected-style per-turn reminder remains separate
- **Then**: pi parent sessions retain their existing style controls and child-session orchestrator guard
- **Then**: pi's off mode disables parent style injection and reminders; custom mode reads the configured style path
- **Then**: pi skips extension registration when `PI_SUBAGENT_CHILD` or `PI_SUBAGENTS_HERDR_BRIDGE` equals `1`
- **Then**: Generated child definitions retain their inline canonical standard independently of parent style settings
- **Source**: `hooks/communication-standard.sh`, `hooks/communication-standard.mjs`, `hooks/hooks.json`, `hooks/lib/communication-standard.mjs`, `pi/extension.ts`

## FR-009: Use the host's subagent tool

- **Given**: An agent delegates work on pi
- **When**: The installed package exposes `Agent` or `subagent`
- **Then**: The agent uses `Agent` with `subagent_type`, or `subagent` with `agent`
- **Then**: Read-only searches use `Explore` through `Agent`, or `scout` through `subagent`
- **Given**: A pi session passes project-data policy enforcement
- **When**: pi exposes none of `Agent`, `subagent`, or `team_agent`
- **Then**: The extension warns once per extension instance and recommends `pi install npm:ac-teams`
- **Then**: Any of those three tools suppresses the missing-tool warning
- **Then**: Task, messaging, and workflow tools alone do not suppress that warning
- **Source**: `orchestrator/AGENTS.md`, Host tools; `pi/extension.ts`

## FR-010: Bound review and keep adjacent cleanup advisory

- **Given**: A session delegates review
- **When**: The reviewer receives the assignment
- **Then**: The assignment names a bounded question, affected paths, requirements, known risks, and available evidence
- **Then**: A focused reviewer does not inherit completion ownership without explicit assignment
- **Given**: Review reveals worthwhile adjacent cleanup
- **When**: The session reports it
- **Then**: The cleanup remains advisory until the user approves scope expansion
- **Then**: Approved independent cleanup may run in parallel without blocking the main change or conflicting with other writers
- **Then**: A defect preventing requested behavior or exposing consequential risk remains an in-scope fix or reported blocker
- **Source**: `orchestrator/AGENTS.md`, Implementation discipline

## FR-011: Prefer interfaces that hide complexity

- **Given**: An agent implements or reviews code
- **When**: It assesses module boundaries
- **Then**: It prefers interfaces that reduce facts callers need and give each rule one owner
- **Then**: Readable names and control flow matter more than helper counts, shorter functions, or fewer lines
- **Source**: `orchestrator/AGENTS.md`, Implementation discipline
