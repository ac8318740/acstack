#!/usr/bin/env bash
# The terminal workspace's pi component: apply, status, outdated, upgrade,
# disable and uninstall, each against stubbed pi, npm and agentic-retro.
# Split from test-terminal-workspace.sh so pi work can run it alone.
#
# Run it:  bash tests/test-terminal-workspace-pi.sh
# Exit code is 0 when every check passes, 1 otherwise.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${SCRIPT_DIR}/.."
TW_DIR="${ROOT}/assets/terminal-workspace"
SETUP="${TW_DIR}/setup.sh"
TW_LIB="${TW_DIR}/lib"
DOCS="${ROOT}/docs/terminal-workspace.md"

for f in "$SETUP" "$DOCS"; do
  [ -f "$f" ] || { echo "FATAL: missing $f" >&2; exit 1; }
done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
# Every helper roots its files at $ACSTACK_HOME, so one set by the caller would
# point a test at the real machine-wide folder.
unset ACSTACK_HOME

pass=0
fail=0
skipped=0
ok() { printf '  \033[32mPASS\033[0m %s\n' "$1"; pass=$((pass + 1)); }
no() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; fail=$((fail + 1)); }
skip() { printf '  \033[33mSKIP\033[0m %s\n' "$1"; skipped=$((skipped + 1)); }
# One line of a captured run, for a failure message that has to stay on one.
flat() { printf '%s' "$1" | tr '\n' '|'; }

echo "the pi component sets pi up and undoes only what it added"
# Every call to pi, npm and agentic-retro lands on a stub, so nothing here
# reaches the network or the real ~/.pi. The pi stub keeps settings.json the
# way pi does: one entry per package, a new pin replacing the old one.
IWORK="$WORK/pi-run"
IHOME="$IWORK/home"
ISTUB="$IWORK/stub"
INPM="$IWORK/npm-global"
IAGENT="$IHOME/.pi/agent"
ISET="$IAGENT/settings.json"
ISUB="$IAGENT/extensions/subagent/config.json"
IMD="$IAGENT/AGENTS.md"
IRETRO="$IAGENT/extensions/agentic-retro.ts"
IBILLION="$IHOME/.config/billion-context/billion-context.json"
ILENS="$IHOME/.pi-lens/config.json"
ICFG="$IHOME/.acstack/terminal-workspace.yaml"
IVER=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' \
  "$ROOT/.claude-plugin/plugin.json")
mkdir -p "$ISTUB" "$INPM/bin" "$IHOME/.acstack" "$IAGENT"

cat > "$ISTUB/pi.installed" <<'PISTUB'
#!/usr/bin/env bash
echo "pi $*" >> "$HOME/pi.log"
S="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/settings.json"
case "$1" in
  --version) echo 1.1.0 ;;
  update) ;;
  install|remove)
    if [ "$1" = install ] && [ "$2" = npm:ac-teams ] && [ -e "$HOME/fail-teams-install" ]; then exit 1; fi
    python3 - "$S" "$1" "$2" <<'PY'
import json, os, sys
p, op, src = sys.argv[1:]
d = json.load(open(p)) if os.path.exists(p) else {}
def ident(s):
    at, slash = s.rfind("@"), s.rfind("/")
    return s[:at] if at > max(slash, 4) else s
pk = list(d.get("packages", []))
i = next((n for n, x in enumerate(pk) if ident(x) == ident(src)), None)
if op == "install":
    if i is None: pk.append(src)
    else: pk[i] = src
elif i is not None:
    del pk[i]
d["packages"] = pk
os.makedirs(os.path.dirname(p), exist_ok=True)
json.dump(d, open(p, "w"), indent=2)
PY
  ;;
esac
PISTUB
# npm installs pi into a global bin that is not on PATH, which is where a
# fresh shell finds it on a real machine too.
cat > "$ISTUB/npm" <<NPMSTUB
#!/usr/bin/env bash
echo "npm \$*" >> "\$HOME/npm.log"
case "\$1" in
  install)
    cp "$ISTUB/pi.installed" "$INPM/bin/pi"; chmod +x "$INPM/bin/pi"
    mkdir -p "$INPM/lib/node_modules/@earendil-works/pi-coding-agent/dist/bundle/chunks"
    cat > "$INPM/lib/node_modules/@earendil-works/pi-coding-agent/dist/bundle/chunks/chunk-test.js" <<'CHUNK'
