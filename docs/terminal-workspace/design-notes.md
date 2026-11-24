# Terminal workspace: design notes and traps

*Why the parts work the way they do, and the mistakes that cost real time to find.*

## Design notes

*Why the parts work the way they do. Read this when you are changing the setup or debugging it, and skip it otherwise.*

### Why the markdown helpers are separate executables

*Node's startup would roughly double the cost of a preview that runs on every cursor move.*

- The `acstack-md` and `acstack-clip` helpers are their own executables rather than subcommands of the `acstack` CLI
- The `acstack-md --preview` command runs on every cursor move in the file manager, and Node's startup would roughly double it
- The CLI dispatches to them anyway, the way git does
- So `acstack md` runs `acstack-md`, either form works
- A config can keep the fast one

### How `b` and `#` reach a running pager

*A `lesskey` binding whose `quit` action carries an exit status, which `acstack-md` reads and acts on.*

- The `less` pager has no action that runs a fixed command
- Its one shell escape would hand over the rendered temporary copy rather than the file you asked for
- So each key quits `less` with an exit status of its own, and `acstack-md` reads that status and does the work
- It needs `less` 582 or newer, and an older version ignores the bindings and leaves both keys alone
- `setup.sh apply` writes the `#` binding as `\#` in the `lesskey` file
- `lesskey` reads a line starting with `#` as a comment
    - It drops a bare binding without a word
    - The key then does nothing but ring the terminal bell
- Only a leading `#` needs the escape
    - A backslash means something of its own to `lesskey`, and `\b` would bind backspace rather than the letter

### Why a wide diagram becomes a note

*Nothing can shrink a diagram. Wrapping box-drawing art destroys it.*

- A diagram's width comes from its node labels
    - Nothing can shrink a wide one into a narrow pane
- Wrapping box-drawing art destroys it instead of fitting it
- A note that names the size is the honest answer, and a badly drawn diagram is not
- A wide diagram still appears in place when it fits
- glow wraps whatever it renders
    - `acstack-md` holds the drawing back
    - It runs glow on the prose, then splices the full-width art into the output
- The pager is `less -S`
    - glow already wrapped the prose to the pane
        - Only the diagram lines chop, and the arrow keys pan across them

### What yazi's config merge concedes

*Declaring anything twice would make yazi reject the whole file, so `apply` gives up whatever you already set.*

- `setup.sh apply` reads your `yazi.toml` first and leaves alone anything you have set
    - That covers your `mgr` settings, your markdown opener, your `plugin.prepend_previewers`, and your `open.prepend_rules`
    - Whichever of the four it skipped, it says so
- Declaring any of them a second time would make yazi reject the whole config and fall back to presets
    - It concedes them instead
- What it cannot read is a `yazi.toml` that does not parse
    - yazi is then already ignoring the file in favour of presets
        - Fix the error and re-run `apply`
- The `b` and `#` bindings live in `keymap.toml` rather than `yazi.toml`, and `apply` writes them as `[[mgr.prepend_keymap]]`
- That spelling is an array of tables
    - It stacks with a binding you have already written the same way
- The one spelling it cannot sit beside is the inline `prepend_keymap = [...]` under `[mgr]`
    - That is a single key, and TOML forbids declaring it twice
    - The script detects that form, gives the bindings up rather than cost you the whole keymap, and says so
- The `[opener]` templates say `%s` rather than `"$@"`
- yazi runs a template as `sh -c '<template>'` with nothing after it
    - `$0` is `sh` and `$@` is empty
- A template written with `"$@"` hands the helper no file at all
- `%s` is the placeholder yazi substitutes, already quoted
- Measured on yazi 26.8.15
- The `keymap.toml` bindings say `%h` for the same reason, and never `%*`
    - `%h` is the hovered file
    - yazi quotes `%h` itself, so write it bare. Quotes around it end up inside the path.
    - `%*` belongs to `[opener]`, and a keybinding never expands it
        - The two characters go through untouched
        - The command reports them back as a filename, such as `open %*: no such file or directory`
    - So a binding that carries a file uses `%h`, and takes one file at a time
- The `#` key runs two actions rather than one, flipping the flag, then forcing yazi to draw the pane again
- Without the redraw the pane keeps showing whatever it drew before you pressed the key
- The switch looks broken until you move the cursor
- The flip blocks, though it has nothing to say
    - A detached one races the redraw and loses about half the time

One collision belongs to herdr rather than yazi.

- herdr hosts a `type = "shell"` command in a real pane for as long as the process runs
- So `acstack-herdr-tab` creates the tab and then hands the wait to a detached child
- It returns in about 100ms rather than three and a half seconds
- Without that a stray pane sits in the current tab

### Why the line-number switch lives in a file

*The key and the preview pane are two processes that never meet, so the switch has to sit on disk between them.*

