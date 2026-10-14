have() { command -v "$1" >/dev/null 2>&1; }

require_yaml() {
  python3 -c 'import yaml' 2>/dev/null && return 0
  echo "PyYAML is required to read $CFG" >&2
  echo "Install it (pip install --user pyyaml) and run again. Refusing to" >&2
  echo "continue, because without it every setting falls back to a default" >&2
  echo "and your config is silently ignored." >&2
  exit 1
}

arch_supported() {
  case "$(uname -m)" in
    x86_64|amd64) return 0 ;;
    *) say "prebuilt binaries are x86_64 only, and this is $(uname -m)"
       say "install herdr, delta, diffnav, and lazygit yourself, then run apply again"
       return 1 ;;
  esac
}
say()  { printf '  %s\n' "$*"; }

py() { python3 - "$@"; }

# Reads one dotted path. require_yaml runs first, so a fallback here means
# the key is absent, never that yaml failed to import.
cfg_get() {  # cfg_get <dotted.path> <default>
  ACSTACK_CFG="$CFG" py "$1" "${2:-}" <<'PY'
import os, sys
import yaml
p = os.environ["ACSTACK_CFG"]
if not os.path.isfile(p):
    print(sys.argv[2]); raise SystemExit
d = yaml.safe_load(open(p)) or {}
for k in sys.argv[1].split("."):
    d = d.get(k) if isinstance(d, dict) else None
    if d is None: break
if isinstance(d, bool): d = "true" if d else "false"
print(d if d is not None else sys.argv[2])
PY
}

# neovim and pi write into a config the user built, so they start off. Every
# other component owns its files outright and starts on.
enabled_default() {  # enabled_default <component>
  case "$1" in neovim|pi) echo false ;; *) echo true ;; esac
}

# The example config that shipped beside this script. Both `outdated` and the
# stamp read it, so resolve it once.
EXAMPLE="$SCRIPT_DIR/config.example.yaml"
STAMP="$(dirname "$CFG")/terminal-workspace.applied"
# What the pi component changed, so disable undoes that and nothing else. A
# package or a setting the user already had is theirs, and stays.
PI_OWNED="$(dirname "$CFG")/terminal-workspace.pi.json"

# Reads a yaml list into one item per line. cfg_get prints a python list repr
# for a list value, which no caller can use.
cfg_get_list() {  # cfg_get_list <dotted.path> <space-separated default>
  ACSTACK_CFG="$CFG" py "$1" "${2:-}" <<'PY'
import os, sys
import yaml
p = os.environ["ACSTACK_CFG"]
d = (yaml.safe_load(open(p)) or {}) if os.path.isfile(p) else {}
for k in sys.argv[1].split("."):
    d = d.get(k) if isinstance(d, dict) else None
    if d is None: break
print("\n".join(str(x) for x in d) if isinstance(d, list) else sys.argv[2].replace(" ", "\n"))
PY
}

# What `apply` had to offer, recorded so a later run can tell what arrived
# since. Without it, a component added by an upgrade is invisible: cfg_get
# returns its default, apply installs it, and nobody is ever told it is there.
write_stamp() {
  [ -f "$EXAMPLE" ] || return 0
  mkdir -p "$(dirname "$STAMP")"
  { echo "# written by acstack terminal-workspace apply, do not edit"
    py "$EXAMPLE" <<'PY'
import sys
import yaml
for k in (yaml.safe_load(open(sys.argv[1])) or {}):
    print(k)
PY
  } > "$STAMP"
}

