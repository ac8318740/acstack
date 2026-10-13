# ACStack troubleshooting

*This page covers the Claude Code install path. pi installs ACStack as `npm:acstack`, and uses pi's package tools instead.*

**A coding agent can act on this file.** Find the symptom the user reported, run the diagnostic, then apply the fix.

- **Claude Code's SessionStart hook maintains everything here**
    - Almost every symptom below is that hook not having run
- **Restarting Claude Code fixes most of them**
    - The hook runs again on the new session
- **Each section below is one symptom**, with the command to confirm it and the command to fix it

```mermaid
flowchart LR
    H["SessionStart hook<br/>(hooks/hooks.json)"] --> A["Agent path<br/>(~/.claude/acstack/bin/acstack)"]
    H --> U["Human path<br/>(~/.local/bin/acstack)"]
    A --> C["The bundled CLI<br/>(cli/dist/index.js in the plugin cache)"]
    U --> C
    H --> O["Orchestrator instructions<br/>(orchestrator/AGENTS.md, via python3)"]
```

| The broken link | Sections |
| --- | --- |
| Agent path | 1, 4 |
| Human path | 2 |
| The bundled CLI | 3 |
| SessionStart hook | 5 |
| Orchestrator instructions | 6 |

Where the plugin lives, and what points at it:

- The plugin lives at `${CLAUDE_PLUGIN_ROOT}` once the user installs it via the marketplace
- On most installs that resolves to `~/.claude/plugins/cache/spechub/acstack/<version>/`
- `~/.claude/acstack/bin/acstack` is the **agent-facing** invariant path
    - Every skill and agent in this plugin invokes the CLI through this exact path
    - It does not depend on the user's `PATH`
- `~/.local/bin/acstack` is the **human convenience** symlink
    - It is useful only when `~/.local/bin` is on `PATH`
    - No plugin functionality rests on it
- Both symlinks refresh on every SessionStart and point at the current plugin cache version
- Fix the agent-facing path first
    - Nothing in the plugin works without it

---

## 1. Agents report `~/.claude/acstack/bin/acstack: No such file or directory`

**Symptom**: a skill or agent fails because it cannot find the CLI at `~/.claude/acstack/bin/acstack`.

**Diagnose**:

```bash
ls -l ~/.claude/acstack/bin/acstack 2>&1
ls -d ~/.claude/plugins/cache/spechub/acstack/*/ 2>&1
```

**Possible causes and fixes**:

- **Symlink missing** (`No such file or directory`): the SessionStart hook never ran
    - The user has not started Claude Code on this device since they installed the plugin, or the hook silently failed
    - Fix: ask the user to restart Claude Code so the SessionStart hook fires
    - The hook creates the symlink and prints `acstack: linked agent CLI at ...`
    - Create it by hand if that does not work:
        ```bash
        ACSTACK_VERSION=$(ls ~/.claude/plugins/cache/spechub/acstack/ | sort -V | tail -1)
        mkdir -p ~/.claude/acstack/bin
        ln -sfn ~/.claude/plugins/cache/spechub/acstack/$ACSTACK_VERSION/cli/bin/acstack.js ~/.claude/acstack/bin/acstack
        ```

- **Plugin cache missing entirely**: the second `ls` returned nothing
    - Fix: the user has not installed the plugin
    - Run `/plugin marketplace add ac8318740/spechub`, then `/plugin install acstack@spechub` in Claude Code

---

## 2. `acstack: command not found` (human typed it at a terminal)

**Symptom**: the user runs `acstack --help` at the terminal and the shell reports `command not found`, while agents continue to work.

This is a **human-ergonomics issue, not a plugin issue.** Agents use `~/.claude/acstack/bin/acstack` directly. This does not affect them. Fix it only if the user types `acstack` at terminals.

**Diagnose**:

```bash
ls -l ~/.local/bin/acstack 2>&1
echo "PATH=$PATH" | tr ':' '\n' | grep -F "$HOME/.local/bin" || echo "MISSING"
```

**Possible causes and fixes**:

- **Symlink missing**: the SessionStart hook never ran, or ran and could not write
    - Fix: ask the user to restart Claude Code
    - The hook recreates the human symlink on every session start
- **PATH missing** (the symlink exists but `MISSING` printed): `~/.local/bin` is not on `$PATH`
    - Fix: add this line to the user's shell rc, then ask them to restart their shell:
        ```bash
        export PATH="$HOME/.local/bin:$PATH"
        ```
    - The shell rc by shell:
        - zsh: `~/.zshrc`
        - bash on Linux: `~/.bashrc`
        - bash on macOS: `~/.bash_profile`
        - fish: `~/.config/fish/config.fish`, and use `set -gx PATH $HOME/.local/bin $PATH`

