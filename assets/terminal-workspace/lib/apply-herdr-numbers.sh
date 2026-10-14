apply_herdr_numbers() {
  have herdr || return 0
  [ "$(cfg_get herdr.renumber_plugin true)" = "true" ] || return 0

  local dir="$HOME/.config/acstack/herdr-numbers"
  mkdir -p "$dir"
  # An absolute command: herdr runs argv without a shell and resolves relative
  # commands from the plugin root, not from PATH.
  cat > "$dir/herdr-plugin.toml" <<H
id = "acstack.herdr-numbers"
name = "ACStack workspace numbers"
version = "1.0.0"
min_herdr_version = "0.8.0"
description = "Keep the sidebar numbers matching prefix+1..9"
platforms = ["linux", "macos", "windows"]

# Every event that can move a sidebar row. workspace.moved and
# workspace.reordered are deliberately absent: the realignment emits both, so
# hooking them would loop forever. The helper is idempotent, so the overlap
# between the workspace and worktree events costs nothing.
[[events]]
on = "workspace.created"
command = ["$BIN/acstack-herdr-renumber"]

[[events]]
on = "workspace.closed"
command = ["$BIN/acstack-herdr-renumber"]

[[events]]
on = "worktree.created"
command = ["$BIN/acstack-herdr-renumber"]

[[events]]
on = "worktree.opened"
command = ["$BIN/acstack-herdr-renumber"]

[[events]]
on = "worktree.removed"
command = ["$BIN/acstack-herdr-renumber"]
H

  if herdr plugin list 2>/dev/null | grep -q "acstack.herdr-numbers"; then
    say "herdr numbers plugin already linked"
  elif herdr plugin link "$dir" >/dev/null 2>&1; then
    say "herdr numbers plugin linked, sidebar numbers stay aligned"
  else
    say "herdr plugin link failed; run acstack-herdr-renumber by hand"
  fi
}
