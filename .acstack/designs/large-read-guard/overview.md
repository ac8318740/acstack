## Proposed change

ACStack adds a large-read guard. When a main agent tries to read a whole large file, the guard blocks that first attempt and suggests a cheaper way to get what it needs. If the agent repeats the same read, the guard lets it through.

ACStack's instructions already say when to delegate investigation (PR #379, released in 0.52.6). Nothing stops a parent agent from loading thousands of lines it does not need anyway. The guard is the missing intervention at the moment the read happens. The idea comes from Spotify's Shunt plugin, minus Shunt's delegation backend.

This is a design for approval. Nothing is implemented yet.

### Questions for the reviewer

1. Does the main-agent rule match your intent, including the Pi fork trade-off below?
2. Is the block message (under "What the agent sees") useful enough to change behaviour?
3. Are the open checks at the end the right ones to settle during implementation?

### Trade-offs to judge

- **Blocking once and allowing a retry instead of only warning.** A warning sent with the read saves nothing, because the file is already in context. A permanent block can trap an agent whose instructions require the whole file. Blocking once costs a needed full read one extra tool call.
- **Main agents only.** Subagents and ac-teams members read freely. A guarded investigator might start its own investigator, and that one another, growing agent trees without limit.
- **Best effort, not security.** Ranged reads, pipes, and scripts all pass. The guard saves context. It does not protect anything.

## Decisions

The user settled these in grilling on 2026-11-02.

| # | Decision | Reason |
|---|---|---|
| 1 | Borrow Shunt's read intervention only, with no worker backend, bulk-read script, or code-writer | ACStack's investigators already do delegated reading |
| 2 | Block the first whole-file read of a large file; an identical retry passes | Saves tokens and never traps the agent |
| 3 | "Large" means file size of 32 KB (32,768 bytes, roughly 8,000 tokens) or more | Bytes track token cost better than line counts |
| 4 | Guard whole-file read-tool calls and simple single-file shell reads | Codex reads files only through shell commands |
| 5 | Ship Claude Code, Codex, and Pi together, sharing one policy module | One `hooks.json` entry serves Claude Code and Codex; Pi already ports ACStack's hooks |
| 6 | On by default, with a project opt-out and a threshold override | The retry rule makes a false alarm cheap |
| 7 | Unit and fixture tests now; a token and quality benchmark later | Proves correctness without waiting on benchmark design |
| 8 | Record this as a design document only, with no issue or map yet | Matches the handoff's scope |
| 9 | Guard main agents only | Prevents runaway investigator trees |
| 10 | In Pi, a session with a `parentSession` header counts as not main | Catches tintinweb/pi-subagents children; the user chose not to ask tintinweb for a marker |
| 11 | When the role is unclear, the guard stays off | A missed guard costs tokens; a wrongly guarded subagent risks a tree |

## Worked journey

A main agent in Claude Code wants to understand one function in `cli/src/node.ts`, a 60 KB file.

1. The agent calls `Read` on the file with no offset or limit
2. The Claude Code and Codex hook receives the call and asks the read policy
3. The read policy finds a main agent (no `agent_id`, no `ACSTACK_AGENT_ROLE`), a whole-file read, and 60 KB, which is over 32 KB. The retry ledger has no entry for this file
4. The policy records the file in the retry ledger and returns a block with the message below
5. The agent searches for the function and reads 80 lines around it. It never loads the other 58 KB
6. If the agent really needs the whole file, it repeats the same `Read`. The ledger has the entry, so the call passes

In Codex, step 1 is a shell command such as `cat cli/src/node.ts`. In Pi, the Pi adapter handles steps 2 and 4.

An investigator subagent making the same read in step 1 is not a main agent. The policy allows it at step 3, and nothing is recorded.

## What the agent sees

The block message names the size and the options. Draft wording:

> This file is 60 KB (about 15,000 tokens), and reading all of it is usually unnecessary. Instead:
>
> - Search for what you need, then read only that range
> - Or hand the question to an investigator, as ACStack's Delegate investigation section describes
>
> If you really need the whole file, repeat this exact read and it will go through.

The message does not name tools a harness may lack. It never says delegation is required.

## The read policy

### What counts as a whole-file read

| Call | Guarded? |
|---|---|
| Read tool (Claude Code `Read`, Pi `read`) with no offset and no limit | Yes |
| Read tool with an offset or a limit | No: the agent already chose a range |
| Shell `cat`, `less`, `more`, `nl`, or `bat` on one file, with no pipe, redirect, `;`, `&&`, or `\|\|` | Yes |
| Shell `head`, `tail`, or `sed -n` with a range | No |
| Anything else: pipes, scripts, `rg`, `python`, editors | No |

Only existing regular files at or above the threshold are blocked. A missing file, a directory, or a size error allows the call. Any error inside the guard allows the call.

Shunt also lets any range or pipe through. A ranged read with a huge limit is effectively a whole read. Checking the requested size would mean reading the file, which this design avoids.

### Who counts as a main agent

The policy checks the signals in order. The first match that says "not main" wins. With no match, the agent is main, but only where the harness gives a reliable answer.

| Harness | Not main when | Evidence |
|---|---|---|
| Any | `ACSTACK_AGENT_ROLE` is set to anything except `main` | Agreed with the ac-teams design agent; ac-teams sets it on every member process |
| Claude Code | The hook input has `agent_id` | Claude Code hooks reference: `agent_id` identifies a subagent or in-process teammate |
| Codex | The hook input has `agent_id` | Prototype on Codex 0.163.0: a subagent's `PreToolUse` input had `agent_id` and `agent_type`; the main thread had neither |
| Pi | `PI_SUBAGENT_CHILD=1` while the extension loads | nicobailon/pi-subagents sets it on child processes, and around in-process child extension loading |
| Pi | The session header has `parentSession` | tintinweb/pi-subagents writes it on child sessions |
| Pi | The session has no file | tintinweb/pi-subagents keeps some children in memory; under decision 11, unclear means off |

