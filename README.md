# ACStack

ACStack is an agentic coding stack. It helps coding agents clarify requirements, test meaningful behavior, and review changes before they land.

- **ACStack aims to solve two common failure modes coding agents introduce**
    - The agent starts building before the requirements are clear
    - The agent writes code, then creates tests that pass against that code
- **ACStack supports Claude Code, Codex, and pi from one npm package**
    - Claude Code and Codex install it through the `ac-agentic-coding` marketplace
    - pi installs `npm:acstack`
    - The package includes the prebuilt CLI; installation needs no source build
- **ACStack introduces structure around how your agent works**
    - Verification fits the change under a shared policy in `orchestrator/AGENTS.md`
- Straightforward work can stay with one agent, including investigation, tests, implementation, and verification
    - One verification owner gathers final completion evidence, reusing valid results instead of repeating checks at every handoff
    - Review depth follows affected risks; adjacent cleanup is advisory unless the user approves it

```mermaid
flowchart TD
    Q{"What kind of<br/>request is this?"} -->|"clear enough to build"| IM["Build it<br/>(/acstack:implement)"]
    Q -->|"something stopped working"| QF["Find the root cause first<br/>(/acstack:fix)"]
    Q -->|"still has open questions"| MP["Answer them first<br/>(/acstack:map)"]
    MP -->|"once the questions are answered"| IM
    IM --> C["Review and commit<br/>(/acstack:commit)"]
    QF --> C
```

Every box above is section 2. The rest of this file is reference.

| What you want | Where |
| ------------- | ----- |
| Quickstart | section 1 |
| The three commands, and which one to use | section 2 |
| Configure a project and a machine | section 3 |
| The CLI | section 4 |
| Every skill | section 5 |
| Every agent | section 6 |
| Output style | section 7 |
| Terminal workspace | section 8 |
| Design principles | section 9 |
| Licence and credits | section 10 |

## 1. Quickstart

