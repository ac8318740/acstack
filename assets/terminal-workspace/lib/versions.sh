version_table() {
  cat <<'T'
delta	delta	github	dandavison/delta	x86_64-unknown-linux-gnu
diffnav	diffnav	github	dlvhdr/diffnav	Linux_x86_64
fzf	diffnav	github	junegunn/fzf	linux_amd64
lazygit	lazygit	github	jesseduffield/lazygit	linux_x86_64
tuicr	tuicr	github	agavra/tuicr	x86_64-unknown-linux-gnu
yazi	yazi	github	sxyazi/yazi	x86_64-unknown-linux-gnu
glow	markdown	github	charmbracelet/glow	Linux_x86_64
herdr	herdr	herdr	-	-
gh-dash	gh_dash	ghext	dlvhdr/gh-dash	-
harlequin	harlequin	pypi	harlequin	-
pi	pi	npm	@earendil-works/pi-coding-agent	-
pi-subagents	pi	npm	pi-subagents	-
billion-context	pi	npm	billion-context	-
@juicesharp/rpiv-todo	pi	npm	@juicesharp/rpiv-todo	-
pi-plugin-manager	pi	npm	pi-plugin-manager	-
@juicesharp/rpiv-ask-user-question	pi	npm	@juicesharp/rpiv-ask-user-question	-
pi-web-access	pi	npm	pi-web-access	-
pi-lens	pi	npm	pi-lens	-
pi-slash-anywhere	pi	npm	pi-slash-anywhere	-
pi-compact-tools	pi	npm	pi-compact-tools	-
pi-zentui	pi	npm	pi-zentui	-
actionlint	pi	github	rhysd/actionlint	linux_amd64
hadolint	pi	github	hadolint/hadolint	Linux-x86_64
terraform-ls	pi	github	hashicorp/terraform-ls	linux_amd64
tflint	pi	github	terraform-linters/tflint	linux_amd64
terragrunt	pi	github	gruntwork-io/terragrunt	linux_amd64
T
}

installed_version() {  # installed_version <name> -> a bare version, or nothing
  local v=""
  case "$1" in
    # delta 0.19.2
    delta)     v=$(delta --version 2>/dev/null | awk '{print $2}') ;;
    # an ASCII banner, then: version v0.12.0
    diffnav)   v=$(diffnav --version 2>/dev/null | sed -n 's/^version //p') ;;
    # 0.74.3 (15f64c49)
    fzf)       v=$(fzf --version 2>/dev/null | awk '{print $1}') ;;
    # commit=..., version=0.64.1, os=linux, arch=amd64, git version=2.43.0
    # Split on the commas first: the line ends in git's own version, and one
    # regex over the whole line reads that one instead of lazygit's.
    lazygit)   v=$(lazygit --version 2>/dev/null | tr ',' '\n' | sed -n 's/^ *version=//p') ;;
    # glow version 3.0.0 (add5e7a)
    glow)      v=$(glow --version 2>/dev/null | awk '{print $3}') ;;
    # tuicr 0.23.0
    tuicr)     v=$(tuicr --version 2>/dev/null | awk '{print $2}') ;;
    # a block of lines, one of them: "    Version: 26.8.15 (1f3588d 2026-08-15)"
    yazi)      v=$(yazi --version 2>/dev/null | sed -n 's/^ *Version: \([^ ]*\).*/\1/p') ;;
    # herdr 0.8.2
    herdr)     v=$(herdr --version 2>/dev/null | awk '{print $2}') ;;
    # gh dash<TAB>dlvhdr/gh-dash<TAB>v4.25.2
    gh-dash)   v=$(gh extension list 2>/dev/null | awk -F'\t' '$2=="dlvhdr/gh-dash"{print $3}') ;;
    # harlequin v2.13.0, then an indented line per command it installed
    harlequin) v=$(uv tool list 2>/dev/null | awk '$1=="harlequin"{print $2}') ;;
    # 1.1.0
    pi)        find_pi; v=$(pi --version 2>/dev/null | awk '{print $NF}') ;;
    # actionlint version 1.7.7
    actionlint) v=$(actionlint -version 2>/dev/null | awk '{print $2}') ;;
    # Haskell Dockerfile Linter 2.12.0
    hadolint)  v=$(hadolint --version 2>/dev/null | awk '{print $NF}') ;;
    # terraform-ls version 0.36.5
    terraform-ls) v=$(terraform-ls version 2>/dev/null | awk '{print $2}') ;;
    # TFLint version 0.59.1
    tflint)    v=$(tflint --version 2>/dev/null | awk 'NR==1{print $3}') ;;
    # terragrunt version v0.91.2
    terragrunt) v=$(terragrunt --version 2>/dev/null | awk '{print $NF}') ;;
    # pi installs npm packages under its own directory, not npm's global one.
    *) if pkg=$(pi_npm_package "$1"); then
         v=$(json_field "$PI_DIR/npm/node_modules/${pkg#npm:}/package.json" version)
       fi ;;
  esac
  printf '%s' "${v#v}"
}

