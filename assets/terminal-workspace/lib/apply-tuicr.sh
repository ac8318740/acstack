build_tuicr_fork() {
  # TEMPORARY path. Builds the two unmerged upstream pull requests the config
  # comments name. Once both land, set build_from_fork: false and this whole
  # function stops being reachable.
  # `have cargo` is not enough: a rustup shim on PATH with no default
  # toolchain installed exits non-zero on every invocation.
  if ! cargo --version >/dev/null 2>&1; then
    say "tuicr fork build needs a working cargo (see rustup.rs), skipping"
    cargo --version 2>&1 | head -2 | sed 's/^/    /'
    return 1
  fi
  have git   || { say "tuicr fork build needs git, skipping"; return 1; }
  local url branch dir
  url=$(cfg_get tuicr.fork "https://github.com/ac8318740/tuicr")
  branch=$(cfg_get tuicr.fork_branch "local/daily")
  dir="${ACSTACK_TUICR_SRC:-$HOME/tuicr}"
  if [ -d "$dir/.git" ]; then
    git -C "$dir" fetch --quiet --all 2>/dev/null
    git -C "$dir" checkout --quiet "$branch" 2>/dev/null || { say "tuicr: no branch $branch in $dir"; return 1; }
    git -C "$dir" pull --quiet --ff-only 2>/dev/null
  else
    git clone --quiet -b "$branch" "$url" "$dir" || { say "tuicr: clone failed"; return 1; }
  fi
  say "building tuicr from $branch (a few minutes on a cold cache)"
  local log; log=$(mktemp)
  if ! ( cd "$dir" && cargo build --release ) >"$log" 2>&1; then
    say "tuicr: build failed in $dir"
    # Swallowing cargo's output here made a missing toolchain look identical
    # to a compile error.
    grep -E '^(error|warning: unused)' "$log" | head -5 | sed 's/^/    /'
    tail -3 "$log" | sed 's/^/    /'
    rm -f "$log"; return 1
  fi
  rm -f "$log"
  mkdir -p "$BIN"
  # mv, not cp: cp fails with "Text file busy" when tuicr is running.
  cp "$dir/target/release/tuicr" "$BIN/tuicr.new" && mv -f "$BIN/tuicr.new" "$BIN/tuicr"
  say "tuicr built from $branch and installed to $BIN/tuicr"
}

apply_tuicr() {
  local from_fork; from_fork=$(cfg_get tuicr.build_from_fork false)
  if ! have tuicr; then
    if [ "$from_fork" = "true" ]; then
      build_tuicr_fork || return 0
    else
      install_binary tuicr agavra/tuicr x86_64-unknown-linux-gnu || return 0
    fi
  fi
  have tuicr || { say "tuicr not installed, skipping config"; return 0; }

  mkdir -p "$HOME/.config/tuicr"
  # show_file_line_stats and file_list_width only exist in the fork build.
  # Writing them against a stock release makes tuicr warn on every start.
  ACSTACK_ARGS="$from_fork|$(cfg_get tuicr.file_list_width 30)|$(cfg_get tuicr.show_file_line_stats true)|$(cfg_get tuicr.appearance "")|$BEGIN|$END" \
    py "$HOME/.config/tuicr/config.toml" <<'PY'
import os, re, sys
path = sys.argv[1]
from_fork, width, stats, appearance, begin, end = os.environ["ACSTACK_ARGS"].split("|")
text = open(path).read() if os.path.isfile(path) else ""
text = re.sub(re.escape(begin) + r".*?" + re.escape(end) + r"\n?", "", text, flags=re.S)

block = [begin]
managed = set()
if from_fork == "true":
    block += [
        "# These two keys exist only in the fork build. See the tuicr section",
        "# of ~/.config/acstack/terminal-workspace.yaml.",
        f"show_file_line_stats = {stats}",
        f"file_list_width = {width}",
        "# A local build must not be replaced by a stock release.",
        "no_update_check = true",
    ]
    managed |= {"show_file_line_stats", "file_list_width", "no_update_check"}
else:
    block += ["# Stock release: the fork-only keys are omitted so tuicr does not",
              "# warn about unknown config keys at startup."]
# `system` asks the terminal for its background colour over OSC 11. Under
# `herdr --remote` nothing answers, so tuicr falls back to a desktop setting
# that a headless machine reports as light, and paints dark text on a black
# terminal. Pinning the value sidesteps the whole detection path.
if appearance:
    block += ["# Pinned rather than detected. See the tuicr section of",
              "# ~/.config/acstack/terminal-workspace.yaml.",
              f'appearance = "{appearance}"']
    managed.add("appearance")
block.append(end)

# TOML forbids a duplicate key, so a value the user set by hand before this
# script managed it would make the merged file unparseable and tuicr would
# reject the lot. Drop only the keys this run writes, and the comment block
# that introduced each one: the setting alone leaves a heading over nothing.
kept, pending, cut = [], [], None
for ln in text.splitlines():
    stripped = ln.strip()
    if stripped.startswith("#") or not stripped:
        pending.append(ln)
        continue
    # Every key this script writes is top level, so the first table header ends
    # the search. A key of the same name inside a table is a different key.
    if cut is None and stripped.startswith("["):
        # Before the comments introducing that header, not after them.
        cut = len(kept)
    if cut is None and "=" in ln and ln.split("=", 1)[0].strip().strip('"') in managed:
        pending = []
        continue
    kept.extend(pending)
    pending = []
    kept.append(ln)
kept.extend(pending)

# The block holds top-level keys, so it goes above the first table header
# rather than at the end of the file. Appended after a `[export]` or
# `[forge]` section, every key in it would belong to that section instead:
# tuicr would warn about an unknown key there and never see the setting, and
# a name the section already uses makes the file invalid outright.
if cut is None:
    text = "\n".join(kept).rstrip("\n")
    text = (text + "\n\n" if text else "") + "\n".join(block) + "\n"
else:
    head = "\n".join(kept[:cut]).rstrip("\n")
    text = ((head + "\n\n" if head else "") + "\n".join(block) + "\n\n"
            + "\n".join(kept[cut:]).strip("\n") + "\n")
open(path, "w").write(text)
PY
  say "tuicr config written"
}

# The sidebar draws a workspace's position in herdr's stored list, but
# prefix+1..9 targets its row in the grouped sidebar. Creating or removing a
# worktree moves one and not the other, so the numbers you read stop being the
# numbers you press. This links a tiny herdr plugin that reruns the alignment
# on every event that can move a row, so it never needs remembering.