Pi reads the environment once, when the extension loads for a session. nicobailon/pi-subagents sets its marker only during that window for in-process children, and restores the parent's environment afterward.

Two accepted gaps follow:

- **A Pi `/fork` loses the guard.** A user's fork also writes `parentSession`. That costs tokens, nothing worse
- **Pi with `--no-session` loses the guard.** It has no session file

Anything a member launches inherits `ACSTACK_AGENT_ROLE`, including a nested `claude`, `codex`, or `pi`, so it also counts as not main. Promotion in ac-teams (issue #19) relaunches the session without that variable. The ac-teams design owns that rule.

### The retry ledger

The ledger is disposable, session-scoped state, so it lives in temporary storage, not in the project or in `~/.acstack`.

| Harness | Location on the device |
|---|---|
| Claude Code and Codex | `${TMPDIR:-/tmp}/acstack-read-guard-<uid>/<session_id>.json`. On Linux, for example, `/tmp/acstack-read-guard-1000/<session_id>.json`. On macOS, `$TMPDIR` is already a per-user folder under `/var/folders/` |
| Pi | Memory in the Pi process, gone when Pi exits |

- `<session_id>` is the `session_id` field of the hook input. One file per session keeps concurrent sessions from writing the same file
- The guard creates the folder with mode `0700` and refuses a folder it does not own. Another user on the machine therefore cannot plant entries that switch the guard off
- Each entry holds the file's absolute path, its size, and its modification time. A changed size or time counts as a new file, so the guard can block it again
- A file blocked once in a session never blocks again in that session, unless it changes
- Nothing deletes old ledgers; the operating system's temp cleanup or a reboot does. Losing a ledger costs at most one extra block per file when a session resumes

### Project settings

The guard is on when `.acstack/project.yaml` says nothing.

```yaml
workflow:
  read_guard: false            # turns the guard off
  read_guard_bytes: 65536      # changes the threshold (default 32768)
```

The two keys are flat rather than nested because `acstack config set` cannot hold a key that is both a value and a section.

A project without `.acstack/project.yaml` still gets the guard, at 32 KB.

The guard reads settings through one function, so moving ACStack's project data later changes one place. Whether project data should move to a global ACStack folder is a separate ACStack-wide decision. This design does not make it.

## Where the code goes

| Path | Change |
|---|---|
| `hooks/lib/read-guard.mjs` | New. The read policy and retry ledger, with no harness knowledge |
| `hooks/read-guard.mjs` | New. Reads hook JSON on stdin and writes the deny response |
| `hooks/hooks.json` | Adds a `PreToolUse` entry for `Read` and `Bash` |
| `pi/extension.ts` | Adds role detection at load and a `tool_call` handler for `read` and `bash` |
| `tests/test-read-guard.sh` and fixtures | Policy cases and per-harness input and output fixtures |
| `docs/` | One section on the guard, its gaps, and the setting |

Claude Code and Codex both accept this deny shape:

```json
{"hookSpecificOutput": {"hookEventName": "PreToolUse",
  "permissionDecision": "deny", "permissionDecisionReason": "<message>"}}
```

Pi's `tool_call` handler returns a block with the same message.

## Verification

Before shipping:

- Unit tests of the read policy: threshold edges, ranged and whole reads, each shell form, retry and file-change behaviour, every main-agent signal, and settings
- Fixture tests per harness: real hook inputs from Claude Code, Codex, and Pi in, the right allow or deny out
- One manual run per harness on the installed versions, confirming the agent sees the message and a retry passes

Later, as its own work: a benchmark of scripted tasks with the guard on and off, comparing parent and total tokens and task success. Spotify's reported 90% parent-token saving says nothing about total cost or quality here.

## Open checks for implementation

These are facts to verify, not decisions:

- **Claude Code split-pane teammates.** Agent teams can run teammates as separate `claude` processes. The binary passes them `--agent-id`, but whether their hook input carries `agent_id` is unverified. If it does not, find another signal, or record the gap
- **The tool names and input fields each harness sends,** on Claude Code 2.1.282, Codex 0.163.0, and the installed Pi
- **Codex's shell tool input.** The prototype showed `tool_name: "Bash"` with `tool_input.command` as a string. Confirm the form when Codex wraps commands
- **A Pi block reaches the model** as a readable tool error

## What this design does not do

- Delegate reads to another model or service, as Shunt's `bulk-read` does
- Generate code, as Shunt's `code-write` does
- Guard subagents, ac-teams members, ranged reads, or scripted reads
- Define how ac-teams promotes members. That belongs to the ac-teams design on branch `design/session-roles`

## Sources

- Shunt: https://github.com/spotify/portal-ai-plugins/tree/main/plugins/shunt
- Spotify's article: https://engineering.atspotify.com/2026/9/portal-by-spotify-cut-my-claude-code-token-usage-by-90
- Claude Code hooks: https://code.claude.com/docs/en/hooks
- Codex hooks: https://developers.openai.com/codex/hooks
- tintinweb/pi-subagents: `src/agent-runner.ts`, child session creation with `parentSession`
- nicobailon/pi-subagents: `src/runs/shared/child-runtime-config.ts` (`PI_SUBAGENT_CHILD`) and `src/runs/shared/child-session.ts`
- ac-teams issue #19: https://github.com/ac8318740/ac-teams/issues/19
