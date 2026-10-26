acstack_tw_main() {
  ACTION="${1:-status}"
  case "$ACTION" in
  status)
    echo "config: $CFG $([ -f "$CFG" ] && echo '(found)' || echo '(missing, using defaults)')"
    find_pi
    for t in herdr delta diffnav fzf lazygit tuicr yazi glow mermaid-ascii harlequin gh nvim pi; do
      case "$t" in
        gh) k=gh_dash ;; glow|mermaid-ascii) k=markdown ;; fzf) k=diffnav ;;
        nvim) k=neovim ;;
        *) k="$t" ;;
      esac
      # neovim and pi default to off, so reading them with the default every
      # other one takes would report them enabled when the config says nothing.
      printf '  %-13s %-14s enabled=%s\n' "$t" "$(have "$t" && echo installed || echo 'not installed')" \
        "$(cfg_get "$k.enabled" "$(enabled_default "$k")")"
    done
    grep -q "$BEGIN" "$HERDR_CFG" 2>/dev/null && say "herdr managed block: present" || say "herdr managed block: absent"
    echo
    # Where a copy and an open actually land, which is the first thing to
    # check when o or y misbehaves on a machine reached over SSH.
    if [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
      say "clipboard: this machine has a display, using its own"
    elif [ -x "$BIN/xclip" ]; then
      say "clipboard: xclip stand-in, copying to your terminal over OSC 52"
    else
      say "clipboard: none - run apply, or copy will fail in gh-dash and friends"
    fi
    if grep -q 'vim\.g\.clipboard' "$NVIM_PLUGIN" 2>/dev/null; then
      say "neovim clipboard: OSC 52, written by this setup"
    elif mine="$(nvim_user_sets 'g\.clipboard')"; then
      say "neovim clipboard: set by $mine"
    elif [ "$(cfg_get neovim.enabled false)" = "true" ]; then
      say "neovim clipboard: none - run apply, or :%y+ fails over SSH"
    fi
    # Ask the opener itself rather than repeating its rules here. Two copies
    # of this decision drifting apart is exactly how o came to claim it had
    # opened a page it had not.
    case "$(acstack-open --why 2>/dev/null)" in
      command)      say "browser: \$ACSTACK_OPEN_CMD = $ACSTACK_OPEN_CMD" ;;
      xdg-open)     say "browser: xdg-open on this machine" ;;
      wslview|wsl-open|explorer.exe)
                    say "browser: the Windows side of this machine" ;;
      opener)       say "browser: your default browser on your laptop, through the opener" ;;
      bridge)       say "browser: Chrome on your laptop, through the Playwriter bridge" ;;
      link)         say "browser: none - o hands you a ctrl+clickable link and copies it" ;;
      clipboard)    say "browser: none, and no terminal either - o copies and reports failure" ;;
      *)            say "browser: unknown - run apply" ;;
    esac
    [ -f "$HOME/.cache/acstack/open.log" ] \
      && say "last open: $(tail -1 "$HOME/.cache/acstack/open.log")"
    # What the pi component set up, read from pi's own files. Shown whenever
    # pi is here or asked for, because a pi installed by hand is still one the
    # user may want to know about.
    if have pi || [ "$(cfg_get pi.enabled false)" = "true" ]; then
      echo
      have pi && say "pi: $(installed_version pi)" || say "pi: not installed"
      for id in "$PI_ACSTACK" $(version_table | awk -F'\t' '$2=="pi" && $3=="npm" && $1!="pi"{print $1}' | while read -r name; do pi_npm_package "$name"; done); do
        src=$(pi_state pkg "$id") && say "pi package: $src" || say "pi package: $id not installed"
      done
      if [ -e "$PI_QUESTION_BRIDGE" ] || [ -L "$PI_QUESTION_BRIDGE" ]; then
        pi_state owns file "$PI_QUESTION_BRIDGE" \
          && say "pi question blocked bridge: managed ($PI_QUESTION_BRIDGE)" \
          || say "pi question blocked bridge: user-owned path ($PI_QUESTION_BRIDGE)"
      else
        say "pi question blocked bridge: absent ($PI_QUESTION_BRIDGE)"
      fi
      [ -e "$PI_RETRO_EXT" ] && say "pi agentic-retro extension: present" \
        || say "pi agentic-retro extension: absent"
      grep -qsF "$PI_MD_BEGIN" "$PI_DIR"/AGENTS.override.md "$PI_DIR"/AGENTS.md "$PI_DIR"/AGENTS.MD \
        "$PI_DIR"/CLAUDE.md "$PI_DIR"/CLAUDE.MD \
        && say "pi delegation line: present" || say "pi delegation line: absent"
      [ -f "$PI_DIR/auth.json" ] && say "pi login: logged in" \
        || say "pi login: not logged in - run pi, then /login"
    fi
    if [ "$(cfg_get tuicr.build_from_fork false)" = "true" ]; then
      echo
      say "tuicr: local fork build - this is meant to be temporary"
      if have gh; then
        for pr in 607 633; do
          state=$(gh pr view "$pr" --repo agavra/tuicr --json state -q .state 2>/dev/null || echo "unknown")
          printf '    agavra/tuicr#%s  %s\n' "$pr" "$state"
        done
        say "both MERGED? set tuicr.build_from_fork: false and re-run apply"
        say "check the merged key names first - review can rename them"
      else
        say "install gh to have this check agavra/tuicr#607 and #633 for you"
      fi
    fi
    ;;
  apply)
    require_yaml
    arch_supported || exit 1
    # Every setting has a default, so a missing config is a working setup and
    # not an error. Say so anyway: the alternative is a run that looks like it
    # read your settings and did not.
    [ -f "$CFG" ] || say "no config at $CFG, so every setting takes its default"
    [ "$(cfg_get enabled true)" = "true" ] || { echo "terminal workspace disabled in config"; exit 0; }
    if [ "$(cfg_get herdr.enabled true)" = "true" ] && ! have herdr; then
      # herdr ships an installer that picks the right build and verifies a
      # checksum. Prefer it over matching release asset names ourselves.
      curl -fsSL https://herdr.dev/install.sh | sh >/dev/null 2>&1 \
        && say "herdr installed" || say "herdr install failed, see herdr.dev"
    fi
    [ "$(cfg_get delta.enabled true)"   = "true" ] && install_binary delta dandavison/delta x86_64-unknown-linux-gnu
    [ "$(cfg_get diffnav.enabled true)" = "true" ] && install_binary diffnav dlvhdr/diffnav Linux_x86_64
    # fzf drives the comparison picker behind acstack-diff pick.
    [ "$(cfg_get diffnav.enabled true)" = "true" ] && install_binary fzf junegunn/fzf linux_amd64
    [ "$(cfg_get lazygit.enabled true)" = "true" ] && install_binary lazygit jesseduffield/lazygit linux_x86_64
    write_helpers
    [ "$(cfg_get tuicr.enabled true)"   = "true" ] && apply_tuicr
    apply_yazi
    apply_markdown
    apply_neovim
    [ "$(cfg_get herdr.enabled true)"   = "true" ] && apply_herdr
    [ "$(cfg_get herdr.enabled true)"   = "true" ] && apply_herdr_numbers
    [ "$(cfg_get delta.enabled true)"   = "true" ] && apply_delta
    [ "$(cfg_get remote.enabled true)" = "true" ] && apply_remote
    [ "$(cfg_get gh_dash.enabled true)" = "true" ] && apply_ghdash
    [ "$(cfg_get harlequin.enabled true)" = "true" ] && apply_harlequin
    [ "$(cfg_get pi.enabled false)" = "true" ] && apply_pi
    echo "done. open a herdr session and press prefix+? to see the keymap"
    # Last, so a run that died half way leaves no stamp claiming success.
    write_stamp
    ;;
  outdated)
    # Exit 2 means "cannot tell", and a missing PyYAML is exactly that.
    # require_yaml exits 1, which every caller reads as "there is something to
    # fetch" and acts on findings this run was never able to produce.
    python3 -c 'import yaml' 2>/dev/null || {
      echo "PyYAML is required to read $CFG, so nothing here can be compared" >&2
      exit 2; }
    [ -f "$EXAMPLE" ] || { echo "no config.example.yaml beside $0" >&2; exit 2; }
    out=$(outdated_report)
    [ -n "$out" ] || exit 0
    printf '%s\n' "$out"
    # An unknown is not a finding: nothing can be done about a tool with no
    # version flag or a GitHub that did not answer. Only a real one exits 1.
    printf '%s\n' "$out" | grep -qE '^(missing|new|stale)' && exit 1
    exit 0
    ;;
  upgrade)
    require_yaml
    arch_supported || exit 1
    shift
    names="$*"
    report=""
    if [ -z "$names" ]; then
      report=$(outdated_report)
      names=$(printf '%s\n' "$report" | awk -F'\t' '$1=="stale"{print $2}')
    fi
    for n in $names; do upgrade_one "$n"; done

    # A new component is a config edit, not a download. Append the block the
    # example ships, comments and all, rather than rewriting the file through
    # yaml - a round trip through the parser drops every comment the user has.
    printf '%s\n' "$report" | awk -F'\t' '$1=="new"{print $2}' | while read -r comp; do
      [ -n "$comp" ] || continue
      ACSTACK_COMP="$comp" py "$EXAMPLE" "$CFG" <<'PY'
