# Install and configure the terminal workspace

*One command installs every tool and writes every config. This page also covers the same work done by hand, each tool's settings, and the herdr config file the command writes.*

The `/acstack:terminal-workspace` skill runs `assets/terminal-workspace/setup.sh` for you, and that script takes six commands.

| Command | What it does |
| --- | --- |
| `setup.sh apply` | installs every enabled tool and writes its config |
| `setup.sh status` | reports what this machine ended up with |
| `setup.sh outdated` | reports which tools are behind and which components are new, and changes nothing |
| `setup.sh upgrade [tool...]` | reinstalls what `outdated` reported, and adds any new component's config block to your file |
| `setup.sh disable <component>` | removes one component's keys and config |
| `setup.sh uninstall` | removes everything `apply` wrote, in every config it touched |

What `outdated` answers in its exit code:

- Exit 0 means nothing to do, and 1 means a missing, new, or stale finding
- Exit 2 means it cannot read the config or the shipped example
- It reads herdr's stable release manifest, so a machine on the preview channel sees herdr reported stale
- Name a tool on `upgrade` to skip the version comparison, which is the only way to refresh `mermaid-ascii`
    - `mermaid-ascii` has no version flag, so nothing can read the installed version

What `uninstall` removes:

- It strips the managed blocks from the herdr, tuicr, and yazi configs
- It unsets the delta git settings
- It deletes the helper scripts
- It removes the keybindings it wrote into gh-dash
- It deletes `~/.config/nvim/lua/plugins/acstack.lua`, a file it wrote whole
- It takes back what the `pi` component added to pi (see [pi](#pi-acstack-in-a-second-coding-agent))
- Your own settings in those files survive, and so does every tool binary
    - harlequin is the exception, because uv owns its whole environment rather than one file in `~/.local/bin`
    - pi stays, because it holds your logins and sessions

What the config holds:

- The script reads `~/.acstack/terminal-workspace.yaml`, which the skill copies from `assets/terminal-workspace/config.example.yaml`
- The config holds twelve components, each with its own `enabled` key
    - You turn a part off there and run `apply` again
- Eight components name a tool this setup installs: `herdr`, `gh_dash`, `diffnav`, `delta`, `tuicr`, `lazygit`, `yazi`, and `harlequin`
- `neovim` names an editor you installed yourself, and writes one file into its config
    - It starts off, and [LazyVim](#lazyvim-a-dot-for-unsaved-changes-and-copy-over-ssh) says why
- `pi` names a coding agent, which npm installs, and ACStack then installs into
    - It starts off too, and [pi](#pi-acstack-in-a-second-coding-agent) says why
- The other two name a feature
    - `markdown` covers `acstack-md` with mermaid-ascii and glow
    - `remote` covers the clipboard and browser helpers
- Config keys use underscores
    - gh-dash's key is `gh_dash`

Every setting has a default, so `apply` works with no config file and says so when it finds none.

- The two gh-dash review keys used to be the exception
    - That writer read `review` and `agent_review` straight from the yaml, with no default of its own
    - A machine with no config had both pruned and neither written back
    - `o` already defaulted
    - It kept working, and the config looked healthy
- Both keys now default like everything else, and an empty string still turns one off
- A `gh_dash:` heading with nothing under it is what commenting the block out leaves behind
- That now falls back to the defaults too, where it used to abort the gh-dash step with a traceback
- The script edits between its own marker comments
    - Hand-written config around it survives
- gh-dash is the exception
    - Python rewrites that config whole
    - No comment survives the round trip
    - The script therefore tracks its own keybindings there by name

## What `apply` installs, and how to do it by hand

*`apply` installs eight tools into `~/.local/bin`, herdr through its own installer, gh-dash as a `gh` extension, and harlequin through uv. None of it needs root.*

Two things to do first:

- Put `~/.local/bin` on your `PATH`
- Install the `gh` command

Where each binary lands:

- Every binary except herdr lands in `~/.local/bin`, or in `$ACSTACK_TW_BIN` when you set that
- herdr's own installer always uses `~/.local/bin`

By hand, herdr and gh-dash install like this:

```bash
# herdr
curl -fsSL https://herdr.dev/install.sh | sh

# gh-dash, as a gh extension
gh extension install dlvhdr/gh-dash
```

Eight more are single static binaries.

- Download each project's Linux x86_64 release
- Put the binary in `~/.local/bin`, then `chmod +x` it

| Tool | GitHub repository | Release asset |
|---|---|---|
| delta | `dandavison/delta` | `x86_64-unknown-linux-gnu` |
| diffnav | `dlvhdr/diffnav` | `Linux_x86_64` |
| fzf | `junegunn/fzf` | `linux_amd64` |
| lazygit | `jesseduffield/lazygit` | `linux_x86_64` |
| tuicr | `agavra/tuicr` | `x86_64-unknown-linux-gnu` |
| yazi | `sxyazi/yazi` | `x86_64-unknown-linux-gnu`, which also carries `ya` |
| mermaid-ascii | `AlexanderGrooff/mermaid-ascii` | `Linux_x86_64` |
| glow | `charmbracelet/glow` | `Linux_x86_64` |

harlequin is the one tool uv installs, rather than a release tarball.

- `uv tool install harlequin --with harlequin-postgres --with harlequin-snowflake` installs the editor and both adapters
- A machine without `uv` skips the component, and `apply` prints the one command that installs uv

Three more steps `apply` handles that no release tarball covers:

- `ya pkg add yazi-rs/plugins:piper`, the yazi plugin that lets `acstack-md` draw the preview pane
- `pip install --user markdown`, which `acstack-md --serve` needs
- a copy of `mermaid.min.js` at `~/.acstack/cache/mermaid.min.js`
    - A served page fetches nothing from a content delivery network (CDN)

## Let herdr read agent state from the agent

*A hook reports what an agent is doing, rather than herdr guessing from the screen.*

```bash
herdr integration install claude    # also: codex, opencode, copilot, and others
```

- Check what is available with `herdr integration status`
- The hook applies to a session that starts after you install it
- The `herdr.integration` key in the config picks which one `apply` installs

## The tuicr fork build is temporary

*Two of the config keys for tuicr exist only in a fork build, which also carries one bug fix. Leave `build_from_fork: false` unless you want them.*

Two upstream pull requests are still open:

- [agavra/tuicr#607](https://github.com/agavra/tuicr/pull/607) by
  [antonio2368](https://github.com/antonio2368) – configurable per-file
  `+added -removed` counts in the tree, and the `show_file_line_stats` key

- [agavra/tuicr#633](https://github.com/agavra/tuicr/pull/633), opened from ACStack's own
  fork – move the file list boundary with `<leader>L` / `<leader>H`, and the
  `file_list_width` key

The fork carries a third change of its own, with no upstream pull request yet.

- It fixes blank `+N -N` counts in pull request review mode, `tuicr pr <N>`
- That mode has no version control system (VCS) backend of its own
    - It borrowed the `File` type, which `--file <path>` uses, as a stand-in
- The fork's whole-file gate hides counts for `--file` and `--all-files`, since every line there counts as added
- That gate matched a review session too
    - The counts stayed blank even with `show_file_line_stats` on
- The fix gives a review session its own `PullRequest` VCS type
    - The gate no longer matches it
- Leave `build_from_fork: false` unless you want one of those three changes
- The default installs the stock release and skips both config keys
    - tuicr then never warns about an unknown key
- Setting `build_from_fork: true` clones the fork and builds `local/daily` with cargo
    - It also writes the two keys plus `no_update_check = true`
        - `tuicr update` cannot replace the build
    - `apply` replaces a value you set by hand on any of those keys rather than joining it
        - TOML forbids two of one key, and tuicr ignores a config it cannot parse

On a machine where you did set it true:

- `setup.sh status` reports the state of both pull requests
- After both merge, check whether anyone has submitted the counts fix above upstream too, then set `build_from_fork: false` again
- Stock tuicr 0.23.0 has no counts feature at all
    - It never had this bug or the fix
- Switching back before that fix lands upstream brings the blank counts back to review mode
- Re-run `apply` once you do switch
- Check the merged key names first
    - The review can rename them

## Pin tuicr's light or dark theme

*tuicr works out its own theme by asking the terminal what colour it paints. Nothing answers under `herdr --remote`, so set `tuicr.appearance` on any machine you reach over the network.*

- tuicr's own default asks the terminal for its background colour over OSC 11, an escape sequence a terminal answers with the colour it is painting
- Under `herdr --remote` nothing answers, and tuicr falls back to `gsettings get org.gnome.desktop.interface color-scheme`
- A headless machine answers that with `default`, which tuicr reads as light
    - It then paints a light theme with a transparent background, leaving dark text on a black terminal
- Set `tuicr.appearance` to `dark` or `light`, and tuicr skips the whole detection path
- Leave it empty on a machine you sit at, where the terminal answers for itself

## LazyVim: a dot for unsaved changes, and copy over SSH

*Set `neovim.enabled: true` to get both. LazyVim hides unsaved changes, and over SSH it cannot copy to your clipboard.*

- LazyVim's `pretty_path` component sets `modified_sign = ""`, so the only signal is colour
    - It sets `modified_hl = "MatchParen"`, which recolours the filename you are already looking at
    - You cannot tell a saved buffer from an unsaved one at a glance
- `apply` writes `~/.config/nvim/lua/plugins/acstack.lua`, which appends a lualine component to `lualine_c`
    - LazyVim loads every file under `lua/plugins`, so a file of our own is a complete plugin spec
    - The dot is `●` in catppuccin red, and `neovim.unsaved_dot_color` changes the colour
- This is the only component that starts off, because a neovim config is one you built
    - Every other component owns its files outright, or edits a marked region in a config that invites one
- It writes one whole file and never edits one of yours
    - `setup.sh disable neovim` deletes that file, and so does `uninstall`
    - Neither one touches a `acstack.lua` you wrote by hand
- `apply` skips a machine with no LazyVim config, because both parts of the file rely on LazyVim
    - `apply` says so rather than writing a file that does nothing
- `apply` leaves the dot out when a lualine override you wrote already marks a modified buffer, and names that file
    - LazyVim loads every file under `lua/plugins`, so yours does exactly what this component does
    - The statusline would then carry two dots side by side
    - Neither file looks wrong on its own, and the only place the collision shows is the statusline
    - Delete your own file to hand the dot to this component

Copy over SSH:

- Over SSH, LazyVim sets `clipboard` empty and neovim finds no provider, so `:%y+` fails with `clipboard: No provider`
- The same file sets `vim.g.clipboard` to send every copy over OSC 52, which reaches the clipboard of the machine you sit at (see [acstack-clip](clipboard-and-browser.md#acstack-clip-the-clipboard))
    - It also sets `clipboard=unnamedplus` after LazyVim's own `VeryLazy` restore, so a plain `y` copies too
    - `apply` leaves that option alone when a file of yours sets `clipboard`
- `p` pastes what neovim copied last, and never asks the terminal
    - Windows Terminal refuses OSC 52 reads, and neovim's own OSC 52 paste then waits ten seconds
    - Paste text copied elsewhere with your terminal's paste key, `ctrl+shift+v` in Windows Terminal
- The file does nothing on a machine with a display, or inside tmux, which each have a clipboard of their own
- `apply` leaves the clipboard out when a file of yours already sets `vim.g.clipboard`, and names that file
- `neovim.osc52_clipboard: false` turns it off
- `setup.sh status` prints a `neovim clipboard:` line naming which provider neovim uses

## pi: ACStack in a second coding agent

*Set `pi.enabled: true` to install pi, the coding agent, with ACStack and your pi settings. It starts off, because it writes into pi's own config.*

What `apply` does:

- It installs pi with `npm install -g @earendil-works/pi-coding-agent` when pi is missing
- It installs ACStack into pi, pinned to the version of this plugin
    - Re-running `apply` after a plugin update moves the pin forward, and never back
- It installs `ac-teams` for agent delegation, shared tasks, and messaging
    - Reapplying removes replaced delegation and todo packages only if this setup installed them; user-installed packages stay
- It installs `billion-context` by default for context compression in pi
    - When the `bili` command is available, setup runs native plugin setup for pi
    - Setup leaves Claude Code and Codex alone, and removes bili from them if an older setup added it
    - Set `pi.billion_context: false` to leave it out, or to remove it later if this setup installed it
- It installs `pi-plugin-manager` by default
    - Set `pi.plugin_manager: false` to leave it out
- It installs `@juicesharp/rpiv-ask-user-question` as pi's question tool by default
    - ACStack uses it because decisions can include markdown, code and artifact previews
    - It accepts freeform answers and notes, and needs no full-event telemetry environment variable
    - This setup still keeps pi's install telemetry disabled through `pi.settings.install_telemetry: false`
    - ACStack's Pi package loads the question bridge automatically, including installations made without terminal-workspace setup
    - Setup also installs a fallback copy under pi's agent directory, honoring `PI_CODING_AGENT_DIR`
    - The packaged bridge and fallback copy count each wait once when both load
    - The bridge translates `rpiv:ask-user:blocked` into `herdr:blocked`, so herdr shows the question's input wait
    - Answer, cancellation, and error completion release the question's blocker while other herdr blockers stay active
    - Anonymous native Herdr events remain independent from question events, including simultaneous waits
    - A producer emitting both event types contributes two balanced blockers, which clear when both sources finish
    - Older fallback copies work unless another extension recursively emits public question events; remove the older copy in that case
    - Reapply refreshes the owned bridge, but preserves a pre-existing file at the same path
    - `pi.question_tool: false`, `disable pi`, and `uninstall` remove only the owned bridge and leave user workarounds alone
    - Set `pi.question_tool: false` to leave the package out, or remove it later if this setup installed it
- It installs `pi-web-access` by default for Pi web search and web access
    - The package is `pi-web-access` from `nicobailon/pi-web-access`
    - It adds web search, URL fetching, GitHub repo cloning, PDF extraction and media understanding tools to pi
    - This is separate from pi's anonymous install and update reporting; `pi.settings.install_telemetry: false` still controls that telemetry setting
    - Set `pi.web_access: false` to leave it out, or to remove it later if this setup installed it
- It can install `pi-lens` for diagnostics and code-intelligence tools
    - It is off by default because it is a heavier dev-tool layer
    - Set `pi.lens: true` to install it, or `pi.lens: false` to remove it later if this setup installed it
- It installs `pi-slash-anywhere` by default, so slash commands work from any prompt
    - Set `pi.slash_anywhere: false` to leave it out, or to remove it later if this setup installed it
- It installs `pi-compact-tools` and runs `agentic-retro install-pi`, each behind its own toggle
    - The agentic-retro step needs the agentic-retro plugin installed first, and `apply` says so when it is not
- It writes the delegation line into pi's context file in `~/.pi/agent`, between HTML comment markers
    - That is `AGENTS.md` by default, or the first of `AGENTS.override.md`, `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md` and `CLAUDE.MD` that exists, which is the one pi reads
    - Delegate only when your request or your instructions allow it
- It binds `"app.message.dequeue"` to `"ctrl+enter"` in `~/.pi/agent/keybindings.json`
- It writes the four keys under `pi.settings` into `~/.pi/agent/settings.json`
- It patches pi's bundled TUI so Windows Terminal Win32 input records paste as text
    - `pi update` can replace the bundle, so `setup.sh upgrade pi` reapplies the patch
- It patches an existing herdr Pi reporter to keep the parent working while background subagents run
    - Questions still show blocked, even when children are active
    - The patch retains legacy delegation-event support; it does not track ac-teams sessions
    - Children already running during an extension reload lack lifecycle replay and remain outside this tracking
    - `apply`, herdr integration installation, and `setup.sh upgrade herdr` reapply the patch
    - Direct `herdr integration install pi` overwrites the patch; run `apply` afterward, then restart Pi or use `/reload`
    - Setup leaves unknown reporter layouts unchanged and reports the skipped patch
    - `disable pi`, `disable herdr`, and `uninstall` remove unchanged managed patch blocks

How it treats pi's files:

- pi's config is JSON, which has no comments to mark a managed region with
- `apply` claims only the keys it writes, and every other key stays
- `apply` installs and removes packages through `pi install` and `pi remove`, and never edits `packages` itself
- `apply` touches nothing in a file that does not parse, and names it
    - A broken `settings.json` stops the whole component, because `pi install` rewrites that file
- `~/.acstack/terminal-workspace.pi.json` records what `apply` added
    - `disable pi` and `uninstall` undo only what that file names
    - A package or a key you had before `apply` stays yours
    - A value of yours that `apply` replaced goes back, and so does an ACStack pin it moved forward
    - A value you changed after `apply` stays as you set it
- `apply` never touches `auth.json`
    - Run `pi`, then `/login`, yourself
- `setup.sh status` reports pi's version, its packages, the delegation line, and whether `auth.json` exists
    - The question bridge line reports a managed asset, a user-owned path, or an absent asset
    - Start a new pi session or run `/reload` after setup changes extensions
- `setup.sh outdated` and `setup.sh upgrade` include `ac-teams`, `billion-context`, `pi-plugin-manager`, `@juicesharp/rpiv-ask-user-question`, `pi-web-access`, `pi-lens`, and `pi-slash-anywhere` like pi's other npm packages
## The herdr config file

*Every herdr key in [Keys](keys.md) lives in `~/.config/herdr/config.toml`, validated without a restart. Three choices in that file are worth explaining.*

- Validate with `herdr config check`
- Apply without restarting with `herdr server reload-config`
- Undo with `herdr config reset-keys`

```toml
[keys]
# Jump straight to an agent by its sidebar row.
focus_agent = "alt+1..9"

# Panes, on the same vim letters as the prefix bindings.
focus_pane_left  = ["prefix+h", "alt+h"]
focus_pane_down  = ["prefix+j", "alt+j"]
focus_pane_up    = ["prefix+k", "alt+k"]
focus_pane_right = ["prefix+l", "alt+l"]

# Agents, tabs, workspaces.
next_agent = "alt+n"
previous_agent = "alt+u"
next_tab = ["prefix+n", "alt+right"]
previous_tab = ["prefix+p", "alt+left"]
next_workspace = ["alt+down"]
previous_workspace = ["alt+up"]

# By number. herdr leaves switch_workspace unbound and puts switch_tab on
# prefix+1..9, so without these there is no way to reach a workspace by number.
switch_workspace = "prefix+1..9"
switch_tab = "prefix+alt+1..9"

# Overlays and movement.
toggle_sidebar = ["prefix+b", "alt+s"]
# g belongs to git: alt+g is lazygit and alt+shift+g is its tab.
goto = "prefix+t"
zoom = ["prefix+z", "alt+z"]
last_pane = "alt+a"

# Creating things. Closing stays on the prefix so a mistyped chord cannot
# kill a pane with an agent running in it.
new_tab = ["prefix+c", "alt+c"]
new_workspace = ["prefix+shift+n", "alt+w"]
new_worktree = "alt+r"
# Removal asks for confirmation, so it can sit on a chord.
remove_worktree = "alt+shift+r"
split_vertical = ["prefix+v", "alt+e"]
split_horizontal = ["prefix+minus", "alt+minus"]

# A popup floats over the layout and returns you where you were. Each one has
# a tab variant on the shift chord, which goes through acstack-herdr-tab.
# herdr runs a popup with its server's PATH. That PATH may lack ~/.local/bin.
# Each popup goes through acstack-popup, which puts that folder back.
[[keys.command]]
key = "alt+f"
type = "popup"
command = "/home/you/.local/bin/acstack-popup acstack-diff"
description = "diff: branch vs dev"
width = "90%"
height = "90%"

[[keys.command]]
key = "alt+shift+f"
type = "shell"
command = "acstack-herdr-tab diff acstack-diff"
description = "diff: branch vs dev (tab)"

[[keys.command]]
key = "alt+g"
type = "popup"
command = "/home/you/.local/bin/acstack-popup lazygit"
description = "git: stage, commit, push"
width = "90%"
height = "90%"

[[keys.command]]
key = "alt+shift+g"
type = "shell"
command = "acstack-herdr-tab lazygit lazygit"
description = "git: stage, commit, push (tab)"

[[keys.command]]
key = "alt+x"
type = "popup"
command = "/home/you/.local/bin/acstack-popup acstack-diff pick"
description = "diff: pick what to compare"
width = "90%"
height = "90%"

[[keys.command]]
key = "alt+shift+x"
type = "shell"
command = "acstack-herdr-tab diffpick acstack-diff pick"
description = "diff: pick what to compare (tab)"

[[keys.command]]
key = "alt+i"
type = "popup"
command = "/home/you/.local/bin/acstack-popup acstack-dash"
description = "PR dashboard"
width = "95%"
height = "95%"

[[keys.command]]
key = "alt+shift+i"
type = "shell"
command = "acstack-herdr-tab dash acstack-dash"
description = "PR dashboard (tab)"

[[keys.command]]
key = "alt+y"
type = "popup"
command = "/home/you/.local/bin/acstack-popup yazi"
description = "file tree"
width = "95%"
height = "95%"

[[keys.command]]
key = "alt+shift+y"
type = "shell"
command = "acstack-herdr-tab yazi yazi"
description = "file tree (tab)"

[worktrees]
directory = "~/.herdr/worktrees"

[ui]
# A pane's scrollbar costs the pane a column that herdr does not subtract.
pane_scrollbars = false
show_agent_labels_on_pane_borders = true
```

- A `shell` command carries no `width` or `height`
    - herdr rejects both on anything that is not a popup

Four settings that are not keys sit alongside the block above. Each one is
written only when the config names it, so a machine that says nothing about a
setting keeps whatever herdr already does.

| Config key | Writes | Default |
| --- | --- | --- |
| `herdr.agent_labels_on_pane_borders` | `show_agent_labels_on_pane_borders` in `[ui]` | `true`, and written either way |
| `herdr.agent_panel_sort` | `agent_panel_sort` in `[ui]` | empty, so nothing is written |
| `herdr.toast_delivery` | `delivery` in `[ui.toast]` | empty, so nothing is written |
| `herdr.theme.name` and `herdr.theme.light` | `[theme]` | empty, so nothing is written |

**One server, two devices, two backgrounds.**

- `auto_switch` asks each attached client for its background colour over OSC 11, an escape sequence a terminal answers with the colour it is painting
- herdr then picks `dark_name` or `light_name` from the answer, per client
- A dark terminal on one device and a light one on another each get the right theme
    - An e-ink panel is the case that makes this worth having
- A client that answers nothing falls back to `dark_name`
    - So `apply` writes `herdr.theme.name` into both `name` and `dark_name`
- `herdr.theme.name` on its own writes the name and nothing else
    - With no light theme, nothing has anything to switch to

Three choices worth explaining.

**Plain `alt` chords, not `ctrl+alt`.**

- herdr's own keyboard page recommends `ctrl+alt`
    - It is free across most terminals
- [What differs, and why it decides your keymap](../terminal-workspace.md#what-differs-and-why-it-decides-your-keymap) has the measurements showing it dies under `herdr --remote`
- Follow herdr's advice only if you attach exactly one way and have tested it

**Absolute `worktrees.directory`.**

- A relative value resolves against the herdr session's base directory, not the repository you point at
- Worktrees for a second repository then land inside the first
- Use an absolute path unless you only ever work in one repository

**`pane_scrollbars = false`, so a full-screen app gets the whole pane.**

- herdr draws a border and a scrollbar inside the pane rect, then reports the full rect width to the program in the pane
- A program that fills the pane then writes one column more than it has
    - Every wrapped row starts one column left of the row above it
- Measured on one machine: `herdr pane layout` reported a 132-column rect at `x=26`, the PTY and neovim's `&columns` both reported 131, and 130 were usable
    - The arithmetic is herdr's, so it should hit anyone running `pane_scrollbars = true`, and that is unproven on a second machine
- `alt+s` twice repairs the display, because toggling the sidebar recomputes the geometry from scratch
- The cost is that no pane draws a scrollbar
    - Scrolling still works, because the mouse wheel and copy mode never used it
- Set `herdr.pane_scrollbars: true` in the workspace config to take the scrollbar back

## When the sidebar numbers stop matching

*Creating a worktree moves the sidebar rows and not the stored order. One helper realigns them.*

- Collapse the sidebar with `alt+s` and each workspace shows a number
- That number is its position in herdr's stored list
- The `prefix+N` chord uses the row's position in the grouped sidebar instead, where a worktree sits indented under its parent repository
- They agree until you touch a worktree
- A new one appends to the end of the stored list but appears mid-sidebar under its parent
- Everything below it shifts
    - The number you read stops being the number you press

```bash
acstack-herdr-renumber
```

- That rewrites the stored order to match the grouped order
    - Both agree again
- It prints the result and is safe to run repeatedly

You rarely have to run it.

- `apply` links a small herdr plugin, `acstack.herdr-numbers`, that runs the same helper on every event which can move a row
- Run the helper by hand when you configured herdr yourself, or when `apply` reported that the plugin link failed
- The `herdr.renumber_plugin: false` key turns the plugin off
- The `acstack-herdr-` prefix is the convention for a helper that only works under herdr
- A plain `acstack-` helper such as `acstack-diff` or `acstack-md` runs in any terminal
    - The name tells you up front what a command depends on
- Both forms are reachable through the CLI, which dispatches an unknown subcommand to `acstack-<name>` on your PATH

Two things the helper cannot fix.

- Only rows 1 to 9 are reachable
    - A tenth workspace needs `prefix+t` or `alt+up` and `alt+down`
- `prefix+N` stays positional
    - It names a row rather than a workspace and still moves when the rows move