---

## 3. `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../cli/dist/index.js'`

**Symptom**: the CLI runs but Node throws `ERR_MODULE_NOT_FOUND` for `dist/index.js`.

**Diagnose**:

```bash
ACSTACK_VERSION=$(ls ~/.claude/plugins/cache/spechub/acstack/ | sort -V | tail -1)
ls ~/.claude/plugins/cache/spechub/acstack/$ACSTACK_VERSION/cli/dist/index.js 2>&1
```

**Cause**: the plugin cache holds a version from before the CLI shipped bundled in the repo, meaning before 0.9.2. This should not happen on 0.9.2 or later.

**Fix**:

- Bump or refresh the plugin cache
    - Run `/plugin` in Claude Code and reinstall the plugin
    - Or delete the cache directory and let Claude Code repull:
        ```bash
        rm -rf ~/.claude/plugins/cache/spechub/acstack/<old-version>
        ```

- Confirm the user is on plugin version 0.9.2 or later:
    ```bash
    cat ~/.claude/plugins/cache/spechub/acstack/*/.claude-plugin/plugin.json | grep version
    ```

- Build the CLI in place as a one-shot, if the user is offline or cannot repull:
    ```bash
    cd ~/.claude/plugins/cache/spechub/acstack/<version>/cli
    npm install
    npm run build
    ```

---

## 4. Stale symlink, pointing at an old version

**Symptom**: `~/.claude/acstack/bin/acstack --version` prints an older number than expected, or commands behave like an older release.

**Diagnose**:

```bash
readlink ~/.claude/acstack/bin/acstack
ls ~/.claude/plugins/cache/spechub/acstack/
```

**Cause**: an older session set the symlink target. The plugin cache now holds a newer version. The SessionStart hook has not relinked it yet.

**Fix**:

- Start a new Claude Code session
    - The SessionStart hook detects a stale symlink and relinks it, printing `acstack: updated agent CLI at ...`
- Or relink by hand:
    ```bash
    NEW=$(ls ~/.claude/plugins/cache/spechub/acstack/ | sort -V | tail -1)
    ln -sfn ~/.claude/plugins/cache/spechub/acstack/$NEW/cli/bin/acstack.js ~/.claude/acstack/bin/acstack
    ln -sfn ~/.claude/plugins/cache/spechub/acstack/$NEW/cli/bin/acstack.js ~/.local/bin/acstack
    ```

---

## 5. The SessionStart hook did not run

**Symptom**: no `acstack:` lines appear in Claude Code's startup logs. `~/.claude/acstack/bin/acstack` is missing.

**Diagnose**:

```bash
cat ~/.claude/plugins/cache/spechub/acstack/*/hooks/hooks.json
```

**Cause**: the user has not enabled the plugin, or they have disabled hook execution in their Claude Code settings.

**Fix**:

- Confirm the user has enabled the plugin, with `/plugin list`
- Check that the user has not disabled hooks in `~/.claude/settings.json`, meaning no `"hooks": false` and no per-event suppression
- Install the symlinks by hand as a fallback, using the commands in section 1 and section 4

---

## 6. `python3 not found` warning at session start

**Symptom**: the hook prints `acstack: python3 not found; skipping orchestrator injection`.

**Cause**: the hook uses `python3` to emit `orchestrator/AGENTS.md` as JSON for `additionalContext` injection.

- Without `python3` the orchestrator instructions do not load at all
    - Nothing else reads that file
- Claude Code does not auto-load instructions from a plugin's own directory
    - Injection is the only path
- This does not affect the CLI symlinks
    - The `acstack` command keeps working

**Fix**: install Python 3. Most systems already have it.

```bash
# Debian/Ubuntu
sudo apt install python3
# macOS
brew install python3
```

---

## 7. When none of the above matches

*This section describes the document, not the plugin. No box in the diagram holds it.*

The CLI is a normal Node.js ESM package. To validate the install end to end:

```bash
ACSTACK_VERSION=$(ls ~/.claude/plugins/cache/spechub/acstack/ | sort -V | tail -1)
node ~/.claude/plugins/cache/spechub/acstack/$ACSTACK_VERSION/cli/bin/acstack.js --help
```

- If that prints help, the CLI is fine and the issue is the symlink
- If that errors, the issue is the cache contents (see section 3)
