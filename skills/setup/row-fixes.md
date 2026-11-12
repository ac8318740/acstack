# Setup: row fixes

[The setup skill](SKILL.md) loads Step 8 on every run and Step 9 for the selected row fixes.

## Step 8: Offer the rows that need a fix

Build one multi-select question in the question tool (AskUserQuestion with
`multiSelect: true` on Claude Code). Put one option in it per row you are going
to offer, and say in each description what the row reported. This is the pre-selection the user sees: only real gaps reach the menu.

Offer a row when any of these holds:

- Its `status` is `fail`.
- Its `id` is `preferred-browser-mode`, its `status` is `info`, and
  `<project folder>/project.yaml` (in the project folder `acstack project-data path` prints) configures a `frontend` block. The project has a
  frontend and has named no browser mode for it.

- Its `id` is `output-style` and its `status` is `info`. The row passes when the
  settings files select `acstack:ac-writing-style`, so `info` means they select
  some other style, or select none.

- Its `id` is `frontend-verification` and its `status` is `info`. The project
  configures a frontend and `workflow.frontend_verification` is not `true`.

Each of those rules reads the `status` and the `id`. Read neither row's message
to decide, for the reason Step 7 gives: the message is prose and it gets
reworded.

Add three options at the end of the list, whatever the check reported:

- **Re-declare this machine** – invoke the `host` skill. It re-asks every axis,
  required and optional, and starts from the current answers.

    The check reports an `optional-axis:<key>` row as `info`, never as `fail`.
    So this option is the only way one of them reaches a question.

- **Change one setting** – for a key the check has no opinion about, such as
  `workflow.maps.persist`. Point the user at `docs/config-reference.md`, which
  lists every key, its values and its default. Then write the key:

  ```bash
  ~/.claude/acstack/bin/acstack config set workflow.maps.persist true
  ```

  Do not restate the reference here.

- **Skip** – leave everything as it is.

## Step 9: Fix one row at a time

Five rows describe the machine: `required-axis`, `orchestrator`, `browser-mode`,
`preferred-browser-mode` and `optional-axis`. Invoke the `host` skill for each of
them, with one exception: `optional-axis:host.terminal_workspace` is Step 12's
question, and the `host` skill never asks it. It is safe to re-run, and it starts from the current answers.

A `preferred-browser-mode` row is the exception. It goes to the `host` skill only
on a `fail`, and to Step 10 on an `info`.

One row has second fixes: `browser-mode:<mode>`. Which one applies depends on the
mode, and for two of the three modes the `host` skill is no fix at all.

A `browser-mode:remote` failure says the machine declares the remote mode and
nothing answered on the port. If the machine really does drive a browser that
way, the bridge is down, so run Step 11. If it does not, the axis is wrong, so
run the `host` skill.

A `browser-mode:headless` or `browser-mode:local` failure says one thing and
nothing else: the machine declares the mode and no Chromium or Chrome binary sits
on PATH. The axis is right and the machine is short a browser. Re-running the
host interview changes nothing here, and answering the axis false records a lie
about what this machine can do.

Offer to install the browser instead:

```bash
sudo apt install chromium-browser   # Ubuntu/Debian
sudo dnf install chromium           # Fedora
```

Then re-run the health check from Step 7. The row passes once the binary is on
PATH.

A `frontend-verification` row needs no step of its own. The project configures a
frontend and has not turned browser verification on. Turn it on:

```bash
~/.claude/acstack/bin/acstack config set workflow.frontend_verification true
```

`docs/config-reference.md` documents the key.

### 9b. Install the browser driver

`agent-browser` is the command line tool the frontend verifier drives a browser
with. Offer to install it:

```bash
npm install -g agent-browser
```

### 9c. Write the browser configuration

Write `<project folder>/agent-browser.json` to name the CDP port:

```json
{"cdp": "<cdp_port>"}
```

Take `<cdp_port>` from `frontend.browser.cdp_port` in `<project folder>/project.yaml`. With
no value there, the default is `19988` under `mode: remote` and `9555` otherwise.
The row fails when the two files name different ports, so change one of them.

### 9d. Create the knowledge base for verification

Create `<project folder>/verification/VERIFICATION-KNOWLEDGE.md` for the frontend verifier.
Keep helper programs in `frontend.helpers_dir`; do not move that directory or require it for metadata.
Write:

```markdown
# Verification memory

The index of what a verification run needs to know about this project. Read this
file first, then only the topic files for the area under test. Follow the rules
in the `browser-verify` skill's Verification memory section: replace entries,
never append a run log.

## Every run

- Dev server: <!-- start command, URL, and loopback binding -->
- Sign-in: <!-- test account and where its credentials live -->

## Topics

<!-- One line per topic file in this folder, e.g.
- [auth.md](auth.md) – signing in, switching organizations -->
```

### 9e. Offer the writing output style

The plugin ships an output style. Claude Code names it `acstack:ac-writing-style`.
It applies the `writing` skill's plain-language rules to every chat reply.

Offer it. Never set it without asking.

The row's message names which of the three settings files selects a style, and
which style it selects. `.claude/settings.local.json` wins over
`.claude/settings.json`, which wins over `~/.claude/settings.json`.

Ask once:

```json
{
  "question": "Apply the acstack:ac-writing-style output style?",
  "options": [
    {"label": "Global (recommended)", "description": "Write outputStyle into ~/.claude/settings.json, so it applies in every project"},
    {"label": "This project only", "description": "Write outputStyle into .claude/settings.local.json, which overrides the global value here"},
    {"label": "Skip", "description": "Leave the output style as it is"}
  ]
}
```

Load the chosen file as JSON, set the one key, then write it back. Use `python3`
or `jq`. Never edit the file with a regular expression, because that corrupts the
other keys.

Stop and report a file holding malformed JSON. Do not overwrite it.

```bash
python3 - <<'PY'
import json, pathlib, sys
f = pathlib.Path("~/.claude/settings.json").expanduser()   # or .claude/settings.local.json
f.parent.mkdir(parents=True, exist_ok=True)
try:
    data = json.loads(f.read_text()) if f.exists() else {}
except json.JSONDecodeError:
    sys.exit(f"{f}: malformed JSON, aborting")
data["outputStyle"] = "acstack:ac-writing-style"
f.write_text(json.dumps(data, indent=2) + "\n")
PY
```

If the user chose global and a project file also sets `outputStyle`, say so. The
project value overrides the global one, so offer to remove that key.

Tell the user the style applies after `/clear`, or in a new session. Say that
`/config` -> Output style writes project scope only, which is why this step
offers the global path. Source: https://code.claude.com/docs/en/output-styles.md.

Claude Code has no command line flag for this. `claude config` does not exist,
and Claude Code dropped the `/output-style` command. Do not invent either.
