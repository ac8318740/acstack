# Agents spec

ACStack supplies optional specialized agents that follow the shared implementation policy.

## FR-001: Implement with conditional test ownership

- **Given**: A task-executor receives implementation work
- **When**: The task assigns no separate test owner
- **Then**: The executor may write source and tests after reading test-conventions
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