ACStack supports [Claude Code](https://claude.com/claude-code), [Codex](https://developers.openai.com/codex), and [pi](https://pi.dev).

### 1.1. Install on Claude Code

You need the Claude Code CLI and Node.js 20 or later.

Install the plugin:

```
/plugin marketplace add ac8318740/ac-agentic-coding
/plugin install acstack@ac-agentic-coding
```

Then, in your Git repository, use `/acstack:implement`, `/acstack:fix`, or `/acstack:pre-commit-review` directly. Without project configuration, ACStack follows repository instructions and discovers tooling from manifests, tests, and CI.

- Optional: `/acstack:setup` detects the project type and writes `project.yaml` for saved workflow settings and storage-backed features such as maps
    - Existing configuration keeps its gates; invalid configuration or project-data conflicts require repair, not an unconfigured fallback
- All ACStack-owned project records live in one project folder per repository, shared by all of its worktrees
    - `~/.claude/acstack/bin/acstack project-data path` prints it; by default it is `~/.acstack/projects/<key>/`, outside the repository
    - Run `acstack project-data mode tracked` to keep the records in the repository's `.acstack/` and commit them instead
    - See [Where project data lives](docs/config-reference.md#where-project-data-lives) for paths, modes, and commands
- Update installed ACStack tools before migrating an older project
    - Stop old agents and reviews, run `~/.claude/acstack/bin/acstack project-data migrate`, then restart with updated tools
    - Migration aborts on collisions without overwrites or Git index changes; tracked old paths become pending deletions
- The SessionStart hook loads the orchestrator instructions in Git repositories, even without project setup
- Your CLAUDE.md stays clean for project-specific content
- Upgrading from a version before 0.8.0 means deleting one stale `@import` line (see [docs/migrate-0.8.md](docs/migrate-0.8.md))

### 1.2. Install on Codex

You need the Codex CLI with npm plugin support, npm, and Node.js 20 or later. The native npm installation path is tested with Codex 0.163.0. Use ACStack 0.57.10 or later. It keeps the complete startup policy in Codex context instead of a truncated preview. The portable manifest in 0.57.8 prevents Codex hook discovery.

```sh
codex plugin marketplace add ac8318740/ac-agentic-coding
codex plugin add acstack@ac-agentic-coding
```

Enable hooks and trust ACStack's reviewed hook source through Codex's trust flow. Installation alone does not grant hook execution. Start a fresh session after startup installs generated agent roles into `$CODEX_HOME/agents/` (default `~/.codex/agents/`); user-owned roles with the same names are preserved.

The skills and project configuration are shared with Claude Code. The plugin includes lifecycle hooks, so use the marketplace rather than the public Codex plugin directory.

### 1.3. Install on pi

*The same project installs as a [pi](https://pi.dev) package with `@tintinweb/pi-subagents` or `pi-subagents` for delegation.*

```
pi install npm:@tintinweb/pi-subagents
pi install npm:acstack
```

Then use the general workflows in your Git repository immediately. Run `/acstack:setup` only when you want saved project settings or storage-backed features, as described above.

- Every skill runs under the same name as on Claude Code, e.g. `/acstack:map`
    - `/acstack map` does the same
    - Both always run the ACStack skill, even when another pi package has a skill called `map`
- ACStack's skills deliberately don't appear as `/skill:<name>` commands
    - The package gives pi no skills, so `/skill:map` never runs ACStack's map
    - The extension lists the skills in the system prompt instead, so the model still reads one when the task matches
- `pi/extension.ts` does what the Claude Code hooks do
    - It links the CLI at `~/.claude/acstack/bin/acstack`
    - It adds the orchestrator instructions in Git repositories, even without project setup
    - It lists ACStack's skills in the system prompt in every session
    - It re-injects a handoff after a compaction
    - It nudges with a continuity-versus-freshness checkpoint as the context fills
        - Continuity keeps useful working context in the same session, using billion-context or host ACP compression when available
        - Freshness uses `/acstack:handoff` when a fresh window or independent read helps more
        - With no thresholds set, the first nudge comes at 200k tokens or half the window, whichever is lower
        - The urgent nudge comes at 500k tokens or 80% of the window, whichever is lower
- ACStack includes the question-status bridge automatically
    - With `@juicesharp/rpiv-ask-user-question` and Herdr's Pi integration installed, Herdr shows blocked while Pi waits for an answer
    - Existing setup-installed bridges can stay installed without counting the same wait twice
- Both subagent packages find the agents of section 6 through the `pi.subagents` field in `package.json`
    - `@tintinweb/pi-subagents` exposes `Agent`; `pi-subagents` exposes `subagent`
    - The agents use your subagent package's default model
    - ACStack warns at session start when pi lists neither tool
- Allow delegation in `~/.pi/agent/AGENTS.md`:

    ```
    When an ACStack skill or the ACStack orchestrator says to launch a subagent, you may delegate to it.
    ```

    - For `pi-subagents`, set `"toolActivation": "eager"` in `~/.pi/agent/extensions/subagent/config.json` to offer `subagent` from the first turn (restart pi after)
- pi gets the ACStack writing style from the extension by default
    - Run `/acstack-writing-style default` to use the bundled style again
    - Run `/acstack-writing-style off` to disable style injection
    - Run `/acstack-writing-style custom <path>` to use a user-owned style file

## 2. The three commands, and which one to use

*Pick by what is in your way: nothing, a bug, or an unanswered question.*

Two words first, because the third command below uses them.

- **A map** is a to-do graph ACStack keeps for one piece of work
- **A node** is one entry on that graph: one question to answer, or one piece of work to do

The three commands:

- **The request is clear enough to build** – run `/acstack:implement`
    - It works solo or as a team, using the agents of section 6 where they help
    - A one-line change stays a one-line change
- **Something already built stopped working** – run `/acstack:fix`
    - It makes the agent find the root cause before it edits anything
- **The request still has open questions** – run `/acstack:map`
    - The agent interviews you one round at a time
    - Each round asks every question it can answer next
    - Each question comes with the agent's recommended answer
    - You provide feedback on the agent's recommended answer instead of prompting from scratch
    - Some requests only need one question
    - The agent writes that decision down as a short note under `<project folder>/decisions/`
    - A big feature may need dozens of questions
    - The agent stores those questions as a **map**
    - You work through the map across several sessions

### 2.1. What a map holds

*`/acstack:map` builds a map only when a single conversation cannot settle every question.*

Each node has a status (`fog`, `open`, `claimed`, `resolved`, or `out-of-scope`), says who answers it, and links to the answer that raised it and the nodes that must finish first. The open nodes with nothing unfinished blocking them are the **frontier**: what is ready to start. Nodes live in GitHub issues by default, or in markdown files under `<project folder>/maps/`.

Every rule in ACStack exists because something went wrong without it, over months of real product development with coding agents.

[docs/workflows.md](docs/workflows.md) links each step to the skill that owns it and defines the map vocabulary.

## 3. Configure a project and a machine

*The project states what to run. The machine states what it can do.*

- `project.yaml` in the project folder holds every project-scoped setting
    - [docs/config-reference.md](docs/config-reference.md) gives each key, its values, its default and what changes
- `~/.acstack/config.json` holds the nine `host.*` axes
    - `/acstack:host` writes eight of them once per machine, and `/acstack:setup` writes the ninth
    - [docs/dev-setups.md](docs/dev-setups.md) gives every axis, what reads it, and how to describe a fresh machine
- `/acstack:setup` copies the commands and directories from one of three language profiles
    - **python** – pytest, ruff, mypy
    - **node-typescript** – npm test, eslint, tsc
    - **fullstack-python** – Python backend, plus a Node or TypeScript frontend
- `acstack config check` audits the project and the machine
    - It exits 2 when a required host axis has no value

## 4. The CLI

*Four storage operations carry the whole map. One fixed path makes the CLI reachable from any agent session.*

ACStack ships a Node.js CLI: `acstack config`, `acstack list`, `acstack node ...`, and `acstack archive`.

- The storage behind a map provides four operations and nothing more: create, read, update, list
    - GitHub issues are the default
        - The first line of every issue body carries all of that node's edges
        - One call therefore reads the whole map
        - A sub-issue and an issue dependency mirror those edges, so GitHub's own interface draws the map
    - Markdown files are the fallback, one per node under `<project folder>/maps/<name>/`
- The CLI builds everything else on those four operations
    - `acstack node frontier` lists what is ready to start now, closest to the original goal first
    - `acstack node walk` packs the whole map into one brief for a fresh session, in the order the decisions happened
    - The brief always includes the original goal, plus any node you marked as worth carrying along
    - The skills claim and resolve a node with `update` calls

Two symlinks reach the CLI. The SessionStart hook maintains both.

- `~/.claude/acstack/bin/acstack` is the fixed path every skill and agent calls
    - Agents therefore do not depend on your shell `PATH`
    - The CLI keeps working across plugin version bumps, non-interactive subshells and fresh agent contexts
- `~/.local/bin/acstack` is for typing `acstack` at a terminal yourself
    - Add `~/.local/bin` to your `PATH` to use it
    - The hook prints a one-line reminder when it is absent
    - Nothing in the plugin breaks without it

If `acstack` does not run after a Claude Code install, read [TROUBLESHOOTING.md](TROUBLESHOOTING.md). A Claude Code session can read it and apply the fix directly.

## 5. Every skill

*Four groups, ordered by when you reach for them.*

### 5.1. Implementation

| Skill | Description |
|-------|-------------|
| `/acstack:implement` | Build what is ready to start, whether or not a map exists |

For work with open decisions, chart it with `/acstack:map` first.

### 5.2. Planning

| Skill | Description |
|-------|-------------|
| `/acstack:map` | Answer the open questions first, building the to-do graph on the first run and working through it after |
| `grilling` | The interview itself, asking every question it can answer next per round, each with a recommended answer (the agent invokes it) |
| `record-context` | Writes a decision down when one lands: a short note, a glossary term, both, or neither (the agent invokes it) |

### 5.3. Operations

| Skill | Description |
|-------|-------------|
| `/acstack:commit` | Commit in MECE groups through the project's hooks |
| `/acstack:archive` | Verify tests, decisions, and current design approval, retain review evidence, then dispose of temporary map nodes |
| `/acstack:handoff` | Hand work to a visible agent, a new one in its own pane or one already running, with acknowledgement |
| `/acstack:compact-and-continue` | Anchor the session's load-bearing state to survive compaction, then continue in place |

What an effort leaves behind is what matters: tests, decision notes, and glossary entries. ACStack throws the nodes away.

### 5.4. Setup and supporting

| Skill | Description |
|-------|-------------|
| `/acstack:setup` | Set up ACStack in a project, and change how a project already set up is configured |
| `/acstack:host` | Declare this machine's dev setup once, as the `host.*` axes |
| `/acstack:explore` | Thinking partner mode, read-only |
| `/acstack:fix` | Find the root cause of a bug, then route the fix |
| `/acstack:pre-commit-review` | Clean-context review of uncommitted changes; `/acstack:commit` runs it for nontrivial changes |
| `/acstack:browser-verify` | The frontend skill: UI rules before an edit, then measure, behavior checks in headless Chrome, and a judge when hierarchy changes |
| `/acstack:bridge` | Set up and operate the Playwriter cross-device browser bridge |
| `/acstack:visual-docs` | Write docs that lead with a diagram and derive structure from it (Minto pyramid) |
| `/acstack:new-worktree` | Create a git worktree off the remote base branch and continue the task inside it |
| `/acstack:teardown-worktree` | Retire finished worktrees, delete their merged local and remote branches, and clean build outputs in worktrees that stay |
| `/acstack:terminal-workspace` | Set up a keyboard-only terminal for driving agents on a dev machine |

## 6. Every agent

*Each agent is named for why you delegate to it.*

| Agent | Role |
| --- | --- |
| `investigator` | Read-only answer to one bounded question, keeping raw discovery out of the lead's context |
| `reviewer` | Clean-context review of a change from the diff and the requirements |
| `scope-worker` | Owns one independent scope in its own checkout, in Team mode |
| `frontend-verifier` | Configured real-browser verification on final frontend code |

`orchestrator/AGENTS.md` owns when to use each: Delegate investigation, Review before commit, and Solo and Team modes.

## 7. Output style

*The plugin ships one output style, `acstack:ac-writing-style`, which applies the house writing standard to every chat reply.*

- `output-styles/ac-writing-style.md` holds the standard between its `acstack:communication` markers
- `/acstack:setup` offers the style and asks before writing `outputStyle`, globally or for one project; the plugin never forces it on
- `hooks/ac-writing-style-reminder.sh` re-injects the marked block on every prompt, read from the style file at run time so it cannot drift
    - It stays silent under any other output style and writes nothing to the transcript
- pi gets the same standard from its extension (see section 1.3)

## 8. Terminal workspace for driving several agents

*An optional keyboard-only setup for running several agents on a remote machine. ACStack works fine without it.*

- `/acstack:terminal-workspace` installs every tool and writes every config
- [docs/terminal-workspace.md](docs/terminal-workspace.md) gives the exact config, every key, and the traps worth knowing
- The setup builds on herdr, a terminal multiplexer that keeps each agent's terminal running after you disconnect
    - You attach from your own machine with `herdr --remote`
    - Your own clipboard and browser then reach the session
    - Each agent can get its own git worktree, meaning its own checkout on its own branch
- gh-dash then triages pull requests and diffnav reads diffs, both without leaving the terminal

## 9. Design principles

*Meaningful evidence matters more than a fixed agent sequence.*

- Prefer practical tests-first work to expose mistakes before implementation
- Require tests for meaningful changed behavior when existing coverage cannot catch mistakes
- Reuse adequate coverage for refactors and skip new tests for nonbehavioral edits
- Explain impractical testing and disclose missing regression protection
- Build no more planning structure than the unanswered questions need
- Preserve explicit requests for stronger process
- The deprecated `workflow.tdd.*` booleans no longer control anything (see [config-reference.md](docs/config-reference.md))

## 10. Licence and credits

*[MIT](LICENSE). Four projects shaped the design.*

- **[OpenSpec](https://github.com/Fission-AI/OpenSpec)** – ACStack forks its CLI from OpenSpec
    - OpenSpec was the core spec engine under the original workflow
    - The map-based concepts all originate there: proposals, designs, tasks, living specs, change management, and archiving
- **[Taskmaster AI](https://github.com/eyaltoledano/claude-task-master)** – Taskmaster's task management model inspired the orchestrator pattern and the agent coordination approach
- **[Skills for Real Engineers](https://github.com/mattpocock/skills)** by Matt Pocock – the Wayfinder map, the round-by-round interview, and the durability rule for agent briefs
    - ACStack's node graph is a direct adaptation of Wayfinder
    - MIT licensed, and recorded in [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES)
- Additional inspiration comes from [Superpowers](https://github.com/obra/superpowers), [GSD](https://github.com/gsd-build/get-shit-done) and [Spec Kit](https://github.com/github/spec-kit)

The optional terminal workspace installs, but does not bundle, the five tools you drive and the five behind them. Each one keeps its own licence.

- [herdr](https://herdr.dev)
- [tuicr](https://github.com/agavra/tuicr) by agavra, which reviews a pull request inside the terminal
- [gh-dash](https://github.com/dlvhdr/gh-dash) and [diffnav](https://github.com/dlvhdr/diffnav) by dlvhdr
- [delta](https://github.com/dandavison/delta) by dandavison
- [lazygit](https://github.com/jesseduffield/lazygit) by jesseduffield, which stages, commits and pushes on one key
- [harlequin](https://github.com/tconbeer/harlequin) by tconbeer, the SQL editor this setup opens on one key
- [yazi](https://github.com/sxyazi/yazi) by sxyazi, the file manager that previews whatever the cursor sits on
- [mermaid-ascii](https://github.com/AlexanderGrooff/mermaid-ascii) by AlexanderGrooff
- [glow](https://github.com/charmbracelet/glow) by charmbracelet

The optional fork build of tuicr compiles [agavra/tuicr#607](https://github.com/agavra/tuicr/pull/607) by [antonio2368](https://github.com/antonio2368). It also compiles [agavra/tuicr#633](https://github.com/agavra/tuicr/pull/633) and one counts fix not yet submitted upstream, both written for this fork. That build is off by default and temporary.

See [docs/terminal-workspace.md](docs/terminal-workspace.md).
