pi_state() {
  ACSTACK_PI_OWNED="$PI_OWNED" ACSTACK_PI_SETTINGS="$PI_SETTINGS" \
  ACSTACK_PI_DIR="$PI_DIR" ACSTACK_PI_MD="$PI_MD_BEGIN|$PI_MD_END|$PI_DELEGATION" \
    py "$@" <<'PY'
import json, os, re, sys

OWNED = os.environ["ACSTACK_PI_OWNED"]
MISSING = object()

def load_owned():
    try:
        d = json.load(open(OWNED))
    except (OSError, ValueError):
        d = {}
    return d if isinstance(d, dict) else {}

def save_owned(d):
    d = {k: v for k, v in d.items() if v}
    if not d:
        if os.path.exists(OWNED):
            os.remove(OWNED)
        return
    os.makedirs(os.path.dirname(OWNED), exist_ok=True)
    json.dump(d, open(OWNED, "w"), indent=2)

def load_json(path):
    if not os.path.exists(path):
        return {}
    d = json.load(open(path))
    if not isinstance(d, dict):
        raise ValueError("not an object")
    return d

def identity(src):
    # pi names a package by its npm name or its repository without the ref, so
    # two pins of one repository are one package.
    if isinstance(src, dict):
        src = src.get("source", "")
    if src.startswith("npm:"):
        spec = src[4:]
        at = spec.rfind("@")
        return "npm:" + (spec[:at] if at > 0 else spec)
    m = re.match(r"^(?:git:|https?://|ssh://)(?:git@)?(.+?)(?:\.git)?(?:@[^/@]+)?$", src)
    if m:
        return "git:" + m.group(1).replace(":", "/")
    return src

cmd, args = sys.argv[1], sys.argv[2:]

if cmd == "pkg":
    try:
        pkgs = load_json(os.environ["ACSTACK_PI_SETTINGS"]).get("packages") or []
    except ValueError:
        raise SystemExit(1)
    for p in pkgs:
        if identity(p) == args[0]:
            print(p.get("source") if isinstance(p, dict) else p)
            raise SystemExit
    raise SystemExit(1)

if cmd in ("own", "disown", "owns"):
    kind, name = args
    slot = {"pkg": "packages", "file": "files"}[kind]
    d = load_owned()
    have = d.get(slot, [])
    if cmd == "owns":
        raise SystemExit(0 if name in have else 1)
    have = [x for x in have if x != name] + ([name] if cmd == "own" else [])
    d[slot] = have
    save_owned(d)
    raise SystemExit

if cmd in ("pin", "pin-get", "pin-forget"):
    d = load_owned()
    pins = d.setdefault("pins", {})
    if cmd == "pin":
        ident, was, ours = args
        pins[ident] = {"prior": pins.get(ident, {}).get("prior", was), "ours": ours}
    elif cmd == "pin-forget":
        pins.pop(args[0], None)
    else:
        rec = pins.get(args[0])
        if not rec:
            raise SystemExit(1)
        print("%s\t%s" % (rec["prior"], rec["ours"]))
        raise SystemExit
    save_owned(d)
    raise SystemExit

if cmd == "parses":
    try:
        load_json(args[0])
    except ValueError:
        raise SystemExit(1)
    raise SystemExit

if cmd == "merge":
    path, slot, want = args[0], args[1], json.loads(args[2])
    try:
        d = load_json(path)
    except ValueError:
        print("  pi: %s does not parse, so it was left alone" % path)
        raise SystemExit(3)
    owned = load_owned()
    mine = owned.setdefault(slot, {})
    # What a claimed key held before apply first changed it, so release can
    # put the user's value back rather than delete it.
    prior = owned.setdefault(slot + "_prior", {})
    wrote, dropped = [], []
    for key, value in want.items():
        parents, leaf = ([], key) if slot == "keybindings" else (key.split(".")[:-1], key.split(".")[-1])
        node = d
        for p in parents:
            if node.get(p, MISSING) is MISSING and value is not None:
                node[p] = {}
            node = node.get(p)
            if not isinstance(node, dict):
                break
        if not isinstance(node, dict):
            # A parent the user set to something other than an object, or
            # deleted. Writing through it would replace their value, so
            # concede this key. On release there is nothing left of ours.
            if value is not None:
                print("  pi: %s in %s is not an object, %s left alone" % (".".join(parents), path, key))
            else:
                mine.pop(key, None)
                prior.pop(key, None)
            continue
        have = node.get(leaf, MISSING)
        if value is None:
            # Released. Delete only a value this setup wrote and nobody has
            # changed since; anything else is the user's.
            if key in mine and have == mine[key]:
                if key in prior:
                    node[leaf] = prior[key]
                else:
                    del node[leaf]
                    cur = d
                    for p in parents[:-1]:
                        cur = cur[p]
                    if parents and not node:
                        del cur[parents[-1]]
                dropped.append(key)
            mine.pop(key, None)
            prior.pop(key, None)
        elif have != value:
            if key not in mine and have is not MISSING:
                prior[key] = have
            node[leaf] = value
            mine[key] = value
            wrote.append(key)
    save_owned(owned)
    if wrote or dropped:
        if d or not os.path.exists(path):
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w") as f:
                # pi writes its own settings unescaped, so a value in any
                # script round-trips as the user typed it.
                json.dump(d, f, indent=2, ensure_ascii=False)
                f.write("\n")
        else:
            # Everything in it was ours, and an empty file is no setting at all.
            os.remove(path)
        if wrote:
            print("  pi: set %s in %s" % (", ".join(wrote), path))
        if dropped:
            print("  pi: released %s in %s" % (", ".join(dropped), path))
    raise SystemExit

if cmd == "md":
    begin, end, line = os.environ["ACSTACK_PI_MD"].split("|")
    agent_dir = os.environ["ACSTACK_PI_DIR"]
    # pi reads one context file from its agent directory, the first of these
    # that exists. A block in any other one would never reach the model.
    names = ["AGENTS.override.md", "AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"]
    paths = [os.path.join(agent_dir, n) for n in names]
    target = next((p for p in paths if os.path.isfile(p)), paths[1])
    block = re.compile(re.escape(begin) + r".*?" + re.escape(end) + r"\n?", re.S)
    # The blank line write puts before the block goes with it, so stripping
    # hands back the user's text exactly as it was.
    gap = re.compile(r"\n?" + block.pattern, re.S)
    state = load_owned()
    owned_md = state.get("md", {})
    for p in paths:
        if not os.path.isfile(p) or (args[0] == "write" and p == target):
            continue
        t = open(p).read()
        # write records the exact separator it added. Removing that and no
        # more hands back the user's file byte for byte, final newline or not.
        sep = owned_md.get("sep")
        cut = re.compile(re.escape(sep) + block.pattern, re.S) if sep is not None else gap
        stripped = cut.sub("", t)
        if stripped != t:
            if stripped.strip():
                open(p, "w").write(stripped)
            else:
                os.remove(p)
            print("  pi: delegation line removed from %s" % p)
    if args[0] == "strip":
        state.pop("md", None)
        save_owned(state)
    if args[0] == "write":
        t = open(target).read() if os.path.isfile(target) else ""
        mine = "%s\n%s\n%s\n" % (begin, line, end)
        if block.search(t):
            new = block.sub(lambda m: mine, t, count=1)
        else:
            sep = ("\n" if t and not t.endswith("\n") else "") + ("\n" if t else "")
            new = t + sep + mine
            state["md"] = {"sep": sep}
            save_owned(state)
        if new != t:
            os.makedirs(agent_dir, exist_ok=True)
            open(target, "w").write(new)
            print("  pi: delegation line written to %s" % target)
    raise SystemExit
PY
}

