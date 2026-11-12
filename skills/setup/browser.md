# Setup: browser mode and Playwriter bridge

`SKILL.md` decides when to read this file: Step 9 routes a `preferred-browser-mode` info row to Step 10, or a `browser-mode:remote` failure to Step 11.

## Step 10: Ask the project's browser mode

Both paths reach this step. The first run reaches it because a fresh frontend
project states no preference. A re-run reaches it because the user picked that
row from the menu.

The machine says what it can do, in the `host.browser.*` axes. This question asks
a different thing: which of those modes this project would like to use.

Offer only the modes the machine declares available. When the machine declares
none, offer all three and run the `host` skill first.

The block below is the full menu, not the question to ask word for word. Drop the
entry for any mode the machine declares unavailable, then ask the rest.

```json
{
  "question": "How will you connect a browser for frontend verification?",
  "options": [
    {"label": "Headless (Recommended)", "description": "The frontend verifier drives headless Chrome through agent-browser. No setup required. Real Chrome is only needed for profiles, single sign-on, platform fonts, or a GPU."},
    {"label": "Remote browser (Playwriter bridge)", "description": "For checks that need your real Chrome, driven over SSH from a remote VM. Headless still runs every other check."},
    {"label": "Local with display", "description": "Launch a visible browser on this machine. Choose this for desktop Linux, macOS, or WSL with display access."},
    {"label": "Skip for now", "description": "I'll set this up later – /acstack:host to declare what this machine can do, /acstack:setup for the project's preference"}
  ]
}
```

Write the answer as `remote`, `headless` or `local`. Write the port beside it:
`19988` for `remote`, and `9555` for the other two.

```bash
~/.claude/acstack/bin/acstack config set frontend.browser.mode remote
~/.claude/acstack/bin/acstack config set frontend.browser.cdp_port 19988
```

Then write `<project folder>/agent-browser.json` with the same port, the way Step 9c in `row-fixes.md` does.

On **Skip for now**, leave `frontend.browser` unset and write no
`<project folder>/agent-browser.json`. Say that `docs/config-reference.md` documents the three
keys for later.

On **Headless**, no setup follows. Tell the user the frontend verifier launches
headless Chromium when it needs one.

On **Local with display**, look for a Chromium binary. Tell the user the frontend
verifier launches it when it needs one.

On **Remote browser**, ask what happens when a machine cannot reach the real
browser. Headless Chrome still runs every check that does not need it:

```json
{
  "question": "When a machine cannot reach your real browser, what should checks that need it do?",
  "options": [
    {"label": "Report the limit", "description": "Headless runs every other check; the verifier reports which real-Chrome checks could not run."},
    {"label": "Fail", "description": "Report FAIL. Choose this if headless results aren't useful for your app."}
  ]
}
```

Write `frontend.browser.fallback` as `headless` for the first answer, and as
`none` for the second. Only `none` acts. It forbids another mode from standing
in.

Then go to Step 11.

## Step 11: Connect the Playwriter bridge

Step 10 reaches this step on a `remote` answer. Step 9 reaches it on a
`browser-mode:remote` failure.

Invoke the `bridge` skill. It owns the Playwriter bridge setup: the relay and
extension on the browser machine, the reverse SSH tunnel, the Windows scheduled
tasks, and diagnosis. Do not repeat its steps here.

Then re-run the health check from Step 7 and read the `browser-mode:remote` row.
It passes once something answers on the port.

Do not curl the port yourself. The check is the one place that probes the
machine.