import os, re, sys
comp = os.environ["ACSTACK_COMP"]
ship = open(sys.argv[1]).read()
# The block runs from the component's own key to the next top-level key. A
# top-level key is the only thing that starts in column zero and ends in a
# colon, which is what makes a plain text slice safe here.
m = re.search(r"(?ms)^%s:.*?(?=^\S+:|\Z)" % re.escape(comp), ship)
if not m:
    raise SystemExit
block = m.group(0).rstrip() + "\n"
mine = open(sys.argv[2]).read() if os.path.isfile(sys.argv[2]) else ""
if re.search(r"(?m)^%s:" % re.escape(comp), mine):
    raise SystemExit
open(sys.argv[2], "a").write(("" if mine.endswith("\n\n") else "\n") + block)
print("  %s added to your config, with its comments" % comp)
PY
    done

    say "run apply to install anything new"
    ;;
  disable)
    DISABLE_USAGE="usage: setup.sh disable <herdr|delta|diffnav|gh_dash|harlequin|lazygit|neovim|pi|tuicr>"
    comp="${2:?$DISABLE_USAGE}"
    case "$comp" in
      delta) for k in core.pager interactive.diffFilter delta.navigate delta.line-numbers; do
               git config --global --unset "$k" 2>/dev/null
             done
             say "delta unset as git pager"
             say "now set delta.enabled: false in $CFG so apply does not restore it" ;;
      herdr)
        patch_herdr_pi_status --remove
        py "$HERDR_CFG" "$BEGIN" "$END" <<'PY'
