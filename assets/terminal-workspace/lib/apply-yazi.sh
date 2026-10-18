apply_yazi() {
  [ "$(cfg_get yazi.enabled true)" = "true" ] || return 0
  if ! have yazi; then
    install_binary yazi sxyazi/yazi x86_64-unknown-linux-gnu || return 0
    install_binary ya   sxyazi/yazi x86_64-unknown-linux-gnu || true
  fi
  have yazi || { say "yazi not installed, skipping config"; return 0; }

  # piper turns any shell command into a previewer, which is how acstack-md
  # gets to draw markdown in the preview pane.
  if have ya && ! ya pkg list 2>/dev/null | grep -q "plugins:piper"; then
    ya pkg add yazi-rs/plugins:piper >/dev/null 2>&1 \
      && say "yazi piper plugin installed" \
      || say "piper install failed; markdown will preview as plain text"
  fi

  mkdir -p "$HOME/.config/yazi"
  ACSTACK_ARGS="$(cfg_get yazi.show_hidden true)|$BEGIN|$END" \
    py "$HOME/.config/yazi/yazi.toml" <<'PY'
import os, re, sys
path = sys.argv[1]
hidden, begin, end = os.environ["ACSTACK_ARGS"].split("|")
text = open(path).read() if os.path.isfile(path) else ""
# Drop any previous managed region, both to stay idempotent and so what is
# left to inspect below is exactly the config the user wrote.
text = re.sub(re.escape(begin) + r".*?" + re.escape(end) + r"\n?", "", text, flags=re.S)

# Every namespace the block writes into. TOML forbids declaring any of them
# twice, and yazi answers one duplicate by throwing the entire config away and
# falling back to presets. So a namespace the user already occupies is theirs:
# the block gives that piece up rather than cost them every other setting they
# have. Deciding which are taken is a question about the parsed document, not
# about the text: [ mgr ], [ "mgr" ], [ 'mgr' ] and mgr.show_hidden = false are
# all the same table, and only a parser knows that.
NAMESPACES = ("mgr", "opener.markdown", "plugin.prepend_previewers", "open.prepend_rules")

try:
    import tomllib
except ImportError:  # tomllib is 3.11 and newer
    tomllib = None


def claimed(cfg):
    """Which of NAMESPACES the user's own config already occupies."""
    if tomllib is None:
        # No parser to reason with, so read the text conservatively: name the
        # top-level table wherever TOML could open one, as a header or as a
        # key of its own. That concedes namespaces which would have been safe
        # to write, and each of those costs one setting; guessing the other
        # way costs the file. One thing text cannot see is that the config is
        # broken already, so unlike the parsed path below this branch does not
        # concede everything for a file that never parsed.
        found = set()
        for ns in NAMESPACES:
            root = re.escape(ns.split(".")[0])
            # A key may be bare, a basic string or a literal string, and all
            # three name the same table: [mgr], ["mgr"] and ['mgr'] are one.
            name = r"""(?:%s|"%s"|'%s')""" % (root, root, root)
            header = r'\[\[?\s*%s\s*[.\]]' % name
            key = r'%s\s*[.=]' % name
            if re.search(r"(?m)^\s*(?:%s|%s)" % (header, key), cfg):
                found.add(ns)
        return found
    try:
        tomllib.loads(cfg)
    except tomllib.TOMLDecodeError:
        # Their config does not parse as it stands. We cannot tell what it
        # claims, and repairing it is not ours to do, so concede everything:
        # the file ends up exactly as broken as it arrived, never more.
        return set(NAMESPACES)
    found = set()
    for ns in NAMESPACES:
        # Whether a namespace is free is not "is the key there". TOML also
        # refuses to reopen an inline table and to overwrite a scalar, so
        # opener = { text = [...] } and opener = "nope" both have no
        # opener.markdown key and are both fatal to write under. tomllib
        # hands an inline table back as an ordinary dict, so no walk over the
        # parsed document can tell those apart from a table that is still
        # open. Put the question to the parser instead, in the exact form the
        # block would write it: append that header to their config and see
        # whether the whole thing still parses. Whatever it refuses is theirs.
        probe = "[mgr]" if ns == "mgr" else "[[%s]]" % ns
        try:
            tomllib.loads(cfg + "\n" + probe + "\n")
        except tomllib.TOMLDecodeError:
            found.add(ns)
    return found


taken = claimed(text)
parts = []

if "plugin.prepend_previewers" not in taken:
    parts.append("""
[[plugin.prepend_previewers]]
url = "*.md"
run = 'piper -- COLUMNS=$w acstack-md --preview "$1"'

[[plugin.prepend_previewers]]
url = "*.markdown"
run = 'piper -- COLUMNS=$w acstack-md --preview "$1"'
""")

if "opener.markdown" not in taken:
    # An array of tables rather than a markdown key under [opener]: a second
    # [opener] table would be a duplicate, while a subtable of one the user
    # has already declared is legal.
    parts.append("""
# The preview pane is narrow, so a wide diagram shows its placeholder there.
# Enter opens the same renderer full width, where more of them fit.
#
# %s is what yazi substitutes for the files being opened, already quoted. Not
# "$@": an opener template is run as `sh -c '<run>'` with nothing after it, so
# $0 is "sh" and $@ is empty - measured on yazi 26.8.15, where "$@" left
# acstack-md with no file at all and Enter did nothing but print its usage.
[[opener.markdown]]
run = 'acstack-md %s'
block = true
desc = "Read (acstack-md)"

# Rendered markdown has no line number to quote back in a review, so the same
# file is also readable as its own source. Second, not first: it answers a
# narrower question than reading does, and still a readier one than editing.
# Enter takes the first entry, so O is the key that offers this one.
[[opener.markdown]]
run = 'acstack-md --numbered %s'
block = true
desc = "Read with line numbers"

[[opener.markdown]]
run = '${EDITOR:-vi} %s'
block = true
desc = "Edit"
""")

if "open.prepend_rules" not in taken:
    # Worth writing even when the opener above was skipped: the rules point
    # markdown files at whichever opener.markdown ends up in the file.
    parts.append("""
[[open.prepend_rules]]
url = "*.md"
use = "markdown"

[[open.prepend_rules]]
url = "*.markdown"
use = "markdown"
""")

if "mgr" not in taken:
    parts.append(f"[mgr]\nshow_hidden = {hidden}")

# The markers go down even when every piece was conceded, so the shell below
# can still read the region back and see what is missing from it.
block = begin + "\n" + "\n\n".join(p.strip("\n") for p in parts) + "\n" + end
text = text.rstrip("\n")
open(path, "w").write((text + "\n\n" if text else "") + block + "\n")
PY
  # A setting the block gave up to the user's own config is simply absent from
  # what was written, so read the region back rather than let it go unsaid.
  local written; written="$(sed -n "/$BEGIN/,/$END/p" "$HOME/.config/yazi/yazi.toml")"
  case "$written" in *"[[plugin.prepend_previewers]]"*) ;; *)
    say "yazi: your yazi.toml already sets plugin.prepend_previewers, so the"
    say "     markdown previewer was left alone. Add a *.md entry there to"
    say "     preview markdown with acstack-md." ;;
  esac
  case "$written" in *"[[opener.markdown]]"*) ;; *)
    say "yazi: your yazi.toml already opens markdown its own way, so it was left"
    say "     alone. Add acstack-md to that opener to read markdown with it." ;;
  esac
  case "$written" in *"[[open.prepend_rules]]"*) ;; *)
    say "yazi: your yazi.toml already sets open.prepend_rules, so the markdown"
    say "     rules were left alone. Add *.md and *.markdown entries there"
    say "     pointing at the markdown opener." ;;
  esac
  case "$written" in *show_hidden*) ;; *)
    say "yazi: your yazi.toml already claims mgr itself, so show_hidden was left"
    say "     alone. Set it there yourself to show hidden files." ;;
  esac
  # The keymap is its own file, and prepend_keymap has two spellings: an array
  # of tables, which is additive and safe to extend, and an inline array under
  # [mgr], which is one key that TOML forbids declaring twice. Only the second
  # collides with the entry below, and telling them apart takes the text - both
  # spellings parse to the same list.
  ACSTACK_ARGS="$(cfg_get yazi.browser_key "b")|$(cfg_get yazi.line_numbers_key "#")|$(cfg_get yazi.download_key "D")|$(cfg_get yazi.download_target "")|$(cfg_get yazi.edit_key "e")|$BEGIN|$END" \
    py "$HOME/.config/yazi/keymap.toml" <<'PY'
