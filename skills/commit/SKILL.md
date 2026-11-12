---
name: commit
description: Create git commit(s), running the clean-context pre-commit review first for nontrivial changes, with proper pre-commit hook handling, MECE commit messages, safe staging, the design-token refresh, and a prose lint. Invoke whenever work is about to be committed – the user asked to commit, or told you to finish and commit a batch of work. Committing is still the user's call – do not invoke it unprompted on work they have not asked you to land.
argument-hint: "[scope: 'all', or describe which changes]"
---

## User input

```text
$ARGUMENTS
```

Scope argument: "all" commits everything (staged + unstaged + untracked), or describe which changes to include (e.g., "just the frontend changes", "only the auth module"). Defaults to "all" if no argument given.

## Step 1: Analyze Changes

1. Run `git status` to see all changed files
2. Run `git diff` and `git diff --cached` to see content of changes
3. Run `git log --oneline -5` to see recent commit style
4. Determine scope from `$ARGUMENTS`
5. If the change is nontrivial and has not been reviewed since its last edit, run `/acstack:pre-commit-review` first (Review before commit in `orchestrator/AGENTS.md`)

## Step 2: Plan Commits

Analyze changes and decide: one commit or multiple?

**Multiple commits when** changes are MECE (mutually exclusive, collectively exhaustive) across different concerns:

- Different features/fixes in different files
- Test changes separate from implementation
- Config changes separate from code changes

**Single commit when** all changes serve one purpose.

## Step 3: Draft Commit Message(s)

For each planned commit:

- Summarize the "why" not the "what"
- Use conventional commit format: `type: description`
- Types: feat, fix, refactor, docs, chore, test, style, perf
- Keep first line under 72 characters
- Add body for complex changes

## Step 4: Refresh DESIGN.md

`DESIGN.md` at the repo root records the project's design tokens, and the `/impeccable document` slash command writes it from the code. A **token source** is a file that defines those tokens. Skip this step when any check below fails.

1. `~/.claude/acstack/bin/acstack design-gate` exits 0 (it prints `on`; a non-zero exit prints `off: <reason>`)
2. `DESIGN.md` exists at the repo root; never create it here, because the open-designer plugin writes it
3. The diff being committed holds a token source, meaning one of these, matching what `impeccable document` scans:
    - a CSS file whose diff adds or changes a line holding `--color-`, `--font-`, `--spacing-`, `--radius-`, `--shadow-`, `--ease-` or `--duration-`
        - Check with `git diff --cached -U0 -- '*.css' | grep -E '^[+-].*--(color|font|spacing|radius|shadow|ease|duration)-'` (use `git diff HEAD -U0` for unstaged changes)
    - a Tailwind config: `tailwind.config.js`, `tailwind.config.ts` or `tailwind.config.mjs`
    - a CSS-in-JS theme file: `theme.ts`, `theme.js`, `tokens.ts` or `tokens.js`
    - a token file: `tokens.json` or `design-tokens.json`

Then run `/impeccable document`. It finds `DESIGN.md` and asks whether to refresh, overwrite, or merge. Answer refresh every time without asking the user, because the code is the only source of truth for design tokens. Stage the `DESIGN.md` and `.impeccable/design.json` it writes with the commit.

## Step 5: Stage and Commit

1. Stage files according to scope
2. Do NOT stage sensitive files (.env, credentials, secrets)
3. Run `git diff --cached --name-only -- '*.md'` to list the staged Markdown files
4. Run `~/.claude/acstack/bin/acstack lint-prose <files>` on that list
5. Show the lint output to the user
6. Create the commit with the drafted message and no `Co-Authored-By` trailer
7. Use HEREDOC format for commit message
8. Run `git status` after to verify

Skip steps 4 and 5 when that list is empty, because `lint-prose` exits 1 with no paths. The lint warns and never blocks. Commit even when it reports findings.

## Step 6: Handle Pre-commit Hook Failures

If commit fails due to pre-commit hooks:

1. Read the hook output to understand the failure
2. Fix the issue (formatting, linting, secrets detection)
3. Re-stage fixed files
4. Create a NEW commit (never amend)

## Important Rules

- NEVER add a `Co-Authored-By` trailer, even if a default instruction elsewhere tells you to
- NEVER use `--no-verify` to skip hooks
- NEVER amend existing commits unless explicitly asked
- NEVER push unless explicitly asked
- NEVER stage `.env`, credentials, or secret files
- NEVER use `git add -A` or `git add .` – stage specific files
- Always create NEW commits after hook failures
- Prefer specific file staging over broad patterns
