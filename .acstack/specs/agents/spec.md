# Agents spec

ACStack supplies optional specialized agents that follow the shared implementation policy.

## FR-001: Implement with conditional test ownership

- **Given**: A task-executor receives implementation work
- **When**: The task assigns no separate test owner
- **Then**: The executor may write source and tests after reading test-conventions
- **Then**: The executor checks responsibilities, comparable abstraction levels, and the interfaces callers need without adding unnecessary layers
- **Given**: The task assigns a separate test owner
- **When**: The executor implements the change
- **Then**: The executor leaves those tests to their owner
- **Then**: The generated Pi executor binds the test-conventions skill
- **Given**: A task-executor will edit configured frontend files
- **When**: The executor prepares its first edit
- **Then**: The executor follows the shared design-context procedure rather than an agent-local copy
- **Source**: `agents/task-executor.md`, `scripts/gen-pi-agents.mjs`

## FR-002: Review evidence without a fixed agent sequence

- **Given**: A task-checker receives independent verification work
- **When**: The checker reviews a change
- **Then**: The checker assesses coverage, realistic mistakes, regressions, integration, and applicable ownership constraints
- **Then**: The checker examines connected callers and dependencies for coherent boundaries, consistent names, and interfaces that hide implementation complexity
- **Then**: The checker requires neither fresh tests for every edit nor source mutation
- **Then**: For design work, the checker returns file discovery and detector findings to the parent without running source-editing polish
- **Then**: The checker independently rechecks polished code returned by the parent before configured browser verification
- **Given**: A frontend-verifier receives final code
- **When**: Applicable checks and design gates have passed
- **Then**: The verifier performs configured real-browser verification without fixed phase prerequisites
- **Source**: `agents/task-checker.md`, `agents/frontend-verifier.md`

## FR-003: Keep independent tests requirements-based

- **Given**: A separate test-writer receives a task
- **When**: The writer derives assertions
- **Then**: The writer uses requirements, acceptance criteria, and interfaces rather than implementation plans or current answers
- **Then**: The writer reports unsettled requirements instead of inventing behavior
- **Source**: `agents/test-writer.md`

## FR-004: Include the canonical standard in generated agents

- **Given**: A generator prepares the provided Codex or pi agent definitions
- **When**: It reads communication guidance
- **Then**: It extracts the complete marked block from `output-styles/ac-writing-style.md`
- **Then**: Every generated definition includes that block without depending on inherited parent context
- **Then**: Codex fields and pi frontmatter, tools, and skill bindings retain their supported formats
- **Given**: The canonical block is missing, empty, duplicated, or malformed
- **When**: Generation runs
- **Then**: It fails before removing previously generated definitions
- **Source**: `scripts/gen-codex-agents.mjs`, `scripts/gen-pi-agents.mjs`, `hooks/lib/communication-standard.mjs`

## FR-005: Install Codex roles without replacing user definitions

- **Given**: The startup hook runs on a machine with a `~/.codex` directory
- **When**: It reconciles the provided Codex definitions
- **Then**: It copies changed generated files into `~/.codex/agents/`
- **Then**: It preserves an existing same-name definition without the generator marker
- **Then**: Without `~/.codex`, it skips role installation
- **Given**: A user verifies Codex delivery
- **When**: The user prepares the host
- **Then**: The user enables hooks and trusts the reviewed hook source through Codex's trust flow
- **Then**: Noninteractive automation establishes trust before expecting startup context
- **Then**: The user starts a fresh session after the first installation because Codex discovers roles before the startup hook runs
- **Then**: Native named-role verification uses the v1 agent tool rather than assuming the v2 collaboration interface selects roles
- **Source**: `hooks/session-start.sh`, `CONTRIBUTING.md`, Codex agent definitions