import os, re, sys

path = sys.argv[1]
key, numkey, dlkey, dltarget, editkey, begin, end = os.environ["ACSTACK_ARGS"].split("|")
text = open(path).read() if os.path.isfile(path) else ""
# Drop any previous managed region, both to stay idempotent and so what is
# left to inspect below is exactly the keymap the user wrote.
text = re.sub(re.escape(begin) + r".*?" + re.escape(end) + r"\n?", "", text, flags=re.S)

try:
    import tomllib
except ImportError:  # tomllib is 3.11 and newer
    tomllib = None


def claimed(t):
    """True when the user's keymap declares prepend_keymap as an inline array
    under [mgr] - the one spelling our own entry cannot sit beside."""
    if not re.search(r"^\s*prepend_keymap\s*=", t, flags=re.M):
        return False
    if tomllib is None:
        # No parser to say which table that assignment sits in, so assume the
        # worst. A conceded binding costs one key; a collision costs the whole
        # keymap, because yazi answers invalid TOML by falling back to presets.
        return True
    try:
        return "prepend_keymap" in (tomllib.loads(t).get("mgr") or {})
    except Exception:
        return True


CLAIMED = {k for k in (key, numkey, editkey) if k}
if dltarget and dlkey:
    CLAIMED.add(dlkey)