import re, sys, os
p, b, e = sys.argv[1:4]
if os.path.isfile(p):
    t = open(p).read()
    open(p, "w").write(re.sub(re.escape(b) + r".*?" + re.escape(e) + r"\n?", "", t, flags=re.S))
PY
        say "managed block removed from herdr config"
        say "now set herdr.enabled: false in $CFG so apply does not restore it" ;;
      neovim)
        # A whole file of ours, so turning it off is a deletion. Anything the
        # user wrote by hand under that name is theirs and stays.
        if nvim_ours; then
          rm -f "$NVIM_PLUGIN"
          say "neovim plugin file removed"
        fi
        say "now set neovim.enabled: false in $CFG so apply does not restore it" ;;
      pi)
        # Only what apply added. The pi binary, its logins and its sessions
        # stay, and so does anything the user installed into pi themselves.
        remove_pi
        say "now set pi.enabled: false in $CFG so apply does not restore it" ;;
      diffnav|gh_dash|harlequin|lazygit|tuicr)
        # Only this component's popup goes away. Rebuild the managed block so
        # the rest of the keymap survives.
        require_yaml
        ACSTACK_CFG="$CFG" py "$comp" <<'PY'
import os, sys, yaml
p = os.environ["ACSTACK_CFG"]
c = yaml.safe_load(open(p)) or {}
c.setdefault(sys.argv[1], {})["enabled"] = False
yaml.safe_dump(c, open(p, "w"), sort_keys=False)
PY
        apply_herdr
        say "$comp disabled, rest of the keymap left in place" ;;
      yazi|markdown|remote)
        # These three have no keys to remove and no git settings to unset, so
        # there is nothing here to carry out. Refusing says so; the arm that
        # was missing let the script exit 0 in silence, which reads as done.
        say "$comp has no disable step"
        say "set $comp.enabled: false in $CFG and run apply instead"
        exit 1 ;;
      *) echo "$comp is not a component. $DISABLE_USAGE" >&2; exit 1 ;;
    esac
    ;;
  uninstall)
    "$0" disable herdr; "$0" disable delta; "$0" disable neovim; "$0" disable pi
    # By prefix, which is why helpers are named acstack-*: anything this
    # script ever wrote goes, including helpers retired in an older version.
    herdr plugin unlink acstack.herdr-numbers >/dev/null 2>&1 || true
    rm -rf "$HOME/.config/acstack/herdr-numbers"
    rm -f "$BIN"/acstack-*
    # The xclip stand-in is the one managed file without the prefix.
    grep -q "Installed by acstack" "$BIN/xclip" 2>/dev/null && rm -f "$BIN/xclip"
    # Every file apply leaves a marked region in. Removing the region is the
    # same edit `disable herdr` makes, so whatever the user wrote around it
    # comes through untouched. Left behind, the yazi regions keep routing
    # markdown at acstack-md, a helper this command has just deleted.
    ACSTACK_ARGS="$BEGIN|$END" py \
      "$HOME/.config/tuicr/config.toml" \
      "$HOME/.config/yazi/yazi.toml" \
      "$HOME/.config/yazi/keymap.toml" <<'PY'
