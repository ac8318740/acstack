write_helpers() {
  mkdir -p "$BIN"
  # Helpers this script used to write and no longer does. Upgrading otherwise
  # leaves them on PATH, shadowing nothing but confusing everything.
  rm -f "$BIN"/acstack-files "$BIN"/acstack-files-tab \
        "$BIN"/acstack-yazi-tab "$BIN"/acstack-tab "$BIN"/acstack-renumber

  local src name
  for src in "$SCRIPT_DIR"/helpers/acstack-*; do
    [ -f "$src" ] || continue
    name=${src##*/}
    cp "$src" "$BIN/$name"
    chmod +x "$BIN/$name"
  done

  # The one helper with a path in the config. The source holds the default, so
  # this carries nothing but a value the user chose.
  ACSTACK_DB_CFG="$(cfg_get harlequin.config_path "~/.config/acstack/harlequin.toml")" \
    py "$BIN/acstack-db" <<'PY'
import os, re, sys
# A bash single-quoted literal, so a path with a space or a quote in it reaches
# the helper as one word rather than as shell syntax.
v = "'" + os.environ["ACSTACK_DB_CFG"].replace("'", "'\\''") + "'"
p = sys.argv[1]
t = open(p).read()
t, n = re.subn(r"(?m)^DB_CFG_DEFAULT=.*# acstack:config_path$",
               lambda m: "DB_CFG_DEFAULT=" + v + "  # acstack:config_path", t)
if n:
    open(p, "w").write(t)
PY

  say "helpers written: acstack-diff, acstack-dash, acstack-db, acstack-md, acstack-view"
  say "remote helpers written: acstack-clip, acstack-open, acstack-bridge"
  say "herdr helpers written: acstack-popup, acstack-herdr-tab, acstack-herdr-renumber, acstack-edit"
}