# One JSON field, by dotted path, read from a file. install_binary hands its
# release document to python through the environment; this one cannot, because
# herdr's manifest carries a whole changelog and a document that size overflows
# the environment an exec is allowed. A file has no such ceiling.
json_field() {  # json_field <file> <dotted.path>
  py "$1" "$2" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except (ValueError, OSError):
    raise SystemExit
for k in sys.argv[2].split("."):
    d = d.get(k) if isinstance(d, dict) else None
    if d is None: raise SystemExit
print(d)
PY
}

latest_version() {  # latest_version <source> <reference> -> a version, or nothing
  [ "${ACSTACK_TW_OFFLINE:-0}" = "1" ] && return 0
  local url field tmp v="" tok="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
  local -a auth=()
  case "$1" in
    github|ghext)
      url="https://api.github.com/repos/$2/releases/latest"; field=tag_name
      # An unauthenticated GitHub call gets 60 an hour, shared with everything
      # else on the machine. Ten tools in one run is a sixth of that. A token
      # raises it to 5000 and costs nothing to pass. It goes to GitHub and
      # nowhere else: the two hosts below never see it.
      [ -n "$tok" ] && auth=(-H "Authorization: Bearer $tok") ;;
    # herdr publishes its own manifest, and `herdr update` installs from it.
    herdr) url="https://herdr.dev/latest.json"; field=version ;;
    pypi)  url="https://pypi.org/pypi/$2/json"; field=info.version ;;
    # A scoped name keeps its @ and escapes its slash.
    npm)   url="https://registry.npmjs.org/${2/\//%2F}/latest"; field=version ;;
    *) return 0 ;;
  esac
  tmp=$(mktemp)
  curl -sSf "${auth[@]}" --max-time 10 "$url" -o "$tmp" 2>/dev/null \
    && v=$(json_field "$tmp" "$field")
  rm -f "$tmp"
  printf '%s' "${v#v}"
}

outdated_report() {  # tab-separated rows on stdout, one per finding
  local name key src ref inst latest
  # Components that arrived since the last apply. See write_stamp for why this
  # reads the stamp rather than the user's own config: a config that overrides
  # four keys and defaults the rest is normal, and diffing against it would
  # report every defaulted component as new.
  if [ ! -f "$STAMP" ]; then
    # No stamp and no managed block is a machine apply has never touched.
    # Comparing versions there would report a workspace as current when none
    # of it is installed, so say the one true thing and stop.
    if ! grep -q "$BEGIN" "$HERDR_CFG" 2>/dev/null; then
      printf 'missing\tworkspace\tnever applied on this machine\n'
      return 0
    fi
    printf 'unknown\tcomponents\tno stamp yet, run apply once\n'
  elif [ -f "$EXAMPLE" ]; then
    # The row stays until apply installs the component and writes a new stamp.
    # Only the detail moves: once upgrade has appended the block, "not in your
    # config" is false, and a report that says it is stops being worth reading.
    ACSTACK_STAMP="$STAMP" py "$EXAMPLE" "$CFG" <<'PY'
import os, re, sys
import yaml
had = {l.strip() for l in open(os.environ["ACSTACK_STAMP"])
       if l.strip() and not l.startswith("#")}
mine = open(sys.argv[2]).read() if os.path.isfile(sys.argv[2]) else ""
for k in (yaml.safe_load(open(sys.argv[1])) or {}):
    if k in had:
        continue
    if re.search(r"(?m)^%s:" % re.escape(k), mine):
        print("new\t%s\tnew component, run apply to install it" % k)
    else:
        print("new\t%s\tnew component, not in your config" % k)
PY
  fi

  while IFS=$'\t' read -r name key src ref _; do
    [ "$(cfg_get "$key.enabled" "$(enabled_default "$key")")" = "true" ] || continue
    # A fork build's version comes from a local checkout, so a release tag says
    # nothing about it.
    [ "$name" = "tuicr" ] && [ "$(cfg_get tuicr.build_from_fork false)" = "true" ] && continue
    # pi update never moves a pinned npm source, so a newer release is nothing
    # upgrade could fetch. Say so once instead of reporting it stale forever.
    if pi_npm_pin "$name"; then
      printf 'unknown\t%s\tpinned to %s in pi, which pi update never moves\n' "$name" "$(pi_state pkg "$(pi_npm_package "$name")")"
      continue
    fi
    inst=$(installed_version "$name")
    [ -n "$inst" ] || continue          # not installed is apply's business, not this one
    latest=$(latest_version "$src" "$ref")
    if [ -z "$latest" ]; then
      [ "${ACSTACK_TW_OFFLINE:-0}" = "1" ] \
        || printf 'unknown\t%s\tcould not reach %s\n' "$name" "$src"
    elif [ "$inst" != "$latest" ]; then
      printf 'stale\t%s\t%s -> %s\n' "$name" "$inst" "$latest"
    fi
  done < <(version_table)

  # The ACStack package on pi is pinned to a release, so it falls behind the
  # moment this plugin updates. Both versions are local, so this needs no
  # network and reports even offline.
  if [ "$(cfg_get pi.enabled false)" = "true" ]; then
    local behind; behind=$(pi_acstack_behind)
    [ -n "$behind" ] && printf 'stale\tpi-acstack\t%s -> %s\n' "${behind%%$'\t'*}" "${behind#*$'\t'}"
  fi
}