install_binary() {  # install_binary <name> <repo> <asset-match>
  local name="$1" repo="$2" match="$3"
  # `upgrade` reinstalls over a binary that is already here. `apply` never
  # does: it installs what is missing and leaves what is not.
  if [ "${INSTALL_FORCE:-0}" != "1" ] && have "$name"; then
    say "$name already installed"; return 0
  fi
  local url json
  # py reads its script from stdin, so the release JSON has to arrive by
  # environment rather than by pipe: a pipe here is silently swallowed by
  # the heredoc and python then reads an empty stdin.
  json=$(curl -sSf "https://api.github.com/repos/$repo/releases/latest" 2>/dev/null)
  [ -z "$json" ] && { say "$name: could not reach the GitHub release API"; return 1; }
  url=$(ACSTACK_JSON="$json" py "$match" <<'PY'
import json, os, sys
try:
    d = json.loads(os.environ["ACSTACK_JSON"])
except ValueError:
    raise SystemExit
for a in d.get("assets", []):
    # yazi publishes .zip only; delta and glow publish .tar.gz. Take either.
    if sys.argv[1] in a["name"] and a["name"].endswith((".tar.gz", ".tgz", ".zip")):
        print(a["browser_download_url"]); break
PY
)
  [ -z "$url" ] && { say "$name: no matching release asset, install manually"; return 1; }
  # Explicit cleanup rather than `trap ... RETURN`: a RETURN trap stays
  # registered for every later function return in this shell, where $tmp is
  # gone and `set -u` then aborts the run.
  local tmp found ar; tmp=$(mktemp -d)
  case "$url" in *.zip) ar="$tmp/a.zip" ;; *) ar="$tmp/a.tgz" ;; esac
  if ! curl -sL "$url" -o "$ar"; then
    rm -rf "$tmp"; say "$name: download failed"; return 1
  fi
  case "$ar" in
    *.zip) have unzip || { rm -rf "$tmp"; say "$name: needs unzip"; return 1; }
           unzip -qo "$ar" -d "$tmp" || { rm -rf "$tmp"; say "$name: unzip failed"; return 1; } ;;
    *)     tar xzf "$ar" -C "$tmp" || { rm -rf "$tmp"; say "$name: untar failed"; return 1; } ;;
  esac
  found=$(find "$tmp" -type f -name "$name" | head -1)
  if [ -z "$found" ]; then
    rm -rf "$tmp"; say "$name: binary not found in archive"; return 1
  fi
  mkdir -p "$BIN"; cp "$found" "$BIN/$name"; chmod +x "$BIN/$name"
  rm -rf "$tmp"
  say "$name installed to $BIN/$name"
}

install_plain_github_binary() {  # install_plain_github_binary <name> <repo> <asset-match>
  local name="$1" repo="$2" match="$3"
  if [ "${INSTALL_FORCE:-0}" != "1" ] && have "$name"; then
    say "$name already installed"; return 0
  fi
  local json url tmp
  json=$(curl -sSf "https://api.github.com/repos/$repo/releases/latest" 2>/dev/null)
  [ -z "$json" ] && { say "$name: could not reach the GitHub release API"; return 1; }
  url=$(ACSTACK_JSON="$json" py "$match" <<'PY'
import json, os, sys
try:
    d = json.loads(os.environ["ACSTACK_JSON"])
except ValueError:
    raise SystemExit
for a in d.get("assets", []):
    if sys.argv[1] in a["name"]:
        print(a["browser_download_url"]); break
PY
)
  [ -z "$url" ] && { say "$name: no matching release asset, install manually"; return 1; }
  tmp=$(mktemp)
  if ! curl -fsSL "$url" -o "$tmp"; then
    rm -f "$tmp"; say "$name: download failed"; return 1
  fi
  mkdir -p "$BIN"; cp "$tmp" "$BIN/$name"; chmod +x "$BIN/$name"
  rm -f "$tmp"
  say "$name installed to $BIN/$name"
}

install_npm_tool() {  # install_npm_tool <command> <package>
  local command="$1" package="$2"
  if have "$command"; then say "$command already installed"; return 0; fi
  have npm || { say "$command: npm not installed, skipping"; return 0; }
  if npm install -g "$package" >/dev/null 2>&1; then
    say "$command installed with npm"
  else
    say "$command install failed, run: npm install -g $package"
  fi
}

install_uv_tool() {  # install_uv_tool <command> <package>
  local command="$1" package="$2"
  if have "$command"; then say "$command already installed"; return 0; fi
  have uv || { say "$command: uv not installed, skipping"; return 0; }
  if uv tool install "$package" >/dev/null 2>&1; then
    say "$command installed with uv"
  else
    say "$command install failed, run: uv tool install $package"
  fi
}