def drop_claimed(t):
    """Remove any prepend_keymap block the user wrote on a key this script is
    about to bind.

    yazi accepts both, lists both in its help, and runs one of them. So a
    binding written by hand before this script managed the key leaves two
    entries saying different things and no way to tell which one fires. Both
    table spellings, because `manager` is what yazi called `mgr` before the
    rename and an older keymap still says it.
    """
    out, block = [], None

    def bound_key(lines):
        """The single key this block binds, or None.

        yazi spells `on` four ways: a double-quoted scalar, a single-quoted
        one, a one-element array, and any of those with a trailing comment.
        Reading only the first spelling leaves the other three in place, which
        is the state this function exists to prevent. A longer array is a
        multi-key sequence and never collides with a single key.
        """
        body = "\n".join(lines[1:])
        if tomllib is not None:
            try:
                on = tomllib.loads(body).get("on")
            except Exception:
                on = ...  # unparseable, so fall through to the regex
            if on is not ...:
                if isinstance(on, str):
                    return on
                if isinstance(on, list) and len(on) == 1 and isinstance(on[0], str):
                    return on[0]
                return None
        m = re.search(r"""(?m)^\s*on\s*=\s*\[?\s*(?:"([^"]*)"|'([^']*)')""", body)
        return (m.group(1) if m.group(1) is not None else m.group(2)) if m else None

    def close():
        nonlocal block
        if block is None:
            return
        # Trailing blank lines belong to whatever comes next, not to the
        # binding, so they stay even when the binding goes.
        tail = []
        while block and not block[-1].strip():
            tail.insert(0, block.pop())
        if bound_key(block) not in CLAIMED:
            out.extend(block)
        out.extend(tail)
        block = None

    for ln in t.splitlines():
        if re.match(r"^\s*\[\[\s*(?:mgr|manager)\.prepend_keymap\s*\]\]\s*$", ln):
            close()
            block = [ln]
            continue
        if block is not None:
            # Any other table header ends this binding and belongs to what
            # follows, so it is never dropped with the block.
            if ln.lstrip().startswith("["):
                close()
                out.append(ln)
                continue
            block.append(ln)
            continue
        out.append(ln)
    close()
    return "\n".join(out)


def inspect_available(t):
    # Preserve custom bindings, including sequences beginning with i.
    if "i" in CLAIMED or tomllib is None:
        return False
    try:
        data = tomllib.loads(t)
    except ValueError:
        return False
    for section in ("mgr", "manager"):
        for name in ("prepend_keymap", "keymap", "append_keymap"):
            for binding in data.get(section, {}).get(name, []):
                on = binding.get("on", [])
                if on == "i" or isinstance(on, list) and on[:1] == ["i"]:
                    return False
    return True


