# What crosses back to your machine

*A dev machine has no display and no clipboard of its own. The `acstack-clip` and `acstack-open` helpers carry each one back across the link.*

Two gaps, and three gh-dash keys fall into them:

- `o`, open on GitHub, fails with `exit status 1`. gh-dash opens URLs through `$BROWSER`, falling back to `xdg-open`, and `xdg-open` with no `$DISPLAY` exits 1
- `y` and `Y`, copy the URL and the number, fail with `Failed copying to clipboard`. The gh-dash tool copies through a Go library that shells out to `xclip`, `xsel`, `wl-copy` or `termux-clipboard-set`. A bare dev machine has none of them installed
- An install would not make them work
- Neither is a gh-dash bug, because the clipboard and the browser are on the machine you are typing at, several hops away
- The two helpers below carry each one back across

## acstack-clip: the clipboard

*OSC 52 crosses SSH for free, so a copy on the dev machine lands on your own clipboard.*

- OSC 52 is the escape sequence that asks a terminal to put text on its own clipboard
- It is bytes in the terminal stream
    - It crosses SSH for free
- herdr forwards it from a pane to whatever terminal hosts it
- Windows Terminal, iTerm2, kitty, and Ghostty all act on it

```bash
acstack-clip "some text"      # copy the arguments
git rev-parse HEAD | acstack-clip
acstack-clip --out            # print what was copied last
```

- Reading back is not symmetrical
- Windows Terminal refuses OSC 52 clipboard *reads* on purpose
    - A program that can read your clipboard without asking is a security hole
- So `--out` replays a local cache, and not the real clipboard
- To reach a program that only knows how to shell out, `setup.sh apply` also writes an `xclip` onto `$PATH` backed by `acstack-clip`
- That is what makes gh-dash's `y` and `Y` work unchanged, with no rebinding and no flicker
- The `remote.clipboard_shim` key turns it off, and `setup.sh uninstall` removes it
- The script skips it anyway on a machine with a real `xclip`, or with a display for one to talk to

## acstack-open: the browser

*Seven routes, tried in order, ending in a link you can click from any terminal.*

- `o` is a gh-dash keybinding rather than a `$BROWSER` setting
- That is deliberate
- The dashboard is still on screen when gh-dash runs `$BROWSER`
- It discards that command's output
- A route that needs to say anything, or to hand you a link to click, therefore has nowhere to put it
- As a keybinding gh-dash steps aside and gives `acstack-open` the terminal

It tries, in order:

1. `$ACSTACK_OPEN_CMD`, if you set one. The escape hatch
2. `xdg-open`, when this machine has a display after all
3. `wslview` or `explorer.exe`, when the Windows half of the machine holds the browser
4. The opener on your laptop, which puts the page in your default browser with nothing to click. See [the opener](#the-opener-a-page-in-your-own-browser-with-nothing-to-click)
5. Chrome on your laptop through the [Playwriter bridge](../../skills/bridge/SKILL.md), but only after it proves the browser is really reachable that way. See [why the bridge and the opener must prove themselves](design-notes.md#why-the-bridge-and-the-opener-must-prove-themselves)
6. A clickable link. The terminal you are sitting at draws the URL as an OSC 8 hyperlink, so ctrl+click reaches your own browser. The URL goes on your clipboard too
7. With no terminal to draw on either, the URL still goes on the clipboard, and the command reports failure

- The link route needs nothing installed in between
    - That is why it is the last one that can still work
- A terminal that ignores OSC 8 still shows the bare URL, and its own URL detection can catch that
- Route 7 reports failure on purpose
    - Silent success is what left gh-dash claiming it had opened a page that never opened

The opener sits ahead of the bridge because the two are not competing for the same job.

- The bridge exists so an *agent* can drive a browser
    - It attaches one tab at a time, only after somebody clicks the extension icon
    - It does so in a dedicated Chrome profile
- The opener exists so it can show a *person* a page
    - It needs no click at all
    - It reaches the browser you actually use
- Both can be up at once
- Each keeps its own job
- `setup.sh status` prints which route a machine will take, and the last line of `~/.cache/acstack/open.log` says what the last press actually did

## Under `herdr --remote`

*We wrote both helpers for this shape, and they need no change. The clipboard crosses, and the browser falls to the link route, which is the one built for it.*

- `herdr --remote <target>` runs the server, and therefore every pane process, on the dev machine
- The client is a thin attach
    - It sends input and draws what the server sends back

`acstack-clip` works, and we measured that rather than inferring it.

- A pane's OSC 52 write reaches the clipboard on the machine you attached from
- So `acstack-clip "some text"` on the dev machine pastes on your own
- Nothing in herdr's own documentation promises this
    - It mentions OSC 7 and OSC 8, and never OSC 52
- We tested it on herdr 0.8.2 and it crossed
- Terminals differ in what they act on
    - Copy something with `acstack-clip` after your first attach and check that it pasted
- Clipboard *images* travel the other way, and only on this path
- Copy a screenshot on your machine, focus an agent pane, and herdr stages the image on the dev machine and pastes its path
- An SSH shell cannot do that at all
    - That is the single strongest reason to prefer a remote attach
- `acstack-open` runs on the dev machine
    - That is the honest answer for routes 1 to 5
- An override, a display, WSL, the opener or a bridge tunnel all have to be reachable *from there*
- The opener and the bridge are reachable
    - The laptop opens reverse tunnels that carry them back
- So on a machine set up for either, that is the route it takes
- With neither, it falls to the link route, the one built for this
- In that route herdr tracks hyperlinks per cell and re-emits them when it renders
    - The client therefore draws the link rather than shipping raw bytes
    - ctrl+click opens the browser on the machine you attached from
- The link route also degrades further than the others
- Even with no OSC 8 and no OSC 52 at all, the URL is on screen as plain text, which drag-select copies
- That is why the link is its own text rather than a label over it

One trap belongs to your SSH config rather than to herdr.

- The `acstack-md --serve` command prints the URL it is listening on
- That is the port *on the dev machine*, meaning `$ACSTACK_MD_PORT` or 6419
- The printed link is wrong from where you are sitting, if your host block forwards it to a different local port
- You want the local number instead
- Forwarding `6419` to `6419` avoids the question entirely

## On a machine with none of this

*The link route needs only a terminal. One environment variable buys back a real one-key open.*

The link route works over SSH, through herdr, and under `herdr --remote`. To get a real one-key open instead, give `acstack-open` something that can do it:

```bash
export ACSTACK_OPEN_CMD="ssh laptop open"   # or any command taking a URL
```

## The opener: a page in your own browser, with nothing to click

*A small service on your laptop. It takes a page from the dev machine, stores it, serves it back, and opens your default browser on it.*

- The dev machine has no browser and no way to reach yours
- The bridge solved that for agents, and not for reading
    - It needs a tab armed by hand before every session
    - The tab it drives lives in a dedicated Chrome profile rather than your default browser
- The opener is the answer for reading
- A separate service opens documents without depending on the relay or the browser automation session

What it does is deliberately small:

| The dev machine sends | The opener does |
| --- | --- |
| A URL | Hands it to your default browser |
| A rendered document | Stores it, serves it at `http://127.0.0.1:19989/doc/<id>`, opens that |
| A vendored `mermaid.min.js`, once | Keeps it, and answers `/mermaid.js` off it from then on |
| A request to restart the relay or the tunnel | Restarts that scheduled task |

- The relay is the process on your laptop that the Playwriter extension connects to
- Restarting it, and restarting the tunnel, are the two recovery actions the dev machine could never perform
- They now go through the opener instead of arriving as a block for you to paste into PowerShell
- Arming the extension is still yours
    - It is a click inside a third-party extension and nothing on either machine can press it

Installing the opener is the same command that registers the bridge, which now registers the opener too:

```powershell
cd $env:USERPROFILE\playwriter-bridge
.\register-tasks.ps1 -VMs @("vm1.example.com")
```

- That generates a shared secret and stores it at `%LOCALAPPDATA%\playwriter-bridge\opener.token`
- It copies the secret to each dev machine at `~/.acstack/opener.token`, over the same ssh the tunnel uses
- Every request from the dev machine carries it
- Loopback binding alone would not be enough
    - The reverse tunnel makes the port reachable by anything running on the dev machine
    - This is a service that puts pages on your screen

The opener rides the same machinery as the bridge.

- A scheduled task from `register-tasks.ps1` runs it, and a supervisor restarts it
- The `sync.ps1` script reconciles the deployment on every Claude Code launch
- Your laptop opens a reverse SSH tunnel
- The opener gets its **own** tunnel task, `Playwriter-OpenerTunnel-VM<N>`, which carries port 19989
- The bridge keeps port 19988 on a task of its own
- Both tasks run the same `tunnel.ps1` script
- They stay apart because ssh runs with `ExitOnForwardFailure=yes`
    - One wedged port fails the whole connection
    - Sharing one connection would let a stuck opener port take the bridge down with it
- A document outlives the session that rendered it, which lets a page still work after the dev machine has gone away
- The opener prunes a stored document after a week
