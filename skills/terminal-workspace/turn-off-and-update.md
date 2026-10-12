# Turn off and update

`SKILL.md` decides when to read this file: when the user asks to turn a component off or uninstall, or `outdated` reports something.

## 8. Turning one component off, or all of them

*`disable` undoes one component. `uninstall` undoes the managed config. harlequin is the one binary either of them removes.*

```bash
bash "$SETUP" disable herdr     # or delta, diffnav, gh_dash, harlequin, lazygit, neovim, pi, tuicr
```

`disable` takes those nine components and no others. For `diffnav`, `gh_dash`,
`harlequin`, `lazygit` and `tuicr` it writes `<component>.enabled: false` into
the config itself, then rebuilds the herdr keymap so the rest of it survives.

For `herdr`, `delta`, `neovim` and `pi` it does not. Set `<component>.enabled: false`
yourself after those four, or the next `apply` restores them.

`neovim` is the one whose undo is a deletion. The component writes a whole file
of Mapflow's own, so `disable` removes `~/.config/nvim/lua/plugins/mapflow.lua`
and leaves the rest of the user's neovim config alone. Neither `disable` nor
`uninstall` touches a `mapflow.lua` the user wrote by hand.

`pi` undoes only what `apply` added, because pi's config is the user's:

- It removes the pi packages `apply` installed, and keeps any the user installed first
- It releases the four settings and `toolActivation`, unless the user has changed one since
    - A value `apply` replaced goes back to what the user had, and a key `apply` added goes
- It puts back a Mapflow pin `apply` moved forward, unless the user has moved it since
- It removes the delegation block from pi's context file, and the user's text stays byte for byte
- It removes agentic-retro's extension only when `apply` was the one to write it
- It keeps the pi binary, its logins and its sessions
- It touches nothing in a `settings.json` that does not parse, and says so
- It records what it added in `~/.config/mapflow/terminal-workspace.pi.json`

`yazi`, `markdown` and `remote` have no `disable` path. `disable` refuses for
those three and names the edit that turns one off. Set the component's
`enabled` key to `false` in the config, then run `apply` again.

```bash
bash "$SETUP" uninstall
```

`uninstall` removes everything `apply` wrote. It strips the managed blocks from
the herdr, tuicr and yazi configs. It unsets delta as the git pager.

It deletes the helper scripts, the `xclip` stand-in, the neovim plugin file, and
the keybindings it wrote into gh-dash. It runs `disable pi`. The user's own
settings around them survive, and every binary stays except harlequin, which uv
owns whole rather than as one file in `$BIN`.

pi stays too. It holds the user's logins and sessions, and the user may run it
without Mapflow. `uninstall` prints the npm command that removes it.

## 9. Keeping it current

*`outdated` reports what has moved on. `upgrade` fetches it.*

```bash
bash "$SETUP" outdated
```

It prints one finding per line, tab-separated as kind, name and detail, and
answers in its exit code:

| Exit | Meaning | What to do |
|---|---|---|
| 0 | Nothing to do | Say nothing |
| 1 | Something is missing, new or stale | Show the findings and offer `upgrade` |
| 2 | It cannot tell | Name the reason once and move on |

Four kinds of finding:

- `missing` – this machine has never applied the workspace, so run section 4 of `SKILL.md` rather than `upgrade`
- `new` – a component this plugin version ships that the user's last `apply` never saw
- `stale` – an installed tool behind its published release
- `unknown` – the script cannot compare, so there is nothing to act on

```bash
bash "$SETUP" upgrade              # everything reported stale
bash "$SETUP" upgrade yazi delta   # only these
```

pi adds four rows of its own:

- `pi`, `pi-subagents` and `pi-compact-tools` compare against npm, and `upgrade` runs `pi update` for each
    - A package the user pinned, such as `npm:pi-subagents@1.0.0`, reports `unknown`, because `pi update` never moves it
- `pi-mapflow` compares Mapflow's pin in pi against this plugin's version, with no network at all
    - `upgrade pi-mapflow` moves the pin forward, and so does `apply`
    - Neither moves a pin newer than this plugin, because the user chose it
    - Neither installs Mapflow where it is absent or unpinned

`upgrade` reinstalls each stale binary and appends any new component's config
block to the user's file, comments intact. The three tools that update
themselves go through `herdr update`, `gh extension upgrade dlvhdr/gh-dash`,
and `uv tool upgrade harlequin`. Run `apply` afterwards to install what the new
block turned on.

Naming a tool skips the version comparison, which is the only way to refresh
`mermaid-ascii`. It has no version flag, so nothing can read the installed version.

`outdated` reads herdr's stable release manifest, so a user on the preview
channel sees a `stale` row for herdr that is not one.