- The state file is `$XDG_STATE_HOME/acstack/md-line-numbers`, or `~/.local/state/acstack/md-line-numbers` when that variable is unset
- Its presence is the whole setting
    - `acstack-md --toggle-line-numbers` only has to create or remove it
- Only the preview pane reads that file
    - Every other route asks for a view by name
- The full-width read has **Read with line numbers** as its own entry under `O`
- The `--diagram N` flag outranks the file too, since asking for one drawing is a different question from which view the pane is on

### Why `--html` names a CDN and `--serve` does not

*A document standing on its own has no server behind it to answer for `/mermaid.js`.*

- `--serve` answers for `/mermaid.js` off the vendored copy
    - Its page fetches nothing from a CDN
- A document standing on its own has no server behind it
    - `--html` names the CDN instead
- The vendored file is 3.5MB, and inlining it would make the page offline-proof and far too big to hand anywhere

A document bound for the opener is the third case.

- Here `--browser` hands it over once, like `--html`
- The document does end up behind a server, the opener's
    - It asks for `/mermaid.js` too
- The 3.5MB goes up once, the first time the opener admits it has no copy
- Every document after that draws its diagrams without reaching a CDN at all

### Why the bridge and the opener must prove themselves

*`agent-browser` launches a headless Chrome when it cannot attach. It then reports success to nobody.*

- `agent-browser` launches a headless Chrome on the dev machine when it cannot attach to the endpoint you gave it
- That Chrome navigates perfectly happily, reports success, and shows nobody anything
- The page opens on the dev machine, several hops from the screen you are looking at
- Nothing about the relay answering on port 19988 rules that out either
    - Ours answered `/json/version` while refusing every CDP connection with `Multiple extensions connected. Specify extensionId.`
    - Every open landed in a headless Chrome for hours without one error message
- So the bridge route asks the relay's `/json/list` what is on the far end, and takes the route only when something answers
- The Playwriter extension attaches per tab, and `/json/list` is its own answer to that question
- An empty `[]` means nobody has armed it on a tab
    - There is no browser to drive however healthy the tunnel underneath looks

The opener proves itself the same way and for the same reason.

- The `acstack-open` helper asks it for `/health`, carrying the shared token, and takes the route only if the opener answers
- A token sitting on disk proves nothing about a service being up
- A service being up proves nothing without the token it is going to demand
- Success on the bridge is likewise not an exit status
- The pushed script ends with the page title
    - The browser answers with what it is now holding
- The `--browser` flag only reports success when that answer is the file you asked for
- A command that exited 0 is not a page that arrived
- The helper opens no new tab either
- That is the second thing we measured rather than assumed
- CDP creates a tab in the **background**
- Nothing on the dev machine can bring it to the front
- The document would land in it, the helper would report success
- You would never see it

## Traps

*Each of these cost real time to find.*

- **`ctrl+b` is both herdr's prefix and Claude Code's "background this task"**
    - Press it twice inside a Claude pane to reach Claude, or rebind herdr's prefix
- **Never submit a prompt to a blocked agent**
    - A blocked agent waits on a permission prompt
    - Injected text answers that prompt instead of giving an instruction
    - Wait for idle
- **`--cwd` for `herdr worktree create` must be the main checkout**, and never a nested worktree
    - herdr stores it as the workspace's repository root
    - It also groups worktree workspaces under it in the sidebar
- **Read the created path from the command output**
    - Never assume where a worktree landed
        - The configured root decides
- **Worktree workspaces nest, and plain workspaces do not**
    - A workspace made with `alt+w` always sits at the top level, whatever directory it points at
- **Sidebar actions act on the selected workspace**, and not on the focused pane
    - Open the sidebar and select before creating a worktree or closing a workspace
- **In-process teammates are invisible to herdr**
    - A Claude teammate shares its parent's pane and session
        - It never appears as its own agent
    - Two agents in one worktree means two real sessions
- **gh-dash never says why an action failed**
    - It discards gh's stderr
    - A refusal shows as `exit status 1` for two seconds
    - `acstack-gh`, which `acstack-dash` puts on `$PATH` as `gh`, turns that into a notification quoting gh
    - Approving your own pull request is the one you will hit
- **A dev machine has no clipboard and no browser**
    - The `o`, `y`, and `Y` keys in gh-dash all fail there until `apply` installs `acstack-clip` and `acstack-open`
    - The `setup.sh status` command says which browser route a machine ended up with
- **Snowflake's browser login cannot work on a dev machine**
    - `externalbrowser` authentication opens a browser, and that machine has none
    - Use a key pair or a password, held in `~/.snowflake/connections.toml`
    - `--read-only` guards a postgres connection only, so a snowflake profile has no such switch
- **diffnav aborts on one very long line**
    - delta dies on `SIGABRT`, and diffnav quits with `FATA signal: aborted (core dumped)`, showing none of the diff
    - `acstack-diff` drops any file whose patch holds a line over 20,000 characters and names it in the banner
    - A committed source map is the usual culprit
        - The file is worth keeping out of git in the first place
