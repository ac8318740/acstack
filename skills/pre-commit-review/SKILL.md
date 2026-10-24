---
name: pre-commit-review
description: "Deep code quality review of all changes since last commit. Checks for hardcodes, single-source-of-truth violations, scalability issues, edge cases, and project convention drift using dynamic project awareness (living specs, codebase search, surrounding code). Reports adjacent cleanup as advisory, requiring user approval before edits. Auto-invocable in two contexts – (1) when working autonomously through a task list and about to commit (e.g., user said \"implement all tasks and commit\"), use --auto-fix mode; (2) when the user manually invokes /commit and this skill has not already run on the current changes, use INTERACTIVE mode (default). Manual invocation via /pre-commit-review also uses interactive mode by default."
argument-hint: "[--auto-fix] [scope description]"
---

# Pre-commit review

This skill runs a deep review of code quality in uncommitted changes, using dynamic
project awareness. It finds issues that linters miss: hardcodes, duplicated logic, missing
edge cases, convention drift, and adjacent rot.

## User input

```text
$ARGUMENTS
```

## Mode detection

Parse `$ARGUMENTS` and invocation context to determine mode:

- **Auto-fix mode**: Use when ANY of these are true:
    - Arguments contain `--auto-fix`, `fix everything`, `auto fix`, or `fix automatically`
    - The LLM works autonomously. The user asked it to implement, commit, and push, or work
    through a task list, or said "handle everything". The LLM itself decided to commit.

      The user is likely not present, so don't block on questions.

- **Interactive mode** (default): Use when ANY of these are true:
    - No `--auto-fix` argument, and the user invoked the skill manually via `/pre-commit-review`
    - The user typed `/commit`, which auto-invokes the skill. The user is clearly present,
    so consult them in question-tool waves (AskUserQuestion on Claude Code).
    - When in doubt, use interactive – it's always safe to ask.

**Rule of thumb**: Who initiated the commit? User typed `/commit` -> interactive.
LLM decided to commit during autonomous work -> auto-fix.

## Workflow overview

```
1. SNAPSHOT  – collect the diff and understand what changed
2. DISCOVER  – learn project conventions dynamically
3. REVIEW    – analyze changes against conventions and requirements
4. ADJACENT  – note related cleanup encountered during review (advisory)
5. REPORT    – synthesize findings
6. FIX       – auto-fix or interactive proposal waves
```

## Step 1: SNAPSHOT

Collect the raw material:

```bash
# All changes (staged + unstaged + untracked) since last commit
git diff HEAD
git diff --cached
git status --short
git log --oneline -3  # recent context
```

Read `.acstack/project.yaml` to understand the project's directory layout, commands, and conventions.

Categorize changed files into scopes using the project configuration:

- **source**: files under `directories.source` from project.yaml
- **frontend**: files under `frontend.directory` from project.yaml (if configured)
- **config**: `*.yaml`, `*.toml`, `*.json`, config files, etc.
- **tests**: files under `directories.tests` from project.yaml
- **other**: everything else

Judge changes by effect, including behavior changed through config, assets, or shipped guidance.
For nonbehavioral edits, review accuracy and run prose lint when Markdown changed.

## Step 2: DISCOVER – Learn project conventions (parallel)

Follow the shared Implementation discipline in `orchestrator/AGENTS.md` for delegation and required independent review.
Investigate relevant dimensions directly or through useful delegation.
Bound each review to changed behavior, connected risks, and the question assigned.
Reuse valid check evidence under the shared policy instead of repeating completion commands.
Discover current conventions rather than hardcoding them.

Read `../../output-styles/ac-writing-style.md` relative to this skill directory; apply its shared standard to code design as well as explanations.

**Living specs and architecture:**

```
Read the living specs relevant to this change:
- Check .acstack/specs/ directory listing
- Read spec.md files for domains touched by the changed files
  (use .acstack/domain-map.yaml to map files -> domains)
- Extract documented conventions, patterns, and requirements (FR-NNN entries)
Report: list of project conventions and patterns relevant to these changes.
```

**Codebase patterns:**

```
Search the codebase for established patterns related to the changes.
When conventions are unclear, search for representative implementations related to the change.
Reuse patterns already established in this review rather than repeating discovery for every function.
Identify: how does the rest of the codebase handle similar things?
Report: established patterns, common approaches, naming conventions observed.
```

**Local context and configuration:**

```
For each changed file, read:
- Changed bodies and surrounding context needed to understand them
- Connected callers and dependencies needed to assess responsibilities, interface costs, and plausible failures
- Expand to full files or wider paths when findings justify it
- Config that governs this area (linter rules, compiler config, etc.)
Report: local conventions, related code patterns, existing abstractions nearby.
```

Synthesize findings into a convention profile for the review.

## Step 3: REVIEW – Analyze changes (parallel)

Assess which dimensions below apply, then review them to the depth justified by plausible failures.
Keep deep scrutiny for affected auth, security, resource lifecycle, concurrency, and performance paths; do not apply unrelated categories mechanically.
Give delegated reviewers the diff and the convention profile from Step 2.
Assess coverage against requirements instead of assuming a task-checker already assessed it.

**Hardcodes and single source of truth:**

