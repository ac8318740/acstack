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