# The four personal settings, from the config, as the JSON merge reads them.
# An empty value releases the key rather than writing an empty one.
pi_settings_wanted() {
  ACSTACK_CFG="$CFG" py <<'PY'
import json, os, sys
import yaml
p = os.environ["ACSTACK_CFG"]
c = (yaml.safe_load(open(p)) or {}) if os.path.isfile(p) else {}
s = ((c.get("pi") or {}).get("settings") or {})
# config key -> (pi's dotted key, the default config.example.yaml ships, the
# values pi accepts). YAML reads a bare off as false, so mermaid maps it back.
KEYS = {"hide_thinking_block": ("hideThinkingBlock", True, (True, False)),
        "mermaid": ("markdown.mermaid", "streaming", ("off", "final", "streaming")),
        "install_telemetry": ("enableInstallTelemetry", False, (True, False)),
        "theme": ("theme", "alex-mid-grey", None)}
out = {}
for k, (key, default, allowed) in KEYS.items():
    v = s.get(k, default)
    if v in ("", None):
        out[key] = None
        continue
    if k == "mermaid" and v is False:
        v = "off"
    ok = (v in allowed and type(v) is type(allowed[0])) if allowed else isinstance(v, str)
    if not ok:
        # Left out entirely, so pi keeps whatever it holds now.
        print("  pi: settings.%s cannot be %r, left alone" % (k, v), file=sys.stderr)
        continue
    out[key] = v
print(json.dumps(out))
PY
}