```
Examine the diff for:
- Hardcoded values: URLs, ports, credentials, API keys, magic numbers, string literals
  that should be constants or config
- Single Source of Truth violations: same logic/value defined in 2+ places,
  copy-pasted code that should be a shared function, config scattered across files
- Constants that belong in a central config but are inline
- Duplicated type definitions or interfaces

For each finding, report:
  FILE:LINE | SEVERITY (MUST/SHOULD/CONSIDER) | WHAT | WHY | SUGGESTED FIX
```

**Scalability and readability:**

```
Examine the diff for:
- Tangled control flow, repeated decisions, or mixed responsibilities, with concrete evidence of the complexity
- Incoherent boundaries or peer components at mismatched abstraction levels
- Interfaces that expose internals instead of hiding real complexity behind small, useful operations (deep modules)
- Names that misrepresent meaning, or structure driven by folder layout rather than responsibility
- Missing useful boundaries or pass-through layers that add no useful boundary
- Complex conditionals that could be simplified
- Code that would be hard for a new developer to understand
- Performance concerns (N+1 queries, unnecessary re-renders, blocking I/O, unbounded memory or work)
- Resource lifecycle failures (leaked handles, listeners, subscriptions, or tasks; missing cleanup or cancellation)

Do not require nesting or wrappers; neither line count nor indirection measures design quality.
Support design findings with effects on connected callers and dependencies.
Ask whether callers need fewer facts, each rule has one owner, and the interface hides complexity rather than relocating it.

For each finding, report:
  FILE:LINE | SEVERITY (MUST/SHOULD/CONSIDER) | WHAT | WHY | SUGGESTED FIX
```

**Edge cases and failure handling:**

```
Examine the diff for:
- Unhandled null/undefined/None cases
- Empty array/object assumptions
- Missing error handling on I/O, network calls, or DB queries
- Race conditions in async code
- Missing input validation at system boundaries
- Unhappy paths not tested or handled
- Type narrowing gaps (any casts, missing type hints on public APIs)

For each finding, report:
  FILE:LINE | SEVERITY (MUST/SHOULD/CONSIDER) | WHAT | WHY | SUGGESTED FIX
```

**Prose lint on changed Markdown:**

```bash
~/.claude/acstack/bin/acstack lint-prose <changed .md files>
```

Run the lint on the changed Markdown files, and on nothing else. Skip the command when no Markdown file changed, because it exits 1 with no paths.

The lint exits 0 even when it reports findings. It groups findings by file with line numbers, then prints a summary per file. It skips `skills/writing/vocabulary.md` on purpose.

Review each warning in context before treating it as a defect. Preserve necessary technical terms, quotations, and wording that would lose accuracy if changed. Report confirmed clarity or convention problems as `SHOULD | PROSE`, with the `file:line` and their effect on the reader.

## Step 4: ADJACENT – Report cleanup as advisory

Note closely related cleanup encountered while reviewing connected code. Do not launch
an extra scan of whole files and imports solely to find more work.

Report as: `ADVISORY | ADJACENT | FILE:LINE | WHAT | WHY | SUGGESTED FIX`.
Keep these suggestions separate from delivery-blocking findings. Neither review mode
authorizes adjacent edits by default, including `--auto-fix`.

If cleanup is worth doing, ask the user whether to add it to scope. Approved work may
run in parallel on non-overlapping files or isolated worktrees; do not make it a
dependency of the main change. Never run conflicting writers in the same checkout.

A defect that prevents requested behavior or exposes a consequential risk is not
merely cleanup. Classify it by impact and fix it within scope or report the blocker.

## Step 5: REPORT – Synthesize findings

Deduplicate in-scope findings and sort by:

1. MUST FIX (correctness, security, will-break-in-prod)
2. SHOULD FIX (convention violations, readability, maintainability)
3. CONSIDER (style preferences, minor improvements)

Keep adjacent suggestions in a separate advisory list using Step 4's format.
For each in-scope finding, make sure it has:

- `file:line` reference
- Category tag (HARDCODE, SSOT, SCALABILITY, READABILITY, EDGE-CASE, PROSE)
- Severity (MUST / SHOULD / CONSIDER)
- Clear 1-sentence description of the problem
- Why it matters (1 sentence)
- Suggested fix (concrete, actionable – code snippet or approach)

For deeper analysis, investigate directly or delegate the problem, file, and context.
Compare useful alternatives and recommend the smallest complete fix, including affected callers.

## Step 6: FIX – Auto-fix or interactive waves

- **Auto-fix mode**: read `auto-fix.md` and follow it.
- **Interactive mode** (default): read `interactive.md` and follow it.

## Severity guide

| Severity | Meaning                                                | Examples                                                           |
| -------- | ------------------------------------------------------ | ------------------------------------------------------------------ |
| MUST     | Will cause bugs, security issues, or prod failures     | Hardcoded secrets, unhandled null on critical path, race condition |
| SHOULD   | Violates conventions, hurts maintainability, tech debt | SSOT violations, unclear naming, missing error handling on I/O     |
| CONSIDER | In-scope improvement opportunity, not urgent           | Minor style, could-be-cleaner patterns                            |

## Review responsibilities and tool checks

- **Formatting/style** – linters and formatters handle this
- **Type errors** – typecheckers handle this
- Assess test adequacy under the shared Implementation discipline, even when no task-checker ran
- **UI rendering** – frontend-verify handles this
- **Security scanning** – dedicated security tools handle credentials in committed code

Focus exclusively on the semantic/architectural issues that automated tools miss.
