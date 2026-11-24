# Terminal workspace keys

Every key worth memorising, on one page. Run `/acstack:terminal-workspace` to install what they drive, and see [Install and configure](install.md#the-herdr-config-file) for the herdr config that binds them.

Two layers:

- **`alt`** reaches herdr from anywhere, including from inside a running tool
- **`prefix`** is `ctrl+b`, then the key, for what you press rarely and for anything that closes a pane

Each tool also lists its own keys:

- Press `prefix+?` in herdr, then `/` to filter
- Press `?` in gh-dash, lazygit, and tuicr
- Read diffnav's footer
- Press `f1` in harlequin

## Move around

| Key | Does |
|---|---|
| `alt+h` `alt+j` `alt+k` `alt+l` | move between panes |
| `alt+1` to `alt+9` | jump to an agent by its sidebar row |
| `prefix+1` to `prefix+9` | switch workspace by row |
| `prefix+alt+1` to `prefix+alt+9` | switch tab by position |
| `alt+n` / `alt+u` | next / previous agent |
| `alt+left` / `alt+right` | previous / next tab |
| `alt+up` / `alt+down` | previous / next workspace |
| `alt+a` | last pane |
| `alt+z` | zoom this pane |
| `alt+s` | toggle the sidebar |
| `prefix+t` | go to a pane by name |
| `prefix+w` | navigate mode, a persistent movement surface |
| `prefix+[` | copy mode |
| `prefix+q` | detach, leaving everything running |

Three separate lists answer to `1..9`, and they are not the same list.

- `alt+N` walks agents
- `prefix+N` walks workspaces
- `prefix+alt+N` walks the tabs of the workspace you are in
- An agent row and a workspace row that share a number are a coincidence
- [When the sidebar numbers stop matching](install.md#when-the-sidebar-numbers-stop-matching) covers worktrees shifting the rows

The `ctrl` and `shift` modifiers are not options for a fourth list, and which one fails depends on how you attached.

- A `shift+<digit>` chord arrives as punctuation on both paths
- A `ctrl+<digit>` chord reaches herdr under `herdr --remote` but not over SSH
- A binding you make on one path is therefore silently dead on the other (see [What differs, and why it decides your keymap](../terminal-workspace.md#what-differs-and-why-it-decides-your-keymap))
- The three chords above, `alt+N`, `prefix+N`, and `prefix+alt+N`, are what both attach paths carry

## Make and close things

| Key | Does |
|---|---|
| `alt+e` / `alt+minus` | split right / down |
| `alt+c` | new tab |
| `alt+w` | new workspace |
| `alt+r` | new worktree workspace |
| `alt+shift+r` | remove this worktree (asks first) |
| `prefix+x` / `prefix+shift+x` / `prefix+shift+d` | close pane / tab / workspace |

## Open a tool

A popup floats over your layout and puts you back where you were when you close it. Add `shift` to any of these to open the tool in a full tab instead.

| Key | Opens | For |
|---|---|---|
| `alt+f` | diffnav | what your branch adds to dev |
| `alt+x` | diffnav picker | choose what to compare |
| `alt+g` | lazygit | stage, commit, push |
| `alt+i` | gh-dash | your pull requests on GitHub |
| `alt+y` | yazi | find and read a file |
| `alt+q` | harlequin | run a SQL query |

`g` belongs to git and `e` means edit in every tool that has an editor key, except diffnav, which spends `e` on its file tree.

## Inside each tool

### diffnav (`alt+f`, `alt+x`)

| Key | Does |
|---|---|
| `j` / `k` | move in the file tree |
| `n` / `N` | next / previous file |
| `ctrl+d` / `ctrl+u` | scroll the diff half a page |
| `ctrl+e` / `ctrl+y` | scroll the diff one line |
| `Tab` | switch focus between tree and diff |
| `t` | search and jump to a file |
| `e` | toggle the file tree |
| `s` | side-by-side or unified |
| `o` | open the file in Neovim, in a new herdr tab ([why a tab](reading-diffs-sql.md#why-diffnavs-o-opens-a-tab)) |
| `q` | quit |

### gh-dash (`alt+i`)

| Key | Does |
|---|---|
| `j` / `k` | move between rows |
| `h` / `l` | previous / next section |
| `p` | toggle the preview pane |
| `[` / `]` | previous / next preview tab: Overview, Activity, Commits, Checks, Files Changed |
| `PageDown` / `PageUp` | scroll the preview |
| `ctrl+d` / `ctrl+u` | scroll the preview, vim style |
| `e` | expand the description |
| `d` | built-in diff |
| `D` | open the pull request in tuicr and review it there |
| `S` | hand the pull request to an agent |
| `o` | open the pull request in the browser you are sitting at |
| `C` or `space` | check the branch out locally |
| `w` | watch checks |
| `c` / `v` / `m` | comment / approve / merge |
| `y` / `Y` | copy number / URL |
| `r` / `R` | refresh section / all |
| `/` · `?` · `q` | search · help · quit |

### lazygit (`alt+g`)

| Key | Does |
|---|---|
| `space` | stage the file under the cursor |
| `a` | stage everything |
| `c` | commit |
| `A` | amend the last commit |
| `P` | push |
| `?` | every key |

### yazi (`alt+y`)

| Key | Does |
|---|---|
| `Enter` | read the file full width, which for markdown is `acstack-md` |
| `O` | choose an opener: read, read with line numbers, or edit |
| `e` | edit in `$EDITOR` |
| `i` | inspect Markdown in Frogmouth (install with `pipx install frogmouth`; existing `i` bindings take precedence) |
| `#` | switch the preview between rendered markdown and source with line numbers |
| `b` | open in the browser you are sitting at |
| `D` | send the file to your laptop over Taildrop, when `yazi.download_target` is set |
| `~` or `F1` | help |

### acstack-md, while reading

| Key | Does |
|---|---|
| `#` | switch between the rendered page and its source with line numbers |
| `b` | open the page in the browser you are sitting at |
| arrow keys | pan across a long line or a wide diagram |

### harlequin (`alt+q`)

| Key | Does |
|---|---|
| `f2` / `f5` / `f6` | editor / results / catalog |
| `tab` / `shift+tab` | next / previous pane |
| `ctrl+enter` or `ctrl+j` | run the query |
| `f4` | format the query |
| `f8` | query history |
| `ctrl+e` | export the results |
| `f9` or `ctrl+b` | hide the catalog sidebar |
| `f10` | full-screen the focused pane, and again to restore it |
| `ctrl+p` | the command palette |
| `f1` | every key |
| `ctrl+q` | quit |

- `tab` cycles the panes from outside the editor, and inside it `tab` indents
- In the catalog, the schema tree, `space` expands the node under the cursor and `ctrl+enter` puts its name in the editor at the cursor
    - Plain `enter` selects the node and leaves the editor alone
- The footer writes `ctrl+q` as `^q`
- Custom keys go in a `[[keymaps.<name>]]` block in the profile file, named from `keymap_name` on a profile, which harlequin's own documentation covers

### tuicr

`;` is tuicr's leader: press it, release it, then press the second key.

| Key | Does |
|---|---|
| `e` | edit the focused file in `$EDITOR` |
| `c` | comment on the line |
| `y` | copy the review to the clipboard |
| `;o` | open the PR on GitHub |
| `;L` / `;H` | widen / narrow the file tree, then bare `L` / `H` to keep going |
| `x` | filter files out of the tree |
| `?` | every key |

`;L` and `;H` need the fork build, which `tuicr.build_from_fork` in the config installs.

### LazyVim

| Key | Does |
|---|---|
| `space` | show every key, with labels |
| `space` `space` | find a file |
| `space` `/` | grep the project |
| `space` `e` | file tree |
| `space` `g` `g` | lazygit |
| `H` / `L` | previous / next file |
| `:Tutor` | learn vim in 25 minutes |

## When a key does nothing

*You bind the keymap on the dev machine, but the emulator on the machine you type at intercepts the chords first. Fix that where the emulator runs.*

- Windows Terminal binds `alt+shift+d` to "duplicate pane" by default
    - It never forwards the key
        - A binding on it does nothing at all on the dev machine and the local tab splits instead
    - That is why both diff keys sit on `f`: `alt+f` and `alt+shift+f`, and not `alt+d`
- Other emulators claim other chords
- This is true on both attach paths
    - The emulator sees the key first either way

To confirm an emulator is eating a chord rather than herdr ignoring it, run `cat -v` in any pane and press the key.

- A chord that arrives prints an escape sequence such as `^[Z`, so the problem is the remote config
- One that prints nothing never left your machine
- [assets/terminal-workspace/client-keybindings.md](../../assets/terminal-workspace/client-keybindings.md) lists every chord this setup uses and how to unbind them in the common emulators
- Follow it yourself, or hand it to an agent running on that machine
- Never try to edit a client-side emulator config from the dev machine
- Never paste your local config onto the dev machine so that something there can rewrite it

## When a full-screen app draws its rows one column further left each time

- herdr's pane scrollbar costs the pane a column, and setup turns the scrollbar off for that reason
- The symptom is a wrapped row starting one column left of the row above it
    - neovim shows it, and so does any other program that draws the whole pane
- Toggling the sidebar with `alt+s` repairs the display until the next launch, because it recomputes the geometry
- Check the setting survived with `grep pane_scrollbars ~/.config/herdr/config.toml`
- Re-apply it with `bash assets/terminal-workspace/setup.sh apply`
- [The herdr config file](install.md#the-herdr-config-file) explains the cause