pi_zentui_wanted() {
  cat <<'JSON'
{
  "components.editor.enabled": true,
  "components.editor.style": "accent-rail",
  "components.editor.styles.accent-rail.transparent": false,
  "components.userMessages.enabled": false,
  "components.footer.style": "starship",
  "components.footer.modelLabel": "id",
  "components.footer.styles.starship.segments.modelInfo": true,
  "components.footer.styles.starship.extensionStatuses.defaultPlacement": "off",
  "components.extensionStatuses.defaultVisibility": "hide",
  "components.extensionStatuses.visibility.pi-lens": "hide",
  "components.extensionStatuses.visibility.pi-lens-lsp": "hide",
  "components.extensionStatuses.visibility.ponytail": "hide",
  "components.footer.styles.starship.responsive": true,
  "components.footer.styles.starship.format": "$cwd( in $session_name)( on $git_branch)( $git_status)( via $runtime)$fill$model($sep$provider)($sep$thinkingLevel)($sep$context)( $auto_compaction)($sep$tokens)( $cache_read)( $cache_write)($sep$cost)( $subscription)",
  "components.footer.styles.starship.compactFormat": "$cwd$wrap(in $session_name)$wrap(on $git_branch) $git_status$fill$model$wrap_sep($provider)$wrap_sep($thinkingLevel)$wrap_sep$context$wrap_sep$tokens"
}
JSON
}

pi_zentui_release() {
  cat <<'JSON'
{
  "components.editor.enabled": null,
  "components.editor.style": null,
  "components.editor.styles.accent-rail.transparent": null,
  "components.userMessages.enabled": null,
  "components.footer.style": null,
  "components.footer.modelLabel": null,
  "components.footer.styles.starship.segments.modelInfo": null,
  "components.footer.styles.starship.extensionStatuses.defaultPlacement": null,
  "components.extensionStatuses.defaultVisibility": null,
  "components.extensionStatuses.visibility.pi-lens": null,
  "components.extensionStatuses.visibility.pi-lens-lsp": null,
  "components.extensionStatuses.visibility.ponytail": null,
  "components.footer.styles.starship.responsive": null,
  "components.footer.styles.starship.format": null,
  "components.footer.styles.starship.compactFormat": null
}
JSON
}