function isKeyRelease(data){return data.includes("\x1B[200~")?!1:!!(data.includes(":3u")||data.includes(":3~")||data.includes(":3A")||data.includes(":3B")||data.includes(":3C")||data.includes(":3D")||data.includes(":3H")||data.includes(":3F"))}function parseModifyOtherKeysSequence(data){let match=data.match(/^\x1b\[27;(\d+);(\d+)~$/);if(!match)return null;let modValue=parseInt(match[1],10);return{codepoint:parseInt(match[2],10),modifier:modValue-1}}function parseKey(data){let kitty=parseKittySequence(data);return kitty}function decodeModifyOtherKeysPrintable(data){let parsed=parseModifyOtherKeysSequence(data);if(!(!parsed||(parsed.modifier&~LOCK_MASK&~MODIFIERS.shift)!==0)&&!(!Number.isFinite(parsed.codepoint)||parsed.codepoint<32))try{return String.fromCodePoint(parsed.codepoint)}catch{return}}function decodePrintableKey(data){return decodeKittyPrintable(data)??decodeModifyOtherKeysPrintable(data)}class E{handlePaste(pastedText){let decodedText=pastedText.replace(/\x1b\[(\d+);5u/g,(match,code)=>{let cp=Number(code);return cp>=97&&cp<=122?String.fromCharCode(cp-96):cp>=65&&cp<=90?String.fromCharCode(cp-64):match}),filteredText=this.normalizeText(decodedText).split("").filter(char=>char===\`
\`||char.charCodeAt(0)>=32).join("");}}
CHUNK
    ;;
  prefix)  echo "$INPM" ;;
  root)    echo "$INPM/lib/node_modules" ;;
esac
NPMSTUB
cat > "$ISTUB/claude" <<'CLAUDESTUB'
#!/usr/bin/env bash
echo "claude $*" >> "$HOME/claude.log"
case "${1:-}" in --version|version) echo "Claude Code 1.0.0" ;; esac
CLAUDESTUB
cat > "$ISTUB/codex" <<'CODEXSTUB'
#!/usr/bin/env bash
echo "codex $*" >> "$HOME/codex.log"
case "${1:-}" in --version|version) echo "codex 1.0.0" ;; esac
CODEXSTUB
cat > "$ISTUB/bili" <<'BILISTUB'
#!/usr/bin/env bash
echo "bili $*" >> "$HOME/bili.log"
if [ "${1:-}" = "plugin" ] && [ "${2:-}" = "list" ]; then
  printf 'agent     status\n'
  for client in pi claude codex; do
    if grep -qx "$client" "$HOME/bili-preinstalled" 2>/dev/null; then
      printf '%-9s installed\n' "$client"
    else
      printf '%-9s not installed\n' "$client"
    fi
  done
fi
BILISTUB
IRETROBIN="$IWORK/retro"; mkdir -p "$IRETROBIN"
cat > "$IRETROBIN/agentic-retro" <<'RSTUB'
#!/usr/bin/env bash
[ "$1" = "install-pi" ] || exit 1
mkdir -p "$HOME/.pi/agent/extensions"
echo "// agentic-retro" > "$HOME/.pi/agent/extensions/agentic-retro.ts"
RSTUB
chmod +x "$ISTUB"/* "$IRETROBIN"/*

pi_cfg() {  # pi_cfg <extra yaml for the pi block>
  cat > "$ICFG" <<ICFGEOF
enabled: true
herdr: {enabled: false}
gh_dash: {enabled: false}
diffnav: {enabled: false}
delta: {enabled: false}
tuicr: {enabled: false}
lazygit: {enabled: false}
harlequin: {enabled: false}
yazi: {enabled: false}
markdown: {enabled: false}
remote: {enabled: false}
neovim: {enabled: false}
pi:
  enabled: true
$1
ICFGEOF
}
# retro=1 puts agentic-retro on PATH, which is the default here.
iw() {
  local path="$ISTUB:/usr/bin:/bin"
  [ "${retro:-1}" = "1" ] && path="$IRETROBIN:$path"
  env HOME="$IHOME" PATH="$path" \
      ACSTACK_TW_BIN="$IHOME/.local/bin" \
      ACSTACK_TW_CONFIG="$ICFG" \
      GIT_CONFIG_GLOBAL="$IWORK/gitconfig" \
      ACSTACK_TW_OFFLINE=1 \
      bash "$SETUP" "$@" 2>&1
}
jget() {  # jget <file> <dotted.path> -> the value as JSON, or MISSING
  python3 - "$1" "$2" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except (OSError, ValueError):
    print("MISSING"); raise SystemExit
for k in sys.argv[2].split("."):
    if not isinstance(d, dict) or k not in d:
        print("MISSING"); raise SystemExit
    d = d[k]
print(json.dumps(d))
PY
}
jget_key() {  # jget_key <file> <literal-key> -> the value as JSON, or MISSING
  python3 - "$1" "$2" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except (OSError, ValueError):
    print("MISSING"); raise SystemExit
if not isinstance(d, dict) or sys.argv[2] not in d:
    print("MISSING"); raise SystemExit
print(json.dumps(d[sys.argv[2]]))
PY
}

PI_APPLY=1
case "$(uname -m)" in x86_64|amd64) ;; *) PI_APPLY=0 ;; esac
python3 -c 'import yaml' 2>/dev/null || PI_APPLY=0
if [ "$PI_APPLY" = "1" ]; then
  # A user who already runs pi: a device id and a theme of their own, a
  # subagent config with a key of its own, and instructions in AGENTS.md.
  printf '{\n  "deviceId": "dev-1",\n  "theme": "dark",\n  "note": "caf\xc3\xa9"\n}\n' > "$ISET"
  mkdir -p "$(dirname "$ISUB")"
  printf '{\n  "maxDepth": 2\n}\n' > "$ISUB"
  printf '# Mine\n\nAlways run the tests.\n' > "$IMD"
  USER_MD=$(cat "$IMD")
  pi_cfg ""
  out=$(iw apply)

  if grep -q '^npm install -g @earendil-works/pi-coding-agent' "$IHOME/npm.log" 2>/dev/null \
     && [ -x "$INPM/bin/pi" ]; then
    ok "apply installs pi with npm when it is missing"
  else
    no "apply installs pi with npm when it is missing (said: $(flat "$out"))"
  fi
  pkgs=$(jget "$ISET" packages)
  if printf '%s' "$pkgs" | grep -qF '"npm:ac-teams"' \
     && ! printf '%s' "$pkgs" | grep -qE 'pi-subagents|rpiv-todo' \
     && printf '%s' "$pkgs" | grep -qF "\"npm:acstack@$IVER\"" \
     && printf '%s' "$pkgs" | grep -qF '"npm:pi-compact-tools"' \
     && printf '%s' "$pkgs" | grep -qF '"npm:billion-context"' \
     && printf '%s' "$pkgs" | grep -qF '"npm:pi-plugin-manager"' \
     && printf '%s' "$pkgs" | grep -qF '"npm:pi-slash-anywhere"' \
     && printf '%s' "$pkgs" | grep -qF '"npm:pi-zentui"'; then
    ok "apply installs ac-teams, ACStack pinned to $IVER, pi-compact-tools, billion-context, pi-plugin-manager, pi-slash-anywhere and pi-zentui without retired packages"
  else
    no "apply installs ac-teams and supported packages without retired packages (packages: $pkgs)"
  fi
  if ! printf '%s' "$out" | grep -qE 'todo tool installed|pi-subagents|rpiv-todo'; then
    ok "apply does not recommend retired delegation or todo packages"
  else
    no "apply does not recommend retired delegation or todo packages (said: $(flat "$out"))"
  fi
  if grep -q '^pi .*billion-context' "$IHOME/pi.log" \
     && grep -q '^bili plugin install pi' "$IHOME/bili.log" 2>/dev/null \
     && ! grep -q '^bili plugin install claude' "$IHOME/bili.log" 2>/dev/null \
     && ! grep -q '^bili plugin install codex' "$IHOME/bili.log" 2>/dev/null; then
    ok "apply installs billion-context natively for pi only, not for Claude Code or Codex"
  else
    no "apply installs billion-context natively for pi only, not for Claude Code or Codex (pi: $(flat "$(cat "$IHOME/pi.log" 2>/dev/null)"); bili: $(flat "$(cat "$IHOME/bili.log" 2>/dev/null)"))"
  fi
  if [ "$(jget "$IBILLION" pi.subagents)" = "false" ]; then
    ok "apply disables billion-context acp_delegate for pi"
  else
    no "apply disables billion-context acp_delegate for pi ($(flat "$(cat "$IBILLION" 2>/dev/null)"))"
  fi
  if [ "$(jget "$ISET" hideThinkingBlock)" = "true" ] \
     && [ "$(jget "$ISET" markdown.mermaid)" = '"streaming"' ] \
     && [ "$(jget "$ISET" enableInstallTelemetry)" = "false" ] \
     && [ "$(jget "$ISET" theme)" = '"alex-mid-grey"' ]; then
    ok "apply writes the four personal settings into settings.json"
  else
    no "apply writes the four personal settings into settings.json ($(flat "$(cat "$ISET")"))"
  fi
  if [ "$(jget_key "$IAGENT/keybindings.json" app.message.dequeue)" = '"ctrl+enter"' ]; then
    ok "apply binds Pi queued-message restore to ctrl+enter"
  else
    no "apply binds Pi queued-message restore to ctrl+enter ($(flat "$(cat "$IAGENT/keybindings.json" 2>/dev/null)"))"
  fi
  if [ "$(jget "$IAGENT/themes/alex-mid-grey.json" name)" = '"alex-mid-grey"' ] \
     && [ "$(jget "$IAGENT/themes/alex-mid-grey.json" colors.userMessageBg)" = '"userPromptBg"' ] \
     && [ "$(jget "$IAGENT/zentui.json" components.footer.modelLabel)" = '"id"' ] \
     && [ "$(jget "$IAGENT/zentui.json" components.extensionStatuses.visibility.pi-lens)" = '"hide"' ] \
     && [ "$(jget "$ILENS" ui.hideLspStatus)" = "true" ] \
     && [ "$(jget "$ILENS" widget.visible)" = "false" ]; then
    ok "apply writes the quiet Zentui, theme and pi-lens UI config"
  else
    no "apply writes the quiet Zentui, theme and pi-lens UI config"
  fi
  if [ "$(jget "$ISET" deviceId)" = '"dev-1"' ] && grep -qF '"note": "café"' "$ISET" \
     && [ "$(jget "$ISUB" maxDepth)" = "2" ] && [ "$(jget "$ISUB" toolActivation)" = "MISSING" ]; then
    ok "the JSON merge keeps every key it does not claim, unescaped"
  else
    no "the JSON merge keeps every key it does not claim ($(flat "$(cat "$ISET" "$ISUB")"))"
  fi
  if [ "$(grep -c 'acstack terminal-workspace >>>' "$IMD")" = "1" ] \
     && grep -qF 'you may delegate to it' "$IMD" \
     && [ "$(head -3 "$IMD")" = "$USER_MD" ]; then
    ok "apply adds the delegation line to AGENTS.md below the user's own text"
  else
    no "apply adds the delegation line to AGENTS.md below the user's own text ($(flat "$(cat "$IMD")"))"
  fi
  if [ -f "$IRETRO" ] && printf '%s' "$out" | grep -q 'Run pi, then /login'; then
    ok "apply writes the agentic-retro extension and tells the user to log in"
  else
    no "apply writes the agentic-retro extension and tells the user to log in (said: $(flat "$out"))"
  fi
  ICHUNK="$INPM/lib/node_modules/@earendil-works/pi-coding-agent/dist/bundle/chunks/chunk-test.js"
  if grep -q 'parseWin32InputRecord' "$ICHUNK"      && grep -q 'decodeWin32Printable' "$ICHUNK"      && grep -q 'vk,sc,uc,kd' "$ICHUNK"; then
    ok "apply patches pi Win32 paste handling"
  else
    no "apply patches pi Win32 paste handling (said: $(flat "$out"), chunk: $(flat "$(cat "$ICHUNK" 2>/dev/null)"))"
  fi

  # Re-applying changes nothing: no install call, and every file byte for byte.
  before=$(cat "$ISET" "$ISUB" "$IMD" "$IAGENT/keybindings.json" "$IBILLION" "$IAGENT/zentui.json" "$ILENS" "$IAGENT/themes/alex-mid-grey.json")
  : > "$IHOME/pi.log"; : > "$IHOME/npm.log"; : > "$IHOME/bili.log"
  out=$(iw apply)
  if [ "$before" = "$(cat "$ISET" "$ISUB" "$IMD" "$IAGENT/keybindings.json" "$IBILLION" "$IAGENT/zentui.json" "$ILENS" "$IAGENT/themes/alex-mid-grey.json")" ] \
     && ! grep -q '^pi install' "$IHOME/pi.log" \
     && ! grep -q '^npm install' "$IHOME/npm.log" \
     && ! grep -q '^bili plugin install' "$IHOME/bili.log"; then
    ok "apply run twice installs nothing and changes no pi file"
  else
    no "apply run twice installs nothing and changes no pi file (pi: $(flat "$(cat "$IHOME/pi.log")"); bili: $(flat "$(cat "$IHOME/bili.log")"); said: $(flat "$out"))"
  fi

  out=$(iw status)
  if printf '%s' "$out" | grep -q 'pi: 1.1.0' \
     && printf '%s' "$out" | grep -qF "pi package: npm:acstack@$IVER" \
     && printf '%s' "$out" | grep -qF 'pi package: npm:billion-context' \
     && printf '%s' "$out" | grep -qF 'pi package: npm:ac-teams' \
     && ! printf '%s' "$out" | grep -qE 'pi-subagents|rpiv-todo|toolActivation' \
     && printf '%s' "$out" | grep -qF 'pi package: npm:pi-plugin-manager' \
     && printf '%s' "$out" | grep -qF 'pi package: npm:pi-slash-anywhere' \
     && printf '%s' "$out" | grep -qF 'pi package: npm:pi-zentui' \
     && printf '%s' "$out" | grep -q 'pi delegation line: present' \
     && printf '%s' "$out" | grep -q 'pi login: not logged in'; then
    ok "status reports pi's version, ac-teams and other packages, delegation line and login without retired packages"
  else
    no "status reports pi's version, ac-teams and other packages, delegation line and login without retired packages (said: $(flat "$out"))"
  fi
  : > "$IAGENT/auth.json"
  out=$(iw status)
  if printf '%s' "$out" | grep -q 'pi login: logged in'; then
    ok "status reports a login once auth.json exists"
  else
    no "status reports a login once auth.json exists (said: $(flat "$out"))"
  fi
  rm -f "$IAGENT/auth.json"

  # A setting set to empty is released, which puts back the user's own theme,
  # and a sub-toggle turned off removes the
  # package it had installed.
  pi_cfg "  compact_tools: false
  settings: {theme: \"\"}"
  out=$(iw apply)
  if [ "$(jget "$ISET" theme)" = '"dark"' ] \
     && ! jget "$ISET" packages | grep -qF 'pi-compact-tools' \
     && grep -q '^pi remove npm:pi-compact-tools' "$IHOME/pi.log"; then
    ok "turning a setting or compact_tools off releases what apply had added"
  else
    no "turning a setting or compact_tools off releases what apply had added (said: $(flat "$out"))"
  fi
  pi_cfg ""
  iw apply >/dev/null

  pi_cfg "  lens: true"
  out=$(iw apply)
  if jget "$ISET" packages | grep -qF '"npm:pi-lens"' \
     && iw status | grep -qF 'pi package: npm:pi-lens'; then
    ok "pi.lens installs and status reports pi-lens"
  else
    no "pi.lens installs and status reports pi-lens (said: $(flat "$out"); packages: $(jget "$ISET" packages))"
  fi
  pi_cfg "  lens: false"
  out=$(iw apply)
  if ! jget "$ISET" packages | grep -qF 'pi-lens' \
     && grep -q '^pi remove npm:pi-lens' "$IHOME/pi.log"; then
    ok "turning pi.lens off removes pi-lens when apply installed it"
  else
    no "turning pi.lens off removes pi-lens when apply installed it (said: $(flat "$out"); packages: $(jget "$ISET" packages); pi: $(flat "$(cat "$IHOME/pi.log")"))"
  fi
  pi_cfg ""
  iw apply >/dev/null

  # disable takes back what apply added and nothing else.
  : > "$IHOME/pi.log"; : > "$IHOME/bili.log"
  out=$(iw disable pi)
  if [ "$(jget "$ISET" deviceId)" = '"dev-1"' ] && grep -qF '"note": "café"' "$ISET" \
     && [ "$(jget "$ISET" hideThinkingBlock)" = "MISSING" ] \
     && [ "$(jget "$ISET" markdown)" = "MISSING" ] \
     && [ "$(jget "$ISET" theme)" = '"dark"' ] \
     && [ "$(jget_key "$IAGENT/keybindings.json" app.message.dequeue)" = "MISSING" ] \
     && [ "$(jget "$ISUB" toolActivation)" = "MISSING" ] && [ "$(jget "$ISUB" maxDepth)" = "2" ] \
     && [ "$(cat "$IMD")" = "$USER_MD" ] && [ ! -e "$IRETRO" ] && [ ! -e "$IBILLION" ] \
     && [ "$(jget "$ISET" packages)" = "[]" ] \
     && [ ! -e "$IAGENT/themes/alex-mid-grey.json" ] \
     && [ "$(jget "$IAGENT/zentui.json" components.footer.modelLabel)" = "MISSING" ] \
     && [ "$(jget "$ILENS" ui.hideLspStatus)" = "MISSING" ] \
     && [ -x "$INPM/bin/pi" ] \
     && grep -Eq '^pi (remove|uninstall|disable).*billion-context|^pi .*billion-context.*(remove|uninstall|disable)' "$IHOME/pi.log" \
     && grep -q '^pi remove npm:ac-teams' "$IHOME/pi.log" \
     && grep -Eq '^pi (remove|uninstall|disable).*pi-plugin-manager|^pi .*pi-plugin-manager.*(remove|uninstall|disable)' "$IHOME/pi.log" \
     && grep -Eq '^pi (remove|uninstall|disable).*pi-slash-anywhere|^pi .*pi-slash-anywhere.*(remove|uninstall|disable)' "$IHOME/pi.log" \
     && grep -Eq '^pi (remove|uninstall|disable).*pi-zentui|^pi .*pi-zentui.*(remove|uninstall|disable)' "$IHOME/pi.log" \
     && grep -q '^bili plugin remove pi' "$IHOME/bili.log" \
     && printf '%s' "$out" | grep -qF 'pi.enabled: false'; then
    ok "disable pi removes its packages, keys, block, extension and billion-context client installs, and keeps the user's own"
  else
    no "disable pi removes its packages, keys, block, extension and billion-context client installs, and keeps the user's own (said: $(flat "$out"); settings: $(flat "$(cat "$ISET")"); pi: $(flat "$(cat "$IHOME/pi.log" 2>/dev/null)"); bili: $(flat "$(cat "$IHOME/bili.log" 2>/dev/null)"))"
  fi

  printf '{"pi": true}\n' > "$IBILLION"
  : > "$IHOME/pi.log"; : > "$IHOME/bili.log"
  out=$(iw apply)
  if ! grep -q '^bili plugin install pi' "$IHOME/bili.log" \
     && ! jget "$ISET" packages | grep -qF 'billion-context' \
     && printf '%s' "$out" | grep -qF 'acp_delegate could not be disabled'; then
    ok "apply skips billion-context when its acp_delegate setting cannot be written"
  else
    no "apply skips billion-context when its acp_delegate setting cannot be written (said: $(flat "$out"); packages: $(jget "$ISET" packages); bili: $(flat "$(cat "$IHOME/bili.log")"))"
  fi
  iw disable pi >/dev/null

  # Older setup-owned tools retire only once their replacement is available.
  for replacement in failed installed; do
    printf '{"packages": ["npm:pi-subagents", "npm:@juicesharp/rpiv-todo"]}\n' > "$ISET"
    printf '{"toolActivation": "eager", "maxDepth": 2}\n' > "$ISUB"
    printf '{"packages": ["npm:pi-subagents", "npm:@juicesharp/rpiv-todo"], "subagent": {"toolActivation": "eager"}, "subagent_prior": {"toolActivation": "dynamic"}}\n' > "$IHOME/.acstack/terminal-workspace.pi.json"
    [ "$replacement" = failed ] && touch "$IHOME/fail-teams-install"
    iw apply >/dev/null
    pkgs=$(jget "$ISET" packages)
    if [ "$replacement" = failed ]; then
      if printf '%s' "$pkgs" | grep -qF '"npm:pi-subagents"' \
         && printf '%s' "$pkgs" | grep -qF '"npm:@juicesharp/rpiv-todo"' \
         && ! printf '%s' "$pkgs" | grep -qF '"npm:ac-teams"' \
         && [ "$(jget "$ISUB" toolActivation)" = '"eager"' ]; then
        ok "failed ac-teams installation preserves previous delegation and todo tools"
      else
        no "failed ac-teams installation preserves previous delegation and todo tools (packages: $pkgs)"
      fi
    elif printf '%s' "$pkgs" | grep -qF '"npm:ac-teams"' \
         && ! printf '%s' "$pkgs" | grep -qE 'pi-subagents|rpiv-todo' \
         && [ "$(jget "$ISUB" toolActivation)" = '"dynamic"' ] \
         && [ "$(jget "$ISUB" maxDepth)" = 2 ]; then
      ok "ac-teams replaces setup-owned tools and restores prior delegation config"
    else
      no "ac-teams replaces setup-owned tools and restores prior delegation config (packages: $pkgs)"
    fi
    rm -f "$IHOME/fail-teams-install"
    iw disable pi >/dev/null
  done

  # What the user had before apply stays theirs: their pi-subagents, their
  # rpiv-todo, their plugin manager, their slash-anywhere package, their older
  # ACStack pin (moved forward, then put back), and their extension.
  printf '{\n  "packages": ["npm:pi-subagents", "npm:@juicesharp/rpiv-todo", "npm:pi-plugin-manager", "npm:pi-slash-anywhere", "npm:acstack@0.1.0"]\n}\n' > "$ISET"
  mkdir -p "$(dirname "$IBILLION")"
  printf '{\n  "pi": {"subagents": true},\n  "keep": 1\n}\n' > "$IBILLION"
  echo "// mine" > "$IRETRO"
  out=$(iw apply)
  if jget "$ISET" packages | grep -qF "acstack@$IVER" && ! jget "$ISET" packages | grep -qF '0.1.0'; then
    ok "apply moves an older ACStack pin forward to $IVER"
  else
    no "apply moves an older ACStack pin forward to $IVER (packages: $(jget "$ISET" packages))"
  fi
  if [ "$(jget "$IBILLION" pi.subagents)" = "false" ] && [ "$(jget "$IBILLION" keep)" = "1" ]; then
    ok "apply preserves billion-context config while disabling pi subagents"
  else
    no "apply preserves billion-context config while disabling pi subagents ($(flat "$(cat "$IBILLION")"))"
  fi
  iw uninstall >/dev/null
  pkgs=$(jget "$ISET" packages)
  if printf '%s' "$pkgs" | grep -qF '"npm:pi-subagents"' \
     && printf '%s' "$pkgs" | grep -qF '"npm:@juicesharp/rpiv-todo"' \
     && printf '%s' "$pkgs" | grep -qF '"npm:pi-plugin-manager"' \
     && printf '%s' "$pkgs" | grep -qF '"npm:pi-slash-anywhere"' \
     && printf '%s' "$pkgs" | grep -qF '"npm:acstack@0.1.0"' \
     && ! printf '%s' "$pkgs" | grep -qF 'pi-compact-tools' \
     && [ -f "$IRETRO" ] && [ -x "$INPM/bin/pi" ] \
     && [ "$(jget "$IBILLION" pi.subagents)" = "true" ] && [ "$(jget "$IBILLION" keep)" = "1" ] \
     && [ ! -e "$IHOME/.acstack/terminal-workspace.pi.json" ]; then
    ok "uninstall leaves pi, and every package and file the user had before apply"
  else
    no "uninstall leaves pi, and every package and file the user had before apply (packages: $pkgs; billion: $(flat "$(cat "$IBILLION" 2>/dev/null)"))"
  fi

  printf 'pi\nclaude\ncodex\n' > "$IHOME/bili-preinstalled"
  printf '{}\n' > "$ISET"
  : > "$IHOME/bili.log"
  iw apply >/dev/null
  iw uninstall >/dev/null
  if ! grep -q '^bili plugin install' "$IHOME/bili.log" \
     && ! grep -q '^bili plugin remove' "$IHOME/bili.log" \
     && [ ! -e "$IHOME/.acstack/terminal-workspace.pi.json" ]; then
    ok "apply and uninstall leave pre-existing billion-context client plugins alone"
  else
    no "apply and uninstall leave pre-existing billion-context client plugins alone (bili: $(flat "$(cat "$IHOME/bili.log")"))"
  fi
  rm -f "$IHOME/bili-preinstalled"

  # An older setup enabled bili for Claude Code and Codex. apply now undoes it.
  printf '{}\n' > "$ISET"
  mkdir -p "$IHOME/.acstack"
  printf '{"files": ["bili:claude", "bili:codex"]}\n' > "$IHOME/.acstack/terminal-workspace.pi.json"
  : > "$IHOME/bili.log"
  iw apply >/dev/null
  if grep -q '^bili plugin remove claude' "$IHOME/bili.log" \
     && grep -q '^bili plugin remove codex' "$IHOME/bili.log" \
     && ! grep -q '^bili plugin install claude\|^bili plugin install codex' "$IHOME/bili.log"; then
    ok "apply removes billion-context from Claude Code and Codex when an older setup enabled it"
  else
    no "apply removes billion-context from Claude Code and Codex when an older setup enabled it (bili: $(flat "$(cat "$IHOME/bili.log")"))"
  fi
  iw uninstall >/dev/null

  # A newer pin than this plugin is one the user chose, and stays.
  printf '{\n  "packages": ["npm:acstack@999.0.0"]\n}\n' > "$ISET"
  iw apply >/dev/null
  if jget "$ISET" packages | grep -qF '999.0.0'; then
    ok "apply never moves a newer ACStack pin back"
  else
    no "apply never moves a newer ACStack pin back (packages: $(jget "$ISET" packages))"
  fi
  iw disable pi >/dev/null

  # PR #331: the old git install source is not one apply owns. Keep it in
  # settings.json, and tell the user the exact command that removes it.
  old_git='git:github.com/ac8318740/spechub@v0.42.0'
  printf '{\n  "packages": ["%s"]\n}\n' "$old_git" > "$ISET"
  : > "$IHOME/pi.log"
  out=$(iw apply)
  pkgs=$(jget "$ISET" packages)
  if printf '%s' "$pkgs" | grep -qF "\"$old_git\"" \
     && ! grep -q "^pi remove $old_git" "$IHOME/pi.log" \
     && printf '%s' "$out" | grep -qF "run: pi remove $old_git"; then
    ok "apply warns about the old ACStack git pi package without removing it"
  else
    no "apply warns about the old ACStack git pi package without removing it (said: $(flat "$out"); packages: $pkgs; pi: $(flat "$(cat "$IHOME/pi.log")"))"
  fi
  iw disable pi >/dev/null

  # A settings.json pi cannot parse concedes the whole component: pi rewrites
  # that file on install, so even one install call puts the user's file at risk.
  printf '{}\n' > "$ISET"
  rm -f "$IBILLION"
  iw apply >/dev/null
  printf '{ "theme": "dark", oops }\n' > "$ISET"
  : > "$IHOME/pi.log"
  out=$(iw apply)
  if [ "$(cat "$ISET")" = '{ "theme": "dark", oops }' ] \
     && ! grep -q '^pi install' "$IHOME/pi.log" \
     && printf '%s' "$out" | grep -qF "$ISET does not parse"; then
    ok "apply leaves an unparseable settings.json alone, installs nothing, and names the file"
  else
    no "apply leaves an unparseable settings.json alone, installs nothing, and names the file (said: $(flat "$out"))"
  fi
  out=$(iw disable pi); rc=$?
  if [ "$(cat "$ISET")" = '{ "theme": "dark", oops }' ] \
     && [ ! -e "$IBILLION" ] \
     && printf '%s' "$out" | grep -qF 'does not parse'; then
    ok "disable pi leaves an unparseable settings.json alone, releases billion-context config, and says so"
  else
    no "disable pi leaves an unparseable settings.json alone, releases billion-context config, and says so (rc=$rc, said: $(flat "$out"); billion: $(flat "$(cat "$IBILLION" 2>/dev/null)"))"
  fi

  # A broken subagent config concedes that one key. Everything else applies.
  rm -f "$ISET"
  printf 'not json\n' > "$ISUB"
  out=$(iw apply)
  if [ "$(cat "$ISUB")" = "not json" ] \
     && printf '%s' "$out" | grep -qF "$ISUB does not parse" \
     && [ "$(jget "$ISET" hideThinkingBlock)" = "true" ]; then
    ok "an unparseable subagent config is left alone while the rest of pi applies"
  else
    no "an unparseable subagent config is left alone while the rest of pi applies (said: $(flat "$out"))"
  fi
  iw disable pi >/dev/null
  rm -f "$ISUB"

  # Without agentic-retro on PATH, the extension is skipped and the user told
  # what to install. ACStack itself does not need it.
  rm -f "$IRETRO"
  out=$(retro=0 iw apply)
  if [ ! -e "$IRETRO" ] && printf '%s' "$out" | grep -q 'install the agentic-retro plugin first' \
     && jget "$ISET" packages | grep -qF "acstack@$IVER"; then
    ok "apply skips the agentic-retro extension when agentic-retro is not on PATH, and says why"
  else
    no "apply skips the agentic-retro extension when agentic-retro is not on PATH, and says why (said: $(flat "$out"))"
  fi

  # outdated reports an ACStack pin behind this plugin with no network at all,
  # and upgrade moves it.
  printf '{\n  "packages": ["npm:acstack@0.1.0"]\n}\n' > "$ISET"
  iw apply >/dev/null   # writes the stamp; leaves the pin, which is now owned by nobody
  printf '{\n  "packages": ["npm:acstack@0.1.0"]\n}\n' > "$ISET"
  out=$(iw outdated); rc=$?
  if [ "$rc" = "1" ] && printf '%s' "$out" | grep -qF "stale	pi-acstack	0.1.0 -> $IVER"; then
    ok "outdated reports an ACStack pin on pi that is behind this plugin"
  else
    no "outdated reports an ACStack pin on pi that is behind this plugin (rc=$rc, said: $(flat "$out"))"
  fi
  iw upgrade >/dev/null
  if jget "$ISET" packages | grep -qF "acstack@$IVER"; then
    ok "upgrade moves a stale ACStack pin on pi forward"
  else
    no "upgrade moves a stale ACStack pin on pi forward (packages: $(jget "$ISET" packages))"
  fi

  # A value the user had before apply goes back on disable, not away. Their
  # own legacy toolActivation stays untouched throughout.
  iw disable pi >/dev/null
  printf '{\n  "theme": "dark",\n  "markdown": {"mermaid": "final"}\n}\n' > "$ISET"
  printf '{\n  "toolActivation": "dynamic"\n}\n' > "$ISUB"
  printf '{\n  "app.message.dequeue": "ctrl+r"\n}\n' > "$IAGENT/keybindings.json"
  iw apply >/dev/null
  mid="$(jget "$ISET" theme) $(jget "$ISET" markdown.mermaid) $(jget "$ISUB" toolActivation) $(jget_key "$IAGENT/keybindings.json" app.message.dequeue)"
  iw disable pi >/dev/null
  after="$(jget "$ISET" theme) $(jget "$ISET" markdown.mermaid) $(jget "$ISUB" toolActivation) $(jget_key "$IAGENT/keybindings.json" app.message.dequeue)"
  if [ "$mid" = '"alex-mid-grey" "streaming" "dynamic" "ctrl+enter"' ] && [ "$after" = '"dark" "final" "dynamic" "ctrl+r"' ]; then
    ok "disable restores settings and keybindings while leaving legacy delegation config alone"
  else
    no "disable puts back the values apply replaced (after apply: $mid; after disable: $after)"
  fi

  # A value the user changed after apply is theirs, and disable leaves it.
  iw apply >/dev/null
  python3 - "$ISET" <<'PY'
import json, sys
d = json.load(open(sys.argv[1])); d["theme"] = "light"; json.dump(d, open(sys.argv[1], "w"))
PY
  iw disable pi >/dev/null
  if [ "$(jget "$ISET" theme)" = '"light"' ]; then
    ok "disable leaves a value the user changed after apply"
  else
    no "disable leaves a value the user changed after apply (theme: $(jget "$ISET" theme))"
  fi

  # The user deleting a whole object apply wrote into leaves nothing to
  # release, and the record of it must not outlive disable.
  printf '{}\n' > "$ISET"; rm -f "$ISUB"
  iw apply >/dev/null
  python3 - "$ISET" <<'PY'
import json, sys
d = json.load(open(sys.argv[1])); d.pop("markdown"); json.dump(d, open(sys.argv[1], "w"))
PY
  iw disable pi >/dev/null
  if [ ! -e "$IHOME/.acstack/terminal-workspace.pi.json" ]; then
    ok "disable forgets a key whose parent object the user deleted"
  else
    no "disable forgets a key whose parent object the user deleted ($(flat "$(cat "$IHOME/.acstack/terminal-workspace.pi.json")"))"
  fi

  # YAML reads a bare off as false. pi wants the string, and a value pi does
  # not accept is left out rather than written.
  printf '{}\n' > "$ISET"
  pi_cfg "  settings: {mermaid: off, hide_thinking_block: \"yes\"}"
  out=$(iw apply)
  if [ "$(jget "$ISET" markdown.mermaid)" = '"off"' ] \
     && [ "$(jget "$ISET" hideThinkingBlock)" = "MISSING" ] \
     && printf '%s' "$out" | grep -q 'settings.hide_thinking_block cannot be'; then
    ok "a bare off writes the string pi expects, and a wrong type is left alone and named"
  else
    no "a bare off writes the string pi expects, and a wrong type is left alone and named ($(flat "$(cat "$ISET")"); said: $(flat "$out"))"
  fi
  pi_cfg "  settings: {mermaid: true}"
  out=$(iw apply)
  if [ "$(jget "$ISET" markdown.mermaid)" = '"off"' ] && printf '%s' "$out" | grep -q 'settings.mermaid cannot be'; then
    ok "a mermaid value pi does not accept is left alone and named"
  else
    no "a mermaid value pi does not accept is left alone and named ($(flat "$(cat "$ISET")"); said: $(flat "$out"))"
  fi
  pi_cfg ""
  iw disable pi >/dev/null

  # An AGENTS.md with no final newline comes back exactly as it was.
  printf '# Mine\nno newline at the end' > "$IMD"
  iw apply >/dev/null
  iw disable pi >/dev/null
  if [ "$(od -c "$IMD")" = "$(printf '# Mine\nno newline at the end' | od -c)" ]; then
    ok "disable hands back an AGENTS.md with no final newline byte for byte"
  else
    no "disable hands back an AGENTS.md with no final newline byte for byte (got: $(flat "$(od -c "$IMD")"))"
  fi
  printf '%s\n' "$USER_MD" > "$IMD"

  # A pinned npm package never moves under pi update, so it is no finding and
  # upgrade leaves it. billion-context, pi-plugin-manager,
  # pi-lens and pi-slash-anywhere are covered here too, because they are pi
  # npm packages with the same version, outdated and upgrade behaviour.
  printf '{\n  "packages": ["npm:ac-teams@1.0.0", "npm:billion-context@1.0.0", "npm:pi-plugin-manager@1.0.0", "npm:pi-lens@1.0.0", "npm:pi-slash-anywhere@1.0.0"]\n}\n' > "$ISET"
  mkdir -p "$IAGENT/npm/node_modules/ac-teams" "$IAGENT/npm/node_modules/billion-context" \
           "$IAGENT/npm/node_modules/pi-plugin-manager" \
           "$IAGENT/npm/node_modules/pi-lens" "$IAGENT/npm/node_modules/pi-slash-anywhere"
  printf '{"version": "1.0.0"}\n' > "$IAGENT/npm/node_modules/ac-teams/package.json"
  printf '{"version": "1.0.0"}\n' > "$IAGENT/npm/node_modules/billion-context/package.json"
  printf '{"version": "1.0.0"}\n' > "$IAGENT/npm/node_modules/pi-plugin-manager/package.json"
  printf '{"version": "1.0.0"}\n' > "$IAGENT/npm/node_modules/pi-lens/package.json"
  printf '{"version": "1.0.0"}\n' > "$IAGENT/npm/node_modules/pi-slash-anywhere/package.json"
  out=$(iw outdated)
  : > "$IHOME/pi.log"
  up=$(iw upgrade ac-teams)
  bup=$(iw upgrade billion-context)
  pup=$(iw upgrade pi-plugin-manager)
  lup=$(iw upgrade pi-lens)
  sup=$(iw upgrade pi-slash-anywhere)
  if printf '%s' "$out" | grep -qF "unknown	ac-teams	pinned to npm:ac-teams@1.0.0" \
     && printf '%s' "$out" | grep -qF "unknown	billion-context	pinned to npm:billion-context@1.0.0" \
     && printf '%s' "$out" | grep -qF "unknown	pi-plugin-manager	pinned to npm:pi-plugin-manager@1.0.0" \
     && printf '%s' "$out" | grep -qF "unknown	pi-lens	pinned to npm:pi-lens@1.0.0" \
     && printf '%s' "$out" | grep -qF "unknown	pi-slash-anywhere	pinned to npm:pi-slash-anywhere@1.0.0" \
     && ! printf '%s' "$out" | grep -q '^stale	ac-teams' \
     && ! printf '%s' "$out" | grep -q '^stale	billion-context' \
     && ! printf '%s' "$out" | grep -q '^stale	pi-plugin-manager' \
     && ! printf '%s' "$out" | grep -q '^stale	pi-lens' \
     && ! printf '%s' "$out" | grep -q '^stale	pi-slash-anywhere' \
     && ! grep -q '^pi update' "$IHOME/pi.log" \
     && printf '%s' "$up" | grep -q 'pinned' \
     && printf '%s' "$bup" | grep -q 'pinned' \
     && printf '%s' "$pup" | grep -q 'pinned' \
     && printf '%s' "$lup" | grep -q 'pinned' \
     && printf '%s' "$sup" | grep -q 'pinned'; then
    ok "pinned npm packages including ac-teams, billion-context, pi-plugin-manager, pi-lens and pi-slash-anywhere read as pinned in outdated, and upgrade leaves them"
  else
    no "pinned npm packages including ac-teams, billion-context, pi-plugin-manager, pi-lens and pi-slash-anywhere read as pinned in outdated, and upgrade leaves them (outdated: $(flat "$out"); upgrade: $(flat "$up"); billion upgrade: $(flat "$bup"); plugin manager upgrade: $(flat "$pup"); lens upgrade: $(flat "$lup"); slash upgrade: $(flat "$sup"))"
  fi
  rm -rf "$IAGENT/npm"

  # Naming pi-acstack moves only a pin behind this plugin. A newer pin, an
  # unpinned ACStack and no ACStack at all are each left as they are.
  bad=""
  for pk in '"npm:acstack@999.0.0"' '"npm:acstack"' ''; do
    printf '{\n  "packages": [%s]\n}\n' "$pk" > "$ISET"
    before=$(cat "$ISET")
    : > "$IHOME/pi.log"
    iw upgrade pi-acstack >/dev/null
    { [ "$before" = "$(cat "$ISET")" ] && ! grep -q '^pi install' "$IHOME/pi.log"; } || bad="$bad [${pk:-none}]"
  done
  if [ -z "$bad" ]; then
    ok "upgrade pi-acstack leaves a newer, an unpinned and an absent ACStack alone"
  else
    no "upgrade pi-acstack leaves a newer, an unpinned and an absent ACStack alone (moved:$bad)"
  fi

  # agentic-retro writes under $PI_HOME, never pi's own override. apply and
  # disable have to look where it wrote.
  printf '{}\n' > "$ISET"
  rm -f "$IRETRO"
  ALT="$IWORK/alt-agent"; mkdir -p "$ALT"
  PI_CODING_AGENT_DIR="$ALT" iw apply >/dev/null
  owned=$(jget "$IHOME/.acstack/terminal-workspace.pi.json" files)
  PI_CODING_AGENT_DIR="$ALT" iw disable pi >/dev/null
  if printf '%s' "$owned" | grep -qF "$IRETRO" && [ ! -e "$IRETRO" ]; then
    ok "the agentic-retro extension is found where agentic-retro writes it, whatever pi's override"
  else
    no "the agentic-retro extension is found where agentic-retro writes it (owned: $owned)"
  fi
  echo "question waits reach herdr without changing user extensions"
  # A separate fake home keeps these contracts independent of earlier pi cases.
  IHOME="$IWORK/bridge-home"
  IAGENT="$IHOME/.pi/agent"
  ISET="$IAGENT/settings.json"
  ICFG="$IHOME/.acstack/terminal-workspace.yaml"
  mkdir -p "$IAGENT/extensions" "$(dirname "$ICFG")"
  printf '{}\n' > "$ISET"
  pi_cfg ""
  iw apply >/dev/null
  bridge_harness="$SCRIPT_DIR/integration/question-blocked-bridge.mjs"
  bridge_run() {
    env HOME="$IHOME" PI_CODING_AGENT_DIR="$IAGENT" \
      node --no-warnings "$bridge_harness" "$IAGENT" "$1" 2>&1
  }
  if [ "$(node -p 'process.features.typescript || ""' 2>/dev/null)" = "strip" ]; then
    for scenario in pristine-answer pristine-cancel pristine-error pristine-unrelated dual-unrelated; do
      result=$(bridge_run "$scenario"); rc=$?
      if [ "$rc" -eq 0 ]; then ok "question bridge $scenario"
      else no "question bridge $scenario ($(flat "$result"))"; fi
    done
  else
    skip "question event contracts require Node TypeScript stripping"
  fi

  # Lifecycle checks need only the ownership ledger, never a TypeScript import.
  # agentic-retro is the other extension installed by this fixture's stub.
  bridge_locate() {
    python3 - "$IHOME/.acstack/terminal-workspace.pi.json" "$1" <<'PYBRIDGE'
import json, os, sys
with open(sys.argv[1]) as ledger:
    files = json.load(ledger).get("files", [])
extensions = os.path.join(sys.argv[2], "extensions") + os.sep
for file in files:
    if file.startswith(extensions) and os.path.basename(file) != "agentic-retro.ts":
        print(file)
PYBRIDGE
  }
  bridge=$(bridge_locate "$IAGENT")

  # Discover the owned asset without prescribing its basename.
  if [ -f "$bridge" ]; then
    original=$(cat "$bridge")
    iw apply >/dev/null
    repeated=$(cat "$bridge")
    printf '\n// stale owned test fixture\n' >> "$bridge"
    iw apply >/dev/null
    refreshed=$(cat "$bridge")
    if [ "$original" = "$repeated" ] && [ "$original" = "$refreshed" ]; then
      ok "question bridge apply is idempotent and refreshes its owned asset"
    else
      no "question bridge apply is idempotent and refreshes its owned asset"
    fi
  else
    no "question bridge apply is idempotent and refreshes its owned asset (no installed public-event bridge)"
  fi

  # Toggling off and both removal entrypoints must release the managed bridge,
  # but not an unrelated workaround the user had installed themselves.
  user_workaround="$IAGENT/extensions/user-question-workaround.ts"
  printf '// user-owned rpiv:ask-user:blocked workaround\n' > "$user_workaround"
  for removal in toggle disable uninstall; do
    pi_cfg ""
    iw apply >/dev/null
    present=0
    [ -n "$bridge" ] && [ -f "$bridge" ] && present=1
    case "$removal" in
      toggle) pi_cfg "  question_tool: false"; iw apply >/dev/null ;;
      disable) iw disable pi >/dev/null ;;
      uninstall) iw uninstall >/dev/null ;;
    esac
    if [ "$present" = "1" ] && [ ! -e "$bridge" ] \
       && [ "$(cat "$user_workaround" 2>/dev/null)" = '// user-owned rpiv:ask-user:blocked workaround' ]; then
      ok "question bridge $removal removes only its owned asset"
    else
      no "question bridge $removal removes only its owned asset (installed before removal: $present)"
    fi
  done

  # A collision at the actual installation path is the user's, regardless of
  # basename. Neither reapply nor either removal command may claim it.
  if [ -n "$bridge" ]; then
    mkdir -p "$(dirname "$bridge")"
    printf '// my same-path question workaround\n' > "$bridge"
    preserved=1
    for action in apply apply 'disable pi' apply uninstall; do
      pi_cfg ""
      iw $action >/dev/null
      [ "$(cat "$bridge" 2>/dev/null)" = '// my same-path question workaround' ] || preserved=0
    done
    if [ "$preserved" = "1" ]; then ok "question bridge preserves same-path user workaround on apply and removal"
    else no "question bridge preserves same-path user workaround on apply and removal"; fi
    rm -f "$bridge"
  else
    no "question bridge preserves same-path user workaround on apply and removal (no installed public-event bridge)"
  fi

  # A dangling symlink is still a user path, not an absent asset.
  if [ -n "$bridge" ]; then
    ln -s "$IWORK/missing-question-extension.ts" "$bridge"
    out=$(iw status)
    if printf '%s' "$out" | grep -i 'question.*bridge' | grep -qi 'user' \
       && ! printf '%s' "$out" | grep -i 'question.*bridge' | grep -qi 'absent'; then
      ok "question bridge status reports a dangling user symlink as preserved"
    else
      no "question bridge status reports a dangling user symlink as preserved (said: $(flat "$out"))"
    fi
    rm -f "$bridge"
  else
    no "question bridge status reports a dangling user symlink as preserved (no installed bridge path)"
  fi

  # Deny writes to the ledger while leaving extensions writable, as on a
  # machine where ownership registration fails after the copy succeeds.
  pi_cfg ""
  iw apply >/dev/null
  ledger="$IHOME/.acstack/terminal-workspace.pi.json"
  ledger_dir=$(dirname "$ledger")
  registration_safe=1
  registration_details=""
  for prior in new owned; do
    cp "$ledger" "$IWORK/bridge-ledger.json"
    if [ "$prior" = new ]; then
      rm -f "$bridge"
      python3 - "$ledger" "$bridge" <<'PYBRIDGE'
import json, sys
with open(sys.argv[1]) as source:
    data = json.load(source)
data["files"] = [file for file in data.get("files", []) if file != sys.argv[2]]
with open(sys.argv[1], "w") as target:
    json.dump(data, target)
PYBRIDGE
    fi
    chmod a-w "$ledger" "$ledger_dir"
    out=$(iw apply); rc=$?
    chmod u+w "$ledger_dir" "$ledger"
    reported=0
    if [ "$rc" -ne 0 ] || printf '%s' "$out" | grep -Eqi 'cannot|could not|failed|unable|error|permission denied'; then
      reported=1
    fi
    if [ "$prior" = new ]; then
      [ ! -e "$bridge" ] && [ ! -L "$bridge" ] && [ "$reported" = 1 ] || registration_safe=0
    else
      [ -f "$bridge" ] && [ "$(cat "$bridge")" = "$original" ] && [ "$reported" = 1 ] || registration_safe=0
    fi
    registration_details="$registration_details [$prior: rc=$rc, asset=$([ -e "$bridge" ] && echo present || echo absent), reported=$reported]"
    cp "$IWORK/bridge-ledger.json" "$ledger"
    iw apply >/dev/null
  done
  iw disable pi >/dev/null
  if [ "$registration_safe" = 1 ]; then
    ok "question bridge registration failure cleans new assets, preserves owned assets, and reports failure"
  else
    no "question bridge registration failure cleans new assets, preserves owned assets, and reports failure ($registration_details)"
  fi

  # Pi's override determines extension discovery; never leak a second bridge
  # into the default agent directory while installing under the override.
  ALT="$IWORK/bridge-alt-agent"
  mkdir -p "$ALT"
  printf '{}\n' > "$ALT/settings.json"
  pi_cfg ""
  PI_CODING_AGENT_DIR="$ALT" iw apply >/dev/null
  alternate=$(bridge_locate "$ALT")
  default=$(bridge_locate "$IAGENT")
  PI_CODING_AGENT_DIR="$ALT" iw disable pi >/dev/null
  if [ -f "${alternate:-/nonexistent}" ]; then
    no "question bridge honors PI_CODING_AGENT_DIR and cleans up there (alternate asset remains)"
  elif [ -n "$alternate" ] && [ -z "$default" ] \
       && [ "$(cat "$user_workaround" 2>/dev/null)" = '// user-owned rpiv:ask-user:blocked workaround' ]; then
    ok "question bridge honors PI_CODING_AGENT_DIR and cleans up there"
  else
    no "question bridge honors PI_CODING_AGENT_DIR and cleans up there (no alternate bridge or default path changed)"
  fi
else
  printf '  note: apply installs x86_64 binaries only and reads its config with\n'
  printf '        PyYAML, so the pi checks are skipped\n'
  skip "the pi component checks"
fi

# Off unless asked for, like neovim: an apply that never mentions pi must not
# install it. Runs everywhere, because a config with pi off never reaches it.
if [ "$(python3 -c 'import yaml,sys; print((yaml.safe_load(open(sys.argv[1]))["pi"] or {}).get("enabled"))' \
       "$ROOT/assets/terminal-workspace/config.example.yaml" 2>/dev/null)" = "False" ] \
   && grep -R -q 'neovim|pi) echo false' "$TW_LIB"; then
  ok "pi starts off, in the example config and in the script's own default"
else
  no "pi starts off, in the example config and in the script's own default"
fi

billion_default=$(python3 -c 'import yaml,sys; print((yaml.safe_load(open(sys.argv[1]))["pi"] or {}).get("billion_context"))' \
  "$ROOT/assets/terminal-workspace/config.example.yaml" 2>/dev/null)
if [ "$billion_default" = "True" ] \
   && grep -q 'billion-context' "$ROOT/assets/terminal-workspace/config.example.yaml" \
   && grep -q '`pi.billion_context: false`' "$DOCS" \
   && grep -q '`billion-context`' "$DOCS"; then
  ok "billion-context has a documented default toggle for pi"
else
  no "billion-context has a documented default toggle for pi"
fi

slash_default=$(python3 -c 'import yaml,sys; print((yaml.safe_load(open(sys.argv[1]))["pi"] or {}).get("slash_anywhere"))' \
  "$ROOT/assets/terminal-workspace/config.example.yaml" 2>/dev/null)
if [ "$slash_default" = "True" ] \
   && grep -q 'pi-slash-anywhere' "$ROOT/assets/terminal-workspace/config.example.yaml" \
   && grep -q '`pi.slash_anywhere: false`' "$DOCS" \
   && grep -q '`pi-slash-anywhere`' "$DOCS"; then
  ok "pi-slash-anywhere has a documented default toggle for pi"
else
  no "pi-slash-anywhere has a documented default toggle for pi"
fi

lens_default=$(python3 -c 'import yaml,sys; print((yaml.safe_load(open(sys.argv[1]))["pi"] or {}).get("lens"))' \
  "$ROOT/assets/terminal-workspace/config.example.yaml" 2>/dev/null)
if [ "$lens_default" = "False" ] \
   && grep -q 'pi-lens' "$ROOT/assets/terminal-workspace/config.example.yaml" \
   && grep -q '`pi.lens: true`' "$DOCS" \
   && grep -q '`pi-lens`' "$DOCS"; then
  ok "pi-lens has a documented optional toggle for pi"
else
  no "pi-lens has a documented optional toggle for pi"
fi


if [ "$skipped" -gt 0 ]; then
  printf '\nResult: %d passed, %d failed, %d skipped\n' "$pass" "$fail" "$skipped"
else
  printf '\nResult: %d passed, %d failed\n' "$pass" "$fail"
fi
[ "$fail" -eq 0 ]
