# Hooks spec

ACStack delivers the shared communication standard through startup hooks independently of project activation.

## FR-001: Deliver the canonical standard on parent and child startup

- **Given**: A host dispatches the registered SessionStart or SubagentStart hook
- **When**: The communication hook runs
- **Then**: It reads the marked block from `output-styles/ac-writing-style.md` in the plugin root
- **Then**: It returns the complete block in JSON additional context with the dispatched event name and suppressed transcript output
- **Then**: Delivery requires neither project metadata, orchestrator activation, nor a selected output style
- **Then**: The launcher uses `CLAUDE_PLUGIN_ROOT` when supplied and otherwise resolves its own plugin directory
- **Source**: `hooks/hooks.json`, `hooks/communication-standard.sh`, `hooks/communication-standard.mjs`

## FR-002: Reject invalid communication inputs without partial context

- **Given**: The hook receives invalid JSON, an unsupported event, or an unreadable canonical source
- **When**: It prepares startup context
- **Then**: It exits unsuccessfully with a diagnostic on stderr and no additional context
- **Given**: The canonical source lacks exactly one ordered, nonempty communication marker pair
- **When**: The hook or an agent generator reads the standard
- **Then**: The shared reader rejects the source instead of returning a partial block
- **Then**: The reader accepts both LF and CRLF line endings
- **Source**: `hooks/communication-standard.mjs`, `hooks/lib/communication-standard.mjs`

## FR-003: Keep the selected-style reminder separate

- **Given**: A user submits a prompt
- **When**: The per-turn reminder resolves the selected output style
- **Then**: Local project settings take precedence over project settings and user settings
- **Then**: Only the ACStack writing style or its legacy name enables the reminder
- **Then**: The reminder extracts the marked communication block rather than maintaining another authored copy
- **Then**: Unselected styles or an unavailable complete block produce an empty JSON response
- **Source**: `hooks/ac-writing-style-reminder.sh`

## FR-004: Stop a main agent's first whole read of a large file once

- **Given**: A main agent, meaning a session the user started, reads a file of at least `workflow.read_guard_bytes` bytes (default 32768) whole, with the read tool and no offset or limit, or with a single-file `cat`, `less`, `more`, `nl`, or `bat`
- **When**: The Claude Code and Codex `PreToolUse` hook or the pi `tool_call` handler sees the call
- **Then**: The guard blocks the call with a message suggesting a ranged read, a search, or an investigator
- **Then**: Any later whole read of the same unchanged file passes, keyed by real path, size, and modification time
- **Then**: Ranged reads, pipes, redirects, chains, variables, and globs always pass
- **Then**: Subagents (`agent_id` in the hook input), ac-teams members (`ACSTACK_AGENT_ROLE` other than `main`, or `AC_TEAMS_MEMBER`), pi-subagents children, and pi sessions with a `parentSession` header or no session file pass
- **Then**: `workflow.read_guard: false` turns the guard off, and any error inside the guard allows the read
- **Then**: Claude Code and Codex keep passed reads in `${TMPDIR:-/tmp}/acstack-read-guard-<uid>/<session_id>.json`, refusing a folder another user owns or can write; pi keeps them in memory
- **Source**: `hooks/lib/read-guard.mjs`, `hooks/read-guard.mjs`, `hooks/hooks.json`, `pi/extension.ts`
