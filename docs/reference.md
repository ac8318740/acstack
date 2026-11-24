# ACStack reference

This page lists every skill, agent, and CLI command ACStack ships, and how the output style reaches each host. The [README](../README.md) covers installation and the three commands most work starts with.

## Skills

Skills you run start with `/acstack:`. The agent invokes the others itself when a task matches.

### Planning and building

| Skill | What it does |
| --- | --- |
| `/acstack:implement` | Build a clear request, or the ready nodes of a map |
| `/acstack:fix` | Find the root cause of a bug, then route the fix |
| `/acstack:map` | Settle open questions first, charting a map on the first run and working through it after |
| `/acstack:explore` | Thinking-partner mode that reads and discusses but writes no code |
| `/acstack:design-doc` | Write a design doc on a map and review it through a live local or SSH connection |
| `grilling` | The interview itself: each round asks every question that can be answered next, each with a recommended answer |
| `record-context` | Write a decision down when one lands: a decision record, a glossary term, both, or neither |
| `writing` | Apply the shared writing standard to durable text such as nodes, decisions, handoffs, and docs |
| `visual-docs` | Structure documentation around the reader's questions, with diagrams where they clarify relationships |

### Reviewing, committing, and handing over

| Skill | What it does |
| --- | --- |
| `/acstack:pre-commit-review` | Clean-context review of uncommitted changes; `/acstack:commit` runs it for nontrivial changes |
| `/acstack:commit` | Commit in non-overlapping groups through the project's hooks |
| `/acstack:archive` | Close a finished map after checking that its tests, decisions, and glossary entries exist |
| `/acstack:handoff` | Hand work to a visible agent, a new one in its own pane or one already running |
| `/acstack:compact-and-continue` | Save the session's essential state before a context compaction, then continue in place |

A map's nodes are temporary. What an effort leaves behind is its tests, decision records, and glossary entries.

### Setup and environment

| Skill | What it does |
| --- | --- |
| `/acstack:setup` | Set up ACStack in a project, or change an existing project's settings |
| `/acstack:host` | Describe this machine's dev setup once, as the `host.*` settings |
| `/acstack:browser-verify` | The frontend skill: UI rules before an edit, quick checks after it, then a hand-back with the local URL; full browser checks only when you are away |
| `/acstack:bridge` | Set up and operate the Playwriter bridge that lets an agent on a VM drive Chrome on your laptop |
| `/acstack:new-worktree` | Create a git worktree off the remote base branch and continue the task inside it |
| `/acstack:teardown-worktree` | Retire finished worktrees, delete their merged branches, and clean build outputs in worktrees that stay |
| `/acstack:terminal-workspace` | Install the optional keyboard-only terminal workspace (see [terminal-workspace.md](terminal-workspace.md)) |

## Agents

Each agent is named for why you delegate to it. `orchestrator/AGENTS.md` says when to use each, under "Delegate investigation", "Review before commit", and "Solo and Team modes".

| Agent | Role |
| --- | --- |
| `investigator` | Answer one bounded question read-only, keeping raw discovery out of the lead's context |
| `reviewer` | Review a change in a clean context, from the diff and the requirements only |
| `scope-worker` | Own one independent scope in its own checkout, in Team mode |
| `frontend-verifier` | Run configured browser verification on final frontend code, when you are away |

## The CLI

ACStack ships a Node.js CLI. Its main commands are `acstack config`, `acstack list`, `acstack node ...`, `acstack archive`, `acstack project-data`, and `acstack lint-prose`. Run `acstack --help` for the full list.

### How the CLI stores a map

A map's storage, called a tracker, provides four operations: create, read, update, and list. The CLI builds everything else on them.

- The GitHub tracker keeps one issue per node
    - The first line of each issue body carries all of that node's edges, so one call reads the whole map
    - Sub-issues and issue dependencies mirror those edges, so GitHub's own interface draws the map
- The files tracker keeps one markdown file per node under `<project folder>/maps/<name>/`
- `acstack node frontier` lists the nodes ready to start, closest to the original goal first
- `acstack node walk` packs the whole map into one brief for a fresh session, in the order the decisions happened
    - The brief always includes the original goal, plus any node marked as worth carrying along

### Where the CLI is installed

The SessionStart hook (or the pi extension) maintains two symlinks to the bundled CLI.

- `~/.claude/acstack/bin/acstack` is the fixed path every skill and agent calls
    - It does not depend on your shell `PATH`, so it works in non-interactive subshells and fresh agent contexts
    - It follows plugin version bumps
- `~/.local/bin/acstack` is for typing `acstack` at a terminal yourself
    - Add `~/.local/bin` to your `PATH` to use it
    - Nothing in the plugin breaks without it
    - The hook leaves an existing `acstack` on `PATH` alone when it is not the hook's own symlink

If `acstack` does not run, see [troubleshooting.md](troubleshooting.md). An agent can read it and apply the fix.

## Output style

The plugin ships one output style, `acstack:ac-writing-style`, which applies the shared writing standard to chat replies.

- `output-styles/ac-writing-style.md` holds the standard between its `acstack:communication` markers
- On Claude Code, `/acstack:setup` offers the style and asks before writing `outputStyle`, globally or for one project
    - `hooks/ac-writing-style-reminder.sh` re-injects the marked block on every prompt, read from the style file at run time
    - It stays silent under any other output style and writes nothing to the transcript
- On pi, the extension injects the style by default; `/acstack-writing-style default|off|custom <path>` changes that
