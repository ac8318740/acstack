apply_herdr() {
  have herdr || { say "herdr not installed, skipping keymap"; return 0; }
  # Every popup runs through acstack-popup. disable reaches here without
  # apply, so after an upgrade the helper may not exist yet.
  [ -x "$BIN/acstack-popup" ] || write_helpers
  mkdir -p "$(dirname "$HERDR_CFG")"; touch "$HERDR_CFG"
  local mod wt diffkey dashkey filekey filetabkey difftabkey dashtabkey
  local pickkey picktabkey gitkey gittabkey dbkey dbtabkey scrollbars
  local theme themeauto themelight toast labels panelsort
  mod=$(cfg_get herdr.chord_modifier alt)
  wt=$(cfg_get herdr.worktrees_directory "~/.herdr/worktrees")
  # f, not d: Windows Terminal keeps alt+shift+d for "duplicate pane", so the
  # tab half of a d pair never reaches herdr. Both diff keys sit on f instead.
  diffkey=$(cfg_get diffnav.popup_key "alt+f")
  dashkey=$(cfg_get gh_dash.popup_key "alt+i")
  filekey=$(cfg_get yazi.popup_key "alt+y")
  filetabkey=$(cfg_get yazi.tab_key "alt+shift+y")
  difftabkey=$(cfg_get diffnav.tab_key "alt+shift+f")
  dashtabkey=$(cfg_get gh_dash.tab_key "alt+shift+i")
  pickkey=$(cfg_get diffnav.pick_key "alt+x")
  picktabkey=$(cfg_get diffnav.pick_tab_key "alt+shift+x")
  gitkey=$(cfg_get lazygit.popup_key "alt+g")
  gittabkey=$(cfg_get lazygit.tab_key "alt+shift+g")
  dbkey=$(cfg_get harlequin.popup_key "alt+q")
  dbtabkey=$(cfg_get harlequin.tab_key "alt+shift+q")
  # herdr counts the scrollbar column inside the pane rect but reports the
  # full rect width to the program running in the pane. A full-screen app then
  # writes one column more than it has, so every wrapped row starts a column
  # left of the row above it. Turning the scrollbar off gives the column back.
  scrollbars=$(cfg_get herdr.pane_scrollbars false)
  # Four settings that are not keys. Each one is empty by default and then
  # written only when the config names it, so a machine that says nothing
  # keeps whatever herdr already paints. The exception is the pane label,
  # which is written either way: several agents in several panes is what this
  # workspace is for, and an unlabelled pane does not say which agent it holds.
  theme=$(cfg_get herdr.theme.name "")
  themeauto=$(cfg_get herdr.theme.auto_switch true)
  themelight=$(cfg_get herdr.theme.light "")
  toast=$(cfg_get herdr.toast_delivery "")
  labels=$(cfg_get herdr.agent_labels_on_pane_borders true)
  panelsort=$(cfg_get herdr.agent_panel_sort "")
  [ "$(cfg_get diffnav.enabled true)" = "true" ] \
    || { diffkey=""; difftabkey=""; pickkey=""; picktabkey=""; }
  [ "$(cfg_get gh_dash.enabled true)" = "true" ] || { dashkey=""; dashtabkey=""; }
  [ "$(cfg_get yazi.enabled true)"    = "true" ] || { filekey=""; filetabkey=""; }
  [ "$(cfg_get lazygit.enabled true)" = "true" ] || { gitkey=""; gittabkey=""; }
  [ "$(cfg_get harlequin.enabled true)" = "true" ] || { dbkey=""; dbtabkey=""; }

  ACSTACK_ARGS="$mod|$wt|$diffkey|$dashkey|$filekey|$filetabkey|$difftabkey|$dashtabkey|$pickkey|$picktabkey|$gitkey|$gittabkey|$dbkey|$dbtabkey|$scrollbars|$theme|$themeauto|$themelight|$toast|$labels|$panelsort|$BEGIN|$END" ACSTACK_BIN="$BIN" py "$HERDR_CFG" <<'PY'
import os, re, sys
path = sys.argv[1]
# herdr runs a popup with its server's PATH, which can lack $BIN. Each popup
# goes through acstack-popup by absolute path, which puts $BIN back on PATH.
popup = os.path.join(os.environ["ACSTACK_BIN"], "acstack-popup")
(mod, wt, diffkey, dashkey, filekey, filetabkey, difftabkey, dashtabkey,
 pickkey, picktabkey, gitkey, gittabkey, dbkey, dbtabkey, scrollbars,
 theme, themeauto, themelight, toast, labels, panelsort,
 begin, end) = os.environ["ACSTACK_ARGS"].split("|")

# key, command, description, herdr custom-command type, popup size.
# type "shell" takes no size: herdr rejects width/height on a non-popup.
CUSTOM = [
    (diffkey,    "acstack-diff",                  "diff: branch vs dev", "popup", "90%"),
    (difftabkey, "acstack-herdr-tab diff acstack-diff", "diff: branch vs dev (tab)", "shell", None),
    (pickkey,    "acstack-diff pick",             "diff: pick what to compare", "popup", "90%"),
    (picktabkey, "acstack-herdr-tab diffpick acstack-diff pick",
                                                  "diff: pick what to compare (tab)", "shell", None),
    (dashkey,    "acstack-dash",                  "PR dashboard",       "popup", "95%"),
    (dashtabkey, "acstack-herdr-tab dash acstack-dash", "PR dashboard (tab)", "shell", None),
    (filekey,    "yazi",                          "file tree",          "popup", "95%"),
    (filetabkey, "acstack-herdr-tab yazi yazi",         "file tree (tab)",    "shell", None),
    (gitkey,     "lazygit",                       "git: stage, commit, push", "popup", "90%"),
    (gittabkey,  "acstack-herdr-tab lazygit lazygit",
                                                  "git: stage, commit, push (tab)", "shell", None),
    (dbkey,      "acstack-db",                    "db: harlequin SQL editor", "popup", "90%"),
    (dbtabkey,   "acstack-herdr-tab harlequin acstack-db",
                                                  "db: harlequin SQL editor (tab)", "shell", None),
]

def custom_blocks():
    out = []
    for key, cmd, desc, typ, size in CUSTOM:
        if not key:
            continue
        if typ == "popup":
            cmd = f"{popup} {cmd}"
        out += ["", "[[keys.command]]", f'key = "{key}"', f'type = "{typ}"',
                f'command = "{cmd}"', f'description = "{desc}"']
        if size:
            out += [f'width = "{size}"', f'height = "{size}"']
    return out
text = open(path).read() if os.path.isfile(path) else ""
# Drop any previous managed region so this is idempotent.
text = re.sub(re.escape(begin) + r".*?" + re.escape(end) + r"\n?", "", text, flags=re.S)

keys = []
if mod != "none":
    m = mod
    keys = [
        f'focus_agent = "{m}+1..9"',
        f'focus_pane_left  = ["prefix+h", "{m}+h"]',
        f'focus_pane_down  = ["prefix+j", "{m}+j"]',
        f'focus_pane_up    = ["prefix+k", "{m}+k"]',
        f'focus_pane_right = ["prefix+l", "{m}+l"]',
        f'next_agent = "{m}+n"',
        f'previous_agent = "{m}+u"',
        f'next_tab = ["prefix+n", "{m}+right"]',
        f'previous_tab = ["prefix+p", "{m}+left"]',
        f'next_workspace = ["{m}+down"]',
        f'previous_workspace = ["{m}+up"]',
        # herdr puts switch_tab on prefix+1..9 by default. Move it aside so
        # switch_workspace below can have the plain digits.
        f'switch_tab = "prefix+{m}+1..9"',
        f'toggle_sidebar = ["prefix+b", "{m}+s"]',
        # g belongs to git only when lazygit is on. alt+g is lazygit and
        # alt+shift+g is its tab, so goto moves off the letter on both layers:
        # prefix+g one key away from alt+g reads as the same thing. With
        # lazygit off, nothing wants the letter and goto keeps it.
        ('goto = "prefix+t"' if gitkey else f'goto = ["prefix+g", "{m}+g"]'),
        f'zoom = ["prefix+z", "{m}+z"]',
        f'last_pane = "{m}+a"',
        f'new_tab = ["prefix+c", "{m}+c"]',
        f'new_workspace = ["prefix+shift+n", "{m}+w"]',
        # Also off g, for the same reason, and back on it when lazygit is off.
        (f'new_worktree = "{m}+r"' if gitkey
         else f'new_worktree = ["prefix+shift+g", "{m}+r"]'),
        f'split_vertical = ["prefix+v", "{m}+e"]',
        f'split_horizontal = ["prefix+minus", "{m}+minus"]',
    ]

# herdr leaves switch_workspace unbound, so without this there is no way to
# reach a workspace by number at all. It is prefix-only, so it is written even
# when the chord family is off: opting out of alt chords should not cost you
# workspace numbers.
keys.append('switch_workspace = "prefix+1..9"')

# See the comment on `scrollbars` above for what the scrollbar column costs.
# The label is written either way; the sort order only when the config names
# one, because herdr's own default is a reasonable answer and this script has
# no better one.
ui = [
    "pane_scrollbars = " + ("true" if scrollbars == "true" else "false"),
    "show_agent_labels_on_pane_borders = " + ("true" if labels == "true" else "false"),
]
if panelsort:
    ui.append(f'agent_panel_sort = "{panelsort}"')

# A theme, and a toast. Both tables stay empty unless the config names a value,
# so a machine that says nothing about either keeps what herdr already does.
#
# auto_switch asks the attached client for its background colour over OSC 11
# and picks dark_name or light_name from the answer. That is the setting that
# lets one herdr server serve a dark terminal on one device and a light one on
# another - an e-ink panel among them - without either client changing the
# other. dark_name repeats `name` because a client that answers nothing at all
# falls back to dark.
themelines = []
if theme:
    themelines = [f'name = "{theme}"']
    if themelight:
        themelines += [
            "auto_switch = " + ("true" if themeauto == "true" else "false"),
            f'dark_name = "{theme}"',
            f'light_name = "{themelight}"',
        ]

toastlines = [f'delivery = "{toast}"'] if toast else []

# TOML forbids a duplicate key, so a hand-written keymap that already sets
# something this script manages would make the merged file unparseable and
# herdr would reject the lot. Drop our own keys from the user's [keys] table,
# and any [[keys.command]] bound to a key we are about to claim, before
# inserting. Anything we do not manage is left exactly as it was.
def names(lines):
    return {k.split("=", 1)[0].strip() for k in lines if "=" in k}


managed = names(keys)
# One set per table. An empty set strips nothing, so a table this run writes
# no value into leaves whatever the user wrote in it exactly as it was.
MANAGED_BY_TABLE = {"[keys]": managed, "[ui]": names(ui),
                    "[theme]": names(themelines), "[ui.toast]": names(toastlines)}
# A theme is one setting spelled across four keys, so it is claimed whole or
# not at all. Claiming only what gets written leaves a hand-written
# `auto_switch` and `light_name` beside the new `name`, and a light client then
# keeps the theme the user is replacing.
if themelines:
    MANAGED_BY_TABLE["[theme]"] = {"name", "auto_switch", "dark_name", "light_name"}
claimed = {key for key, *_ in CUSTOM if key}


def strip_managed(table, names):
    # Drop the settings this script manages, and the comment block that
    # introduced each one. Removing the setting alone strands its comment: the
    # user is left with a run of bare headings describing settings that are no
    # longer there, which reads as a broken config.
    #
    # A value can run over several lines, because every key here holds an array
    # and TOML lets one span as many lines as it likes. Dropping the first line
    # alone strands the rest as bare list items, which is invalid TOML - and
    # herdr answers that by rejecting the whole file, so one hand-written
    # binding written that way would cost the user every binding.
    out, pending, depth = [], [], 0
    for ln in table:
        if depth > 0:
            depth += ln.count("[") - ln.count("]")
            continue
        stripped = ln.strip()
        if stripped.startswith("#") or not stripped:
            pending.append(ln)
            continue
        if "=" in ln and ln.split("=", 1)[0].strip() in names:
            pending = []
            value = ln.split("=", 1)[1]
            depth = value.count("[") - value.count("]")
            continue
        out.extend(pending)
        pending = []
        out.append(ln)
    out.extend(pending)
    return out


# A table header on its own line, and nothing else. `line.startswith("[")` is
# not enough: a value spanning several lines puts its own list items at the
# start of a line, and `  [1, 2],` would then read as a new table.
HEADER = re.compile(r"^\s*\[\[?[^\[\]]*\]\]?\s*(?:#.*)?$")


def tables(lines):
    current, depth = [], 0
    for line in lines:
        if depth <= 0 and HEADER.match(line) and current:
            yield current
            current = []
        # Only outside a multi-line value, for the same reason.
        if not HEADER.match(line):
            depth += line.count("[") - line.count("]")
            depth = max(depth, 0)
        current.append(line)
    if current:
        yield current


kept = []
for table in tables(text.splitlines()):
    header = table[0].strip()
    # The managed block re-declares [worktrees] in full, and TOML forbids
    # declaring a table twice.
    if header == "[worktrees]":
        continue
    if header == "[[keys.command]]":
        bound = re.search(r'(?m)^\s*key\s*=\s*"([^"]+)"', "\n".join(table))
        if bound and bound.group(1) in claimed:
            continue
    if header in MANAGED_BY_TABLE:
        table = strip_managed(table, MANAGED_BY_TABLE[header])
    kept.extend(table)
text = "\n".join(kept)
if text and not text.endswith("\n"):
    text += "\n"

def merge(text, header, lines):
    # Merge into a table the user already declared rather than declaring a
    # second one, because TOML forbids declaring the same table twice. Returns
    # the text and whether the merge happened.
    # re.escape, because a sub-table header carries a dot: an unescaped
    # "ui.toast" matches "[ui-toast]" too.
    head = r"^\[" + re.escape(header) + r"\][ \t]*\n"
    if not re.search(head, text, flags=re.M):
        return text, False
    region = begin + "\n" + "\n".join(lines) + "\n" + end
    return re.sub(head, f"[{header}]\n" + region + "\n",
                  text, count=1, flags=re.M), True


block = []
for header, lines in (("keys", keys), ("ui", ui),
                      ("theme", themelines), ("ui.toast", toastlines)):
    if not lines:
        continue
    text, merged = merge(text, header, lines)
    if merged:
        continue
    if block:
        block.append("")
    block += [f"[{header}]"] + lines

# [[keys.command]] and [worktrees] are top-level, so they can never sit inside
# a merged region and always land in a block of their own at the end.
block += custom_blocks() + ["", "[worktrees]", f'directory = "{wt}"']
text = text.rstrip("\n") + "\n\n" + "\n".join([begin] + block + [end]) + "\n"

open(path, "w").write(text)
PY
  if herdr config check 2>&1 | grep -q "^config: ok"; then
    herdr server reload-config >/dev/null 2>&1
    say "herdr keymap applied and reloaded"
  else
    say "herdr config check failed, review $HERDR_CFG"
    herdr config check 2>&1 | sed 's/^/    /' | head -5
  fi

  local integ; integ=$(cfg_get herdr.integration none)
  if [ "$integ" != "none" ] && [ -n "$integ" ]; then
    herdr integration install "$integ" >/dev/null 2>&1 && say "herdr $integ state hook installed"
  fi
}