pi_write_theme() {
  if [ -e "$PI_THEME" ] && ! pi_state owns file "$PI_THEME"; then
    say "pi: $PI_THEME already exists, so the ACStack theme was left alone"
    return 0
  fi
  ACSTACK_PI_THEME="$PI_THEME" py <<'PY'
import json, os

target = os.environ["ACSTACK_PI_THEME"]
theme = {
    "$schema": "https://pi.dev/schemas/theme.schema.json",
    "name": "alex-mid-grey",
    "vars": {
        "surfaceMuted": "#21262D",
        "border": "#30363D",
        "borderSubtle": "#21262D",
        "text": "#C9D1D9",
        "textBright": "#E6EDF3",
        "muted": "#8B949E",
        "dim": "#6E7681",
        "toolStatus": "#59616B",
        "blue": "#58A6FF",
        "blueSoft": "#79C0FF",
        "inlineCode": "#D2A8FF",
        "green": "#3FB950",
        "red": "#F85149",
        "yellow": "#E0A052",
        "orange": "#FFA657",
        "purple": "#D2A8FF",
        "toolAccent": "#95A7FF",
        "toolName": "#8B85D6",
        "toolText": "#98A1AC",
        "pink": "#FF7B72",
        "userPromptBg": "#24272e",
    },
    "colors": {
        "accent": "toolAccent",
        "border": "border",
        "borderAccent": "toolStatus",
        "borderMuted": "borderSubtle",
        "success": "green",
        "error": "red",
        "warning": "yellow",
        "muted": "muted",
        "dim": "dim",
        "text": "text",
        "thinkingText": "toolText",
        "selectedBg": "surfaceMuted",
        "searchMatchBg": "#3B2E10",
        "searchMatchText": "textBright",
        "userMessageBg": "userPromptBg",
        "userMessageText": "textBright",
        "customMessageBg": "",
        "customMessageText": "text",
        "customMessageLabel": "muted",
        "toolPendingBg": "",
        "toolSuccessBg": "",
        "toolErrorBg": "#211414",
        "toolTitle": "toolName",
        "toolOutput": "toolText",
        "scrollbarTrack": "borderSubtle",
        "scrollbarThumb": "border",
        "mdHeading": "textBright",
        "mdLink": "blue",
        "mdLinkUrl": "dim",
        "mdCode": "inlineCode",
        "mdCodeBlock": "text",
        "mdCodeBlockBorder": "#0D1117",
        "mdQuote": "toolText",
        "mdQuoteBorder": "border",
        "mdHr": "borderSubtle",
        "mdListBullet": "muted",
        "toolDiffAdded": "#45B85A",
        "toolDiffRemoved": "#E45D57",
        "toolDiffContext": "dim",
        "syntaxComment": "dim",
        "syntaxKeyword": "pink",
        "syntaxFunction": "purple",
        "syntaxVariable": "text",
        "syntaxString": "blueSoft",
        "syntaxNumber": "orange",
        "syntaxType": "orange",
        "syntaxOperator": "muted",
        "syntaxPunctuation": "muted",
        "thinkingOff": "borderSubtle",
        "thinkingMinimal": "border",
        "thinkingLow": "dim",
        "thinkingMedium": "muted",
        "thinkingHigh": "blue",
        "thinkingXhigh": "blueSoft",
        "thinkingMax": "#9FCFF8",
        "bashMode": "green",
    },
    "export": {"pageBg": "#0D1117", "cardBg": "#161B22", "infoBg": "#1C2128"},
}
os.makedirs(os.path.dirname(target), exist_ok=True)
json.dump(theme, open(target, "w"), indent=2, ensure_ascii=False)
open(target, "a").write("\n")
PY
  pi_state own file "$PI_THEME"
  say "pi: ACStack theme written to $PI_THEME"
}

# npm installs pi into its global bin, which a fresh shell may not have on
# PATH. Asking npm costs a process, so only when pi is not already found.
find_pi() {
  have pi || ! have npm || PATH="$PATH:$(npm prefix -g 2>/dev/null)/bin"
}


# Keep herdr's own writer as the sole pane authority; reapply after it is replaced.
patch_herdr_pi_status() {
  python3 "$SCRIPT_DIR/lib/patch-herdr-pi.py" "$PI_DIR/extensions/herdr-agent-state.ts" "$@" \
    || say "pi: herdr background status patch was not applied; reporter left unchanged"
}

