# Reading, diffs, and SQL in the terminal workspace

*The file tree and markdown reader, the harlequin SQL editor, and the diff and pull request tools. Their keys are in [Keys](keys.md).*

## Reading code, markdown, and diagrams

*A file tree with live preview. Markdown that draws its mermaid diagrams as text.*

### The file tree

*yazi opens over your layout on `alt+y`, and every review popup works the same way.*

- The file tree is yazi, a keyboard-driven file manager that previews whatever the cursor sits on
- Press `alt+y` for yazi in a popup, which floats and leaves the tab layout alone
- Press `alt+shift+y` for yazi in a new tab instead

Every popup works this way: `alt+f` and `alt+shift+f` for diffnav, `alt+i` and `alt+shift+i` for gh-dash.

- A popup is right for a glance
- A tab is right for something you will come back to
- Both come from the same command, and the tab variant goes through `acstack-herdr-tab`
    - That helper creates the tab in the workspace and directory you pressed the key in
    - Then it sends the command with `herdr pane run`
    - Outside herdr it simply runs the command
- This setup leaves `alt+t` alone on purpose
    - It is Claude Code's thinking toggle
- The one collision to know about is your terminal emulator claiming the same chords
- You fix that where the emulator runs, per [When a key does nothing](keys.md#when-a-key-does-nothing)
- yazi previews each file type with its own command
- It routes markdown to `acstack-md`
    - A document therefore renders **as the cursor moves over it** rather than needing a keypress
- The `Enter` key opens the same renderer full width, where more of a wide diagram fits than the preview pane allows
- The `~` and `F1` keys both open yazi's help
- Icons come from a Nerd Font, and without one every icon draws as an empty box
- Install any Nerd Font and select it in your terminal
- tuicr was the file tree before yazi
- yazi then took that job, and tuicr kept the one it is better at, reading diffs and reviewing pull requests
- It gets that work from gh-dash on the `D` key, which runs `tuicr pr <number>` in the local clone
- The command `tuicr --file .` still browses a tree if you want it

### Reading markdown and mermaid

*`acstack-md` draws a file with its diagrams, and two keys inside the pager change what you are looking at.*

```bash
acstack-md NOTES.md              # terminal, diagrams drawn as text
acstack-md --numbered NOTES.md   # the source instead, with its line numbers
acstack-md --diagram 2 NOTES.md  # one diagram alone, scrollable sideways
acstack-md --serve NOTES.md      # browser, prints a clickable link
acstack-md --browser NOTES.md    # the browser you are sitting at, wherever that is
acstack-md --html NOTES.md       # that same page, as one document on stdout
```

`--numbered` answers the one question a rendering cannot, which is what line of the file this is.

- A review comment names a line number, and a rendered heading has none
- `--numbered` therefore prints the source with a right-aligned gutter
- The gutter is as wide as the largest number in it
    - The source stays on one column however long the file
- It pages through `less -S`, which chops rather than wraps
- The arrow keys pan across a long line
- The gutter keeps its column

Two keys work while you are reading.

- The `b` key opens the page in the browser you are sitting at and returns you to where you came from
    - It uses the routes in [Getting the page to the browser](#getting-the-page-to-the-browser-you-are-sitting-at)
        - It is the same key whether you attached over `herdr --remote`, over SSH, or locally
- The `#` key switches the document between the rendered view and its source with line numbers, and switches it back
    - That is the moment you usually want a line number
        - You do not have to quit back to the tree

Both keys move.

- `ACSTACK_MD_LINE_NUMBERS_KEY` moves `#`, and `ACSTACK_MD_BROWSER_KEY` moves `b`
- In `less`, `b` is back-a-page
    - The binding costs you nothing, and both `Ctrl-B` and `PageUp` still do that
- Both bindings need `less` 582 or newer, and an older version leaves the two keys alone
- [How `b` and `#` reach a running pager](design-notes.md#how-b-and--reach-a-running-pager) explains the mechanism

A wide diagram cannot fit a narrow pane.

- `acstack-md` replaces anything wider than the terminal with a note
- The note gives its size and the two ways to see it
- The `--diagram N` flag prints that one diagram unwrapped through `less -S`, where the arrow keys scroll sideways
- `ACSTACK_MD_PAD` tunes the spacing passed to `mermaid-ascii`, defaulting to `-x 2 -y 2`
    - Tighter padding buys roughly a third of the height back and very little width
- [Why a wide diagram becomes a note](design-notes.md#why-a-wide-diagram-becomes-a-note) explains why the note exists at all
- Terminal mode replaces each mermaid fence with a box-drawing rendering
- `mermaid-ascii` handles `graph`, `flowchart`, and `sequenceDiagram`
- Anything else keeps its source visible with a note rather than disappearing

Two things `acstack-md` normalises first, because `mermaid-ascii` handles
neither:

- `style`, `classDef`, `class`, `linkStyle`, and `click` lines, which it would
  otherwise draw as if each were a node

- node shapes other than `[square]` – `{decision}`, `((circle))`, `([stadium])`,
  `[(database)]`, `{{hexagon}}` – whose syntax would otherwise leak into the label

Serve mode renders the file with python-markdown and draws diagrams with a **locally vendored** mermaid.js, so the page fetches nothing from a CDN.

- It binds `127.0.0.1` only
- It re-reads the file on every request
- It prints an OSC 8 hyperlink, the escape sequence that marks a piece of text as a link the terminal draws itself
    - herdr then rebuilds that link into the frame it sends the client
    - The bare URL prints underneath for a terminal without OSC 8
- So ctrl+click opens the page in the browser on your own machine, as long as your SSH config forwards the port from there
- The `acstack-md --serve` command takes that port from `$ACSTACK_MD_PORT` and falls back to 6419

Only one server can hold that port at a time, and a second `--serve` names the process holding it and the command to stop it:

```
port 6419 is busy: [Errno 98] Address already in use
  held by pid 680666: acstack-md-serve - /path/to/NOTES.md 6419 serve
  stop it with:  kill 680666
```

- Use that pid rather than `pkill -f acstack-md-serve`, which also matches any shell whose own command line mentions the name, including the one you type it in

### Reading markdown from the file tree

*Move the cursor onto a markdown file and yazi previews it rendered. `Enter` reads it full width.*

The file tree draws markdown twice over.

- Moving the cursor onto a `.md` file renders it straight into the preview pane, through the piper plugin running `acstack-md --preview`
- The pane is narrow
    - A wide diagram shows a placeholder there rather than a chopped drawing
- `Enter` on the same file opens `acstack-md` full width, where the diagrams fit
- A rule in yazi's `[opener]` config table puts that ahead of the editor
    - Reading is the default
- Press `O` to choose from the same menu instead, which offers **Read (acstack-md)**, **Read with line numbers**, then **Edit**
- Nothing shims `$EDITOR`
- Nothing changes your shell environment
- `b` on a file hands it to the browser you are sitting at, by the routes in [Getting the page to the browser](#getting-the-page-to-the-browser-you-are-sitting-at)
- The key is free in yazi's file list
    - Its only default binding is a word motion while you are typing into a prompt, which this does not touch
- Move it with `yazi.browser_key`
- `#` switches the preview pane between the rendered markdown and the source with line numbers, and switches it back
    - Press it when you are about to quote a line in a review
    - The pane redraws as `acstack-md --numbered` would print it, numbers down the left
    - Every later `.md` file you move onto previews the same way until you press `#` again
- The key is unbound in yazi's file list, and `yazi.line_numbers_key` moves it
- The same key does the same job one level in, while you are reading a document full width after `Enter`
    - That is the more common moment to want it
    - The two are deliberately the same key
        - There is nothing to remember about which of the two places you are standing in
    - [Reading markdown and mermaid](#reading-markdown-and-mermaid) describes the reader's half
- It is a binding in `lesskey`, the key-binding config file for the `less` pager, rather than a yazi one
    - So `yazi.line_numbers_key` does not move it
- The switch is a file on disk, `$XDG_STATE_HOME/acstack/md-line-numbers`
- `acstack-md --toggle-line-numbers` creates and removes it
- That is what the key runs
- Only the preview pane reads it (see [why the line-number switch lives in a file](design-notes.md#why-the-line-number-switch-lives-in-a-file))
- `setup.sh apply` reads a `yazi.toml` you wrote first and leaves alone anything you have set
- Add `acstack-md` to your own `[opener]` table to read markdown with it
- Add `show_hidden = true` to your own `mgr` table if you want hidden files shown
- [What yazi's config merge concedes](design-notes.md#what-yazis-config-merge-concedes) says what it concedes and why
- `D` sends the file under the cursor to the machine you sit at, over Tailscale Taildrop
    - Taildrop is Tailscale's file send
    - It beats `scp` back to a laptop, because it needs nothing installed at the other end and no inbound port there
    - The file lands in that machine's Tailscale receive folder
- The key appears only when `yazi.download_target` names a Tailscale node, and `yazi.download_key` moves it
- Taildrop sends only between devices one Tailscale account owns on one tailnet
    - On this machine `tailscale status` may report the target as `offline`
        - That means you signed the other machine in to another tailnet, whatever its own Tailscale client shows
    - A `502 Bad Gateway` from the send means the same thing
    - Read `tailscale status` on both ends and compare the account column, because two nodes can share a hostname across two tailnets
- One step has no config key, because it is machine-level
    - `tailscale file cp` answers a non-root caller with `Access denied: file access denied` until the account owns the daemon
    - Run `sudo tailscale set --operator=$USER` once

Four keys and a cursor move cover the loop.

1. Press `alt+y` for the tree.
2. Move the cursor onto a markdown file to preview it.
3. Press `#` to see its source with line numbers.
4. Press `Enter` to read it full width with its diagrams drawn.
5. Press `q` to go back to the tree.

### Getting the page to the browser you are sitting at

*`--browser` works out where your browser is and picks a delivery that reaches it.*

- `--browser` is the one to reach for
    - The same key works however you attached
    - It asks `acstack-open --why` where the browser is rather than deciding that a second time

| Where the browser is | What `--browser` does |
| --- | --- |
| Behind the opener on your laptop | Posts the whole document to it. The opener stores it, serves it, and opens your default browser |
| A desktop on this machine, or the Windows Subsystem for Linux (WSL) | Serves it and opens it |
| The far end of the Playwriter bridge, with no opener | Hands the whole document down the Chrome DevTools Protocol (CDP) link, into the tab the extension is armed on |
| Anywhere else, over SSH | Serves it and prints a clickable link |

The [Playwriter bridge](../../skills/bridge/SKILL.md) is the setup that lets a program on the dev machine drive Chrome on your laptop.

- It works one tab at a time
- Arming means clicking the extension's icon on the tab you are willing to hand over

The opener is the route you want.

- It is a small service on your laptop that takes a page and opens it in your default browser
- [The opener](clipboard-and-browser.md#the-opener-a-page-in-your-own-browser-with-nothing-to-click) covers how it gets installed
- There is nothing to arm and no extension
- The browser it reaches is your default one rather than a dedicated Chrome profile
- Read one document after another and each simply appears
- Re-render a file you are already looking at, and the tab you have open updates in place, scroll position kept
- No second tab joins the first

The page itself decides that last part, rather than the opener remembering it.

- Every page the opener serves polls it for its own version
    - A tab that is still open says so by asking
- Re-render that file and the opener sees a live tab and lets it reload itself
- Close the tab and the asking stops
    - The next render opens a fresh one
- Remembering that it once opened something would get the closed-tab case wrong every time

The bridge is the fallback, and it is the one that needs explaining.

- Under `herdr --remote` the reverse SSH tunnel to your laptop runs the *other way*
- Nothing on the laptop can open a port on the dev machine
- A link to `localhost:6419` names the laptop's own localhost, where nothing is listening
- So there is no link to hand over, only a document
- That is what `--html` is for
- `--html` prints the page `--serve` would have served, once, to stdout, and starts nothing
- A document you can capture in a variable travels
- A port does not
- The `--browser` flag is `--html` plus the delivery
- The two share one renderer
    - The page cannot differ between them
- They differ in exactly one place, which [why `--html` names a CDN](design-notes.md#why---html-names-a-cdn-and---serve-does-not) covers
- On the bridge the page replaces what is in the armed tab
- The helper opens no new tab
- Arming the extension is how you nominate the tab this may take over
    - That is the tab it takes over
- `--browser` says so and stops rather than falling back to serving, when the bridge is the route and the push fails
    - A link the laptop resolves to its own localhost is a wrong answer dressed as a working one

We measured one delivery rather than estimating it.

- This document, 39KB of markdown, renders to 50KB of HTML in under 200ms
- It reaches a laptop browser, diagram drawn, in about two seconds

### Why text and not inline images

*No terminal you can reach from Windows or Android draws the graphics herdr emits.*

- herdr embeds libghostty and emits the **kitty graphics protocol**, one of the two ways a terminal draws an inline image
- It emits no sixel, the other way
- Windows Terminal renders sixel and has never supported kitty, and [microsoft/terminal#8389](https://github.com/microsoft/terminal/issues/8389) is still open
- No Google Play terminal supports either protocol
- The intersection is empty
    - An inline image never arrives no matter which terminal you pick
- Text also suits e-ink, where the fast refresh modes an interactive terminal needs are the ones that discard the greyscale depth an image needs
- `chafa` is worth adding by hand, with `apt install chafa`, if you want images drawn as text
- It ships source-only so the setup script does not install it

## Harlequin: a SQL editor on one key

*`alt+q` opens harlequin on a connection profile. `alt+shift+q` opens it in a tab.*

- Query on the left, rows on the right, schema tree beside both
- Profiles live in `~/.acstack/harlequin.toml`, which `acstack-db` writes once and never touches again
- `acstack-db` with no argument launches the only profile, or opens an fzf menu when there is more than one
- `acstack-db <profile>` skips the menu

### Why uv, and not a release binary

- harlequin is a python program, so there is no static binary to download
- `uv tool install harlequin --with harlequin-postgres --with harlequin-snowflake` builds it an environment of its own and links one command into `~/.local/bin`
- A machine without `uv` skips the component, and `apply` names the one command that installs uv
- Adding an adapter to `harlequin.adapters` and re-running `apply` reinstalls with the new set
    - `uv tool install` on an already-installed tool does nothing, so `apply` compares the config against uv's own receipt and passes `--force` when they differ

### Postgres profiles

- Keep the password out of the profile file: write the line `host:5432:db:user:password` in `~/.pgpass`, `chmod 600` it, and leave the password out of `conn_str`
    - libpq reads that file on every connection, so harlequin never handles the secret
- Put `read_only = true` on any production profile, which harlequin hands to the postgres adapter so every connection on that profile refuses a write

```toml
[profiles.prod]
adapter = "postgres"
conn_str = "postgresql://postgres@db.example.supabase.co:5432/postgres"
read_only = true
```

### Connecting to Snowflake

- Put the credentials in `~/.snowflake/connections.toml` and name the connection from the profile, rather than writing a connection string into the acstack file
- `externalbrowser` authentication does not work on a dev machine, because there is no browser for it to open
    - Use a key pair, or a password
- `--read-only` exists for postgres and not for snowflake

## Diffs and pull requests

*Diffs with a file tree, pull request triage with saved searches, and the two helpers that make one key always show something useful.*

### Five git settings that route every diff through delta

*One pager for `git diff`, `git show`, and gh-dash alike.*

```bash
git config --global core.pager delta
git config --global interactive.diffFilter "delta --color-only"
git config --global delta.navigate true
git config --global delta.line-numbers true
git config --global merge.conflictstyle zdiff3
```

- This does not change what agents see
    - The git command only pages to a terminal
    - A caller that pipes or captures the output still gets plain text

### Saved searches become dashboard tabs

*Any GitHub search string is a section, and two keys hand a pull request to tuicr or to an agent.*

`~/.config/gh-dash/config.yml`.

```yaml
prSections:
  - title: Mine
    filters: is:open author:@me
  - title: Needs review
    filters: is:open review-requested:@me
  - title: Failing
    filters: is:open author:@me status:failure

issuesSections:
  - title: Mine
    filters: is:open author:@me
  - title: Assigned
    filters: is:open assignee:@me

# Local clones. Required for checkout and for {{.RepoPath}} in keybindings.
repoPaths:
  <you>/<repo>: ~/code/<repo>

keybindings:
  prs:
    - key: D
      name: review (tuicr)
      command: >
        cd {{.RepoPath}} && tuicr pr {{.PrNumber}}
    - key: S
      name: agent review
      command: >
        cd {{.RepoPath}} && claude "/code-review {{.PrNumber}}"
```

- Anything you can type into GitHub's search box becomes a tab
- Avoid binding `R`, the built-in refresh-all

### The diff and dashboard helpers

*One key shows what your branch adds to dev. Another picks any comparison. A third opens the dashboard, scoped to where you are standing.*

- `alt+f` runs `acstack-diff`, which compares the branch you are on against `origin/dev`, committed work only
- A repository with no dev branch falls back to the default branch, read from `origin/HEAD`
- The comparison is `git diff <base>...HEAD`, three dots
    - You see the commits your branch added since the two diverged, and never the ones the base picked up meanwhile
- A pane often sits in `<root>/<repo>/`, the parent directory herdr groups a repository's worktree workspaces under, rather than in a checkout
    - The helper then offers a numbered list of the checkouts it finds there

Every launch opens with a banner naming both sides, because diffnav renders whatever precedes the first `diff --git` line:

```
COMPARING  origin/dev  ==>  deployment-map
base     origin/dev  a84216b  16 hours ago  Merge pull request #44 from
compare  deployment-map  549e94b  68 minutes ago  chore: integration edits
showing  commits on deployment-map that origin/dev does not have
command  git diff origin/dev...HEAD
```

- Base first, then compare
    - That is the order `git diff` takes its arguments
    - It is also the order GitHub labels its two compare pickers
- The `command` line is real git syntax
    - You can paste it into a shell
- The comparison also reaches diffnav's status bar, which stays visible while you walk the file tree
- That works because diffnav prints the line following a `commit <sha>` header as the commit subject
    - The helper synthesises that header for a plain diff
- A single-commit view already carries git's own header and gets no synthetic one
- No banner line may start with a space, because diffnav strips leading whitespace
    - Any indentation collapses and the columns stop lining up

#### A file diffnav cannot draw

*One committed source map used to abort the whole diff. The helper drops that file and names it.*

diffnav hands each file to delta, and delta dies on `SIGABRT` when one line runs to hundreds of kilobytes. diffnav reports its child's death and quits:

```
Error: signal: aborted (core dumped)
2026/08/24 02:04:25 FATA signal: aborted (core dumped)
```

- A committed build artifact is what does it
    - ACStack's own `cli/dist/index.js.map` carries a single 982,428-character line
    - `alt+f` on `main` aborted in 1.7 seconds and showed none of the other 51 files

So the file goes, and not the diff. The helper drops any file whose patch holds a line over 20,000 characters, and names it in the banner:

```
skipped  cli/dist/index.js.map  (one line is 982428 chars, and diffnav aborts on it)
```

- 20,000 is far above any line a person writes and far below where delta gives out
- `ACSTACK_DIFF_LINE_LIMIT` changes it
- The helper refuses anything that is not a positive whole number
- awk compares each line length against that value
    - A value like `abc` makes every comparison a string comparison
    - A string comparison is never true here
    - A typo would otherwise switch the guard off and bring the abort back, with nothing on screen to explain it
- Where the helper drops every changed file, it says so
    - The old code said "No difference between these two"
    - That claimed nothing had changed in a repository that had

#### Picking a different comparison

*`alt+x` opens an fzf menu of seven comparisons. Every row reads left to right as base, then compare.*

```
dev          ==>  my-branch                 committed work only
dev          ==>  my-branch + uncommitted   committed work plus what is not committed
main         ==>  my-branch                 committed work only
main         ==>  my-branch + uncommitted   committed work plus what is not committed
HEAD         ==>  my uncommitted changes    staged and unstaged changes only
its parent   ==>  one commit                pick a commit from this branch's history
any branch   ==>  any branch                pick the base, then the branch to compare
```

- The dev rows appear only where a dev branch exists, and the branch named is the one you are on
- Branch lists come from `git for-each-ref` over local and remote branches, newest commit first, with `git log` in the preview pane
- The commit list is the last 300 commits, with `git show --stat` in the preview
- Picking "any branch" asks twice, prompting `source (compare against)` and then `change (the new work)`
- `apply` installs fzf alongside diffnav, and without fzf the picker says so and falls back to the automatic diff

`acstack-dash` adds a section for whichever repository you are standing in, then hands a generated config to gh-dash:

```bash
#!/usr/bin/env bash
set -uo pipefail
BASE="$HOME/.config/gh-dash/config.yml"
REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)"
[ -z "$REPO" ] && exec gh dash "$@"
GEN="$(mktemp)"; trap 'rm -f "$GEN"' EXIT
REPO="$REPO" python3 - "$BASE" "$GEN" <<'PY'
import os, sys, yaml
cfg = yaml.safe_load(open(sys.argv[1])) or {}
repo = os.environ["REPO"]; short = repo.split("/")[-1]
s = [x for x in cfg.get("prSections", []) if x.get("title") != short]
s.insert(0, {"title": short, "filters": f"repo:{repo} is:open"})
cfg["prSections"] = s
yaml.safe_dump(cfg, open(sys.argv[2], "w"), sort_keys=False)
PY
gh dash --config "$GEN" "$@"
```

- Because a herdr popup inherits the focused pane's directory, `alt+i` from an agent's worktree opens the dashboard already scoped to that repository

### acstack-gh: why an action failed

*gh-dash throws gh's stderr away, so a helper on `$PATH` turns a refusal into a notification.*

- gh-dash shells out to `gh` for everything it does to a pull request, and throws the command's stderr away
- GitHub refusing one therefore arrives as `exit status 1` in the footer, for two seconds
- Approving your own pull request is the case you meet daily
    - GitHub always refuses that
- The input box closes, nothing else happens
- The dashboard looks like it ignored the key

`acstack-dash` answers that without patching gh-dash.

- It links `acstack-gh` into a directory of its own at the front of `$PATH`, under the name `gh`
- gh-dash therefore finds it before the real one
- The real `gh` still does the work and still decides the exit code
- The only thing added is a notification carrying gh's own words when a `pr` or `issue` action fails:

```
gh pr review failed
Can not approve your own pull request.
```

- `acstack-gh` passes `gh dash` itself straight through
- It also passes through every subcommand that is not an action, `repo view` and `api` among them
- Those fail for reasons a notification cannot help with

### Why diffnav's `o` opens a tab

*diffnav's `o` opens the file in a new herdr tab rather than taking over the pane, because of the popup.*

- diffnav runs `$EDITOR` inside its own pane, and a herdr popup cannot host a second full-screen app
- Neovim never drew in the `alt+f` and `alt+x` popups, so the key looked dead
- `acstack-edit` stands in as `$EDITOR` and hands the file to `acstack-herdr-tab`, the same helper the tab keys use
    - The tab opens in the workspace and directory you pressed the key in
    - The tab carries the file's name, not its whole path
    - The popup keeps the diff, so close it to reach the tab
    - Outside herdr the helper runs your real editor in place