# Reinstalls over what is there, from the coordinates the table already holds.
# Split out so the tuicr arm can guard the fork build and still reach it,
# rather than carrying a second copy of the repository and the asset match.
upgrade_from_table() {  # upgrade_from_table <name>
  local repo match
  read -r repo match < <(version_table | awk -F'\t' -v n="$1" '$1==n{print $4, $5}')
  [ -n "${repo:-}" ] && [ "$repo" != "-" ] \
    || { say "$1 is not a tool this script installs"; return 1; }
  INSTALL_FORCE=1 install_binary "$1" "$repo" "$match"
  # yazi's archive carries ya beside it, and the two must not drift.
  if [ "$1" = "yazi" ]; then
    INSTALL_FORCE=1 install_binary ya sxyazi/yazi "$match"
  fi
}

upgrade_one() {  # upgrade_one <name>
  if [ "$1" = "pi-acstack" ] || pi_npm_package "$1" >/dev/null; then
    find_pi
  fi
  case "$1" in
    herdr)     herdr update >/dev/null 2>&1 \
                 && say "herdr updated" || say "herdr update failed" ;;
    gh-dash)   gh extension upgrade dlvhdr/gh-dash >/dev/null 2>&1 \
                 && say "gh-dash upgraded" || say "gh-dash upgrade failed" ;;
    harlequin) uv tool upgrade harlequin >/dev/null 2>&1 \
                 && say "harlequin upgraded" || say "harlequin upgrade failed" ;;
    # With no target, pi update updates pi itself and no package.
    pi)        if pi update >/dev/null 2>&1; then
                 say "pi updated"
                 patch_pi_win32_paste
               else
                 say "pi update failed"
               fi ;;
    # Only a pin behind this plugin. A newer pin is the user's choice, and an
    # absent or unpinned ACStack is apply's business.
    pi-acstack)
      [ -n "$(pi_acstack_behind)" ] || { say "pi-acstack: nothing behind this plugin to move"; return 0; }
      pi_add "$PI_ACSTACK@$(acstack_version)" "$PI_ACSTACK" ;;
    # Absent from the table, because it has no version flag for outdated to
    # read. Naming it is the only way to refresh it, so the arm it needs is
    # here rather than behind a table lookup that will never find it.
    mermaid-ascii)
      INSTALL_FORCE=1 install_binary mermaid-ascii AlexanderGrooff/mermaid-ascii Linux_x86_64 ;;
    hadolint)
      INSTALL_FORCE=1 install_plain_github_binary hadolint hadolint/hadolint Linux-x86_64 ;;
    terragrunt)
      INSTALL_FORCE=1 install_plain_github_binary terragrunt gruntwork-io/terragrunt linux_amd64 ;;
    # The fork build comes from a local checkout, so a release archive would
    # replace it with the stock binary and silently drop the patches it carries.
    # outdated already skips it; naming it here has to skip it too.
    tuicr)
      if [ "$(cfg_get tuicr.build_from_fork false)" = "true" ]; then
        say "tuicr is built from a fork here, so run apply to rebuild it"
        return 0
      fi
      upgrade_from_table tuicr ;;
    *) if pkg=$(pi_npm_package "$1"); then
         if pi_npm_pin "$1"; then
           say "$1 is pinned to $(pi_state pkg "$pkg") in pi, which pi update never moves"
           return 0
         fi
         pi update "$pkg" >/dev/null 2>&1 \
           && say "$1 updated" || say "$1 update failed"
       else
         upgrade_from_table "$1"
       fi ;;
  esac
}