# Pi's bundled TUI does not always receive Windows Terminal paste as plain
# text. Through Herdr and ConPTY it can arrive as Win32 input records such as
# ESC[13;28;13;1;0;1_. Patch the installed bundle after install or update.
patch_pi_win32_paste() {
  have pi || return 0
  local pi_bin pi_real root chunks
  pi_bin=$(command -v pi) || return 0
  pi_real=$(readlink -f "$pi_bin" 2>/dev/null || printf '%s' "$pi_bin")
  case "$pi_real" in
    */dist/bundle/cli.js) root=${pi_real%/dist/bundle/cli.js} ;;
    *)
      root="${pi_real%/bin/pi}/lib/node_modules/@earendil-works/pi-coding-agent"
      if [ ! -d "$root/dist/bundle/chunks" ]; then
        have npm || { say "pi: npm not on PATH, so Win32 paste patch was skipped"; return 0; }
        root="$(npm root -g 2>/dev/null)/@earendil-works/pi-coding-agent"
      fi
      ;;
  esac
  chunks="$root/dist/bundle/chunks"
  [ -d "$chunks" ] || { say "pi: bundle chunks not found, so Win32 paste patch was skipped"; return 0; }
  SPECHUB_PI_CHUNKS="$chunks" py <<'PI_PATCH_PY'
import os, pathlib
chunks = pathlib.Path(os.environ["SPECHUB_PI_CHUNKS"])
target = None
for p in chunks.glob("*.js"):
    try:
        s = p.read_text()
    except (OSError, UnicodeDecodeError):
        continue
    if "function decodePrintableKey(data)" in s and "handlePaste(pastedText)" in s:
        target = p
        break
if target is None:
    print("  pi: TUI bundle not found, so Win32 paste patch was skipped")
    raise SystemExit