parts = []
if not claimed(text):
    # A binding conceded below is one this script never writes, so the user's
    # own must survive. Only strip when the bindings are actually going in.
    inspect = inspect_available(text)
    text = drop_claimed(text)
    if inspect:
        parts.append(
            "[[mgr.prepend_keymap]]\n"
            'on = "i"\n'
            """run = 'shell --block -- case %h in *.[mM][dD]|*.[mM][aA][rR][kK][dD][oO][wW][nN]) frogmouth -- %h ;; esac'\n"""
            'desc = "Inspect Markdown in Frogmouth"'
        )
    # %h is the hovered file. $0 and $@ are not: yazi runs the template through
    # a shell, where $0 names the shell itself and $@ is empty - both measured,
    # and both would open the browser on nothing at all.
    #
    # %h stays bare, here and in every binding below. yazi shell-quotes it
    # itself, so quotes around it end up inside the path and nothing is found.
    #
    # --block because the delivery has something to say. On the bridge it is a
    # line of confirmation; on every other route it is a link, and a served
    # page that has to stay up. Detached, all of that goes nowhere.
    parts.append(
        "[[mgr.prepend_keymap]]\n"
        f'on = "{key}"\n'
        """run = 'shell --block -- acstack-md --browser %h'\n"""
        'desc = "Open in the browser you are sitting at"'
    )
    # Flipping the flag changes nothing a reader can see: the pane already
    # holds the view it drew before the key was pressed. So the binding is two
    # actions, and peek redraws it.
    #
    # --block, though the toggle has nothing to say. Detached, yazi spawns it
    # and runs peek immediately, and the pane is redrawn while the flag is
    # still whatever it was - a race the reader settles by pressing the key
    # twice. Blocking costs a frame and wins it outright.
    parts.append(
        "[[mgr.prepend_keymap]]\n"
        f'on = "{numkey}"\n'
        "run = [ 'shell --block -- acstack-md --toggle-line-numbers', 'peek --force' ]\n"
        'desc = "Preview markdown as source with line numbers"'
    )
    # `e` edits, everywhere. tuicr's diff and file tree both put the editor on
    # `e`, so yazi matching it means one key means edit across the workspace.
    # `o` is left alone: it opens by rule, which for markdown is the reader.
    #
    # ${EDITOR:-vi} rather than a fixed editor, the same expansion the opener
    # in yazi.toml uses, so both paths land in whatever the user actually runs.
    parts.append(
        "[[mgr.prepend_keymap]]\n"
        f'on = "{editkey}"\n'
        """run = 'shell --block -- ${EDITOR:-vi} %h'\n"""
        'desc = "Edit in $EDITOR"'
    )
    # Taildrop is Tailscale's file send. It is the one route off a headless
    # machine that needs nothing installed on the machine the user sits at,
    # and no inbound port there either.
    #
    # %h, the hovered file, for the same reason the browser key uses it. %* is
    # not a keybinding placeholder at all - yazi passes it through untouched,
    # and tailscale then reports `open %*: no such file or directory`.
    # Measured on yazi 26.8.15.
    #
    # --block because a send reports progress, and a refused one reports why.
    if dltarget:
        parts.append(
            "[[mgr.prepend_keymap]]\n"
            f'on = "{dlkey}"\n'
            f"""run = 'shell --block -- tailscale file cp %h {dltarget}:'\n"""
            f'desc = "Send this file to {dltarget} over Taildrop"'
        )

# The markers go down even when the binding was conceded, so the shell below
# can read the region back and see what is missing from it.
block = begin + "\n" + "\n\n".join(parts) + ("\n" if parts else "") + end
text = text.rstrip("\n")
open(path, "w").write((text + "\n\n" if text else "") + block + "\n")
PY
  local kmwritten; kmwritten="$(sed -n "/$BEGIN/,/$END/p" "$HOME/.config/yazi/keymap.toml")"
  case "$kmwritten" in *prepend_keymap*) ;; *)
    say "yazi: your keymap.toml already sets mgr.prepend_keymap as an inline"
    say "     array, which these bindings cannot sit beside. Add them there"
    say "     yourself:  shell --block -- acstack-md --browser %h"
    say "     and:       [ 'shell --block -- acstack-md --toggle-line-numbers', 'peek --force' ]"
    say "     and:       shell --block -- \${EDITOR:-vi} %h" ;;
  esac
  # The download key is written from the config alone, so it can be wrong in
  # three ways the config cannot see. Name whichever one holds, rather than
  # leaving the user to read `status code: 1` out of a yazi popup.
  local dltarget; dltarget="$(cfg_get yazi.download_target "")"
  if [ -n "$dltarget" ]; then
    if ! have tailscale; then
      say "yazi: download_target names $dltarget, but this machine has no"
      say "     tailscale. Install it, or clear the key to drop the binding."
    elif ! tailscale file cp --targets >/dev/null 2>&1; then
      say "yazi: tailscale refuses file access to this user account. Run once:"
      say "       sudo tailscale set --operator=\$USER"
    elif ! tailscale file cp --targets 2>/dev/null \
         | awk -F'\t' -v t="$dltarget" '$2 == t { f = 1 } END { exit !f }'; then
      say "yazi: $dltarget is not a Taildrop target of this machine. Taildrop"
      say "     only sends between devices one Tailscale account owns on one"
      say "     tailnet. Check both ends with: tailscale file cp --targets"
    fi
  fi
  say "yazi config written"
}