import os, re, sys
b, e = os.environ["ACSTACK_ARGS"].split("|")
for p in sys.argv[1:]:
    if os.path.isfile(p):
        t = open(p).read()
        open(p, "w").write(re.sub(re.escape(b) + r".*?" + re.escape(e) + r"\n?", "", t, flags=re.S))
PY
    # gh-dash reads YAML that python rewrites whole, so a marker comment never
    # survives the round trip. What identifies acstack's work there is the name
    # on each keybinding, the same handle apply_ghdash uses to replace its own
    # entries, plus the two page keys it binds. Sections, repo paths and every
    # other keybinding belong to the user and stay.
    if [ -f "$GHDASH_CFG" ] && python3 -c 'import yaml' 2>/dev/null; then
      py "$GHDASH_CFG" <<'PY'
import sys, yaml
p = sys.argv[1]
cfg = yaml.safe_load(open(p)) or {}
MANAGED = ("review (tuicr)", "tree diff", "agent review", "open in browser")
kbs = cfg.get("keybindings") or {}
for scope in ("prs", "issues"):
    if scope in kbs:
        kbs[scope] = [k for k in kbs[scope] or [] if k.get("name") not in MANAGED]
        if not kbs[scope]:
            del kbs[scope]
if "universal" in kbs:
    kbs["universal"] = [k for k in kbs["universal"] or []
                        if k.get("builtin") not in ("pageUp", "pageDown")]
    if not kbs["universal"]:
        del kbs["universal"]
if kbs:
    cfg["keybindings"] = kbs
else:
    cfg.pop("keybindings", None)
yaml.safe_dump(cfg, open(p, "w"), sort_keys=False, default_flow_style=False, width=200)
PY
      say "gh-dash keybindings removed"
    fi
    # The one tool uv owns rather than this script. Leaving it behind leaves an
    # environment nothing on the machine points at any more.
    if have uv && uv tool list 2>/dev/null | grep -q '^harlequin '; then
      uv tool uninstall harlequin >/dev/null 2>&1 && say "harlequin removed"
    fi
    say "managed config and helpers removed. binaries left in place, except"
    say "harlequin, which uv owns whole rather than as a file in $BIN"
    say "pi stays too, with its logins and sessions: npm uninstall -g @earendil-works/pi-coding-agent"
    ;;
  *) echo "usage: setup.sh [status|apply|outdated|upgrade|disable <component>|uninstall]"; exit 1 ;;
esac

}