s = target.read_text()
changed = False
repls = [
('function isKeyRelease(data){return data.includes("\\x1B[200~")?!1:!!(data.includes(":3u")||data.includes(":3~")||data.includes(":3A")||data.includes(":3B")||data.includes(":3C")||data.includes(":3D")||data.includes(":3H")||data.includes(":3F"))}',
 'function isKeyRelease(data){let win32=parseWin32InputRecord(data);if(win32)return!win32.keyDown;return data.includes("\\x1B[200~")?!1:!!(data.includes(":3u")||data.includes(":3~")||data.includes(":3A")||data.includes(":3B")||data.includes(":3C")||data.includes(":3D")||data.includes(":3H")||data.includes(":3F"))}'),
('function parseModifyOtherKeysSequence(data){let match=data.match(/^\\x1b\\[27;(\\d+);(\\d+)~$/);if(!match)return null;let modValue=parseInt(match[1],10);return{codepoint:parseInt(match[2],10),modifier:modValue-1}}',
 'function parseModifyOtherKeysSequence(data){let match=data.match(/^\\x1b\\[27;(\\d+);(\\d+)~$/);if(!match)return null;let modValue=parseInt(match[1],10);return{codepoint:parseInt(match[2],10),modifier:modValue-1}}function parseWin32InputRecord(data){let match=data.match(/^\\x1b\\[(\\d+);(\\d+);(-?\\d+);([01]);(\\d+);(\\d+)_$/);if(!match)return null;let virtualKey=Number.parseInt(match[1],10),scanCode=Number.parseInt(match[2],10),codepoint=Number.parseInt(match[3],10),keyDown=match[4]==="1",controlState=Number.parseInt(match[5],10),modifier=0;if((controlState&16)!==0)modifier|=MODIFIERS.shift;if((controlState&(1|2))!==0)modifier|=MODIFIERS.alt;if((controlState&(4|8))!==0)modifier|=MODIFIERS.ctrl;if((controlState&32)!==0)modifier|=128;if((controlState&128)!==0)modifier|=64;return{virtualKey,scanCode,codepoint,keyDown,modifier}}'),
('function parseKey(data){let kitty=parseKittySequence(data);',
 'function parseKey(data){let win32=parseWin32InputRecord(data);if(win32){_lastEventType=win32.keyDown?"press":"release";if(!win32.keyDown)return;let codepoint=win32.codepoint;if(win32.virtualKey===46)codepoint=FUNCTIONAL_CODEPOINTS.delete;else if(win32.virtualKey===45)codepoint=FUNCTIONAL_CODEPOINTS.insert;else if(win32.virtualKey===33)codepoint=FUNCTIONAL_CODEPOINTS.pageUp;else if(win32.virtualKey===34)codepoint=FUNCTIONAL_CODEPOINTS.pageDown;else if(win32.virtualKey===35)codepoint=FUNCTIONAL_CODEPOINTS.end;else if(win32.virtualKey===36)codepoint=FUNCTIONAL_CODEPOINTS.home;else if(win32.virtualKey===37)codepoint=ARROW_CODEPOINTS.left;else if(win32.virtualKey===38)codepoint=ARROW_CODEPOINTS.up;else if(win32.virtualKey===39)codepoint=ARROW_CODEPOINTS.right;else if(win32.virtualKey===40)codepoint=ARROW_CODEPOINTS.down;else if(win32.virtualKey===8)codepoint=CODEPOINTS.backspace;else if(win32.virtualKey===9)codepoint=CODEPOINTS.tab;else if(win32.virtualKey===13)codepoint=CODEPOINTS.enter;else if(win32.virtualKey===27)codepoint=CODEPOINTS.escape;return formatParsedKey(codepoint,win32.modifier)}let kitty=parseKittySequence(data);'),
('function decodeModifyOtherKeysPrintable(data){let parsed=parseModifyOtherKeysSequence(data);if(!(!parsed||(parsed.modifier&~LOCK_MASK&~MODIFIERS.shift)!==0)&&!(!Number.isFinite(parsed.codepoint)||parsed.codepoint<32))try{return String.fromCodePoint(parsed.codepoint)}catch{return}}function decodePrintableKey(data){return decodeKittyPrintable(data)??decodeModifyOtherKeysPrintable(data)}',
 'function decodeModifyOtherKeysPrintable(data){let parsed=parseModifyOtherKeysSequence(data);if(!(!parsed||(parsed.modifier&~LOCK_MASK&~MODIFIERS.shift)!==0)&&!(!Number.isFinite(parsed.codepoint)||parsed.codepoint<32))try{return String.fromCodePoint(parsed.codepoint)}catch{return}}function decodeWin32Printable(data){let parsed=parseWin32InputRecord(data);if(!parsed||!parsed.keyDown)return;let modifier=parsed.modifier&~LOCK_MASK;if((modifier&(MODIFIERS.ctrl|MODIFIERS.alt|MODIFIERS.super))!==0)return;if(!Number.isFinite(parsed.codepoint)||parsed.codepoint<32)return;try{return String.fromCodePoint(parsed.codepoint)}catch{return}}function decodePrintableKey(data){return decodeKittyPrintable(data)??decodeModifyOtherKeysPrintable(data)??decodeWin32Printable(data)}'),
('let decodedText=pastedText.replace(/\\x1b\\[(\\d+);5u/g,(match,code)=>{let cp=Number(code);return cp>=97&&cp<=122?String.fromCharCode(cp-96):cp>=65&&cp<=90?String.fromCharCode(cp-64):match}),filteredText=this.normalizeText(decodedText).split("").filter(char=>char===`\n`||char.charCodeAt(0)>=32).join("");',
 'let decodedText=pastedText.replace(/\\x1b\\[(\\d+);(\\d+);(-?\\d+);([01]);(\\d+);(\\d+)_/g,(match,vk,sc,uc,kd)=>{if(kd!=="1")return "";let cp=Number(uc),key=Number(vk);if(key===13||cp===13)return `\n`;if(cp>=32)try{return String.fromCodePoint(cp)}catch{return ""}return ""}).replace(/\\x1b\\[(\\d+);5u/g,(match,code)=>{let cp=Number(code);return cp>=97&&cp<=122?String.fromCharCode(cp-96):cp>=65&&cp<=90?String.fromCharCode(cp-64):match}),filteredText=this.normalizeText(decodedText).split("").filter(char=>char===`\n`||char.charCodeAt(0)>=32).join("");')]
missing = []
for old, new in repls:
    if new in s:
        continue
    if old not in s:
        missing.append(old[:80])
        continue
    s = s.replace(old, new, 1)
    changed = True
if missing:
    print("  pi: Win32 paste patch did not match this Pi bundle")
    raise SystemExit
if changed:
    try:
        target.write_text(s)
    except OSError as exc:
        print(f"  pi: could not patch {target} ({exc})")
        raise SystemExit
    print("  pi: Win32 paste patch applied")
else:
    print("  pi: Win32 paste patch already applied")
PI_PATCH_PY
}

# The ACStack version running this script, which is the one pi should pin.
