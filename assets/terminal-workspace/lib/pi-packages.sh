acstack_version() {
  json_field "$SCRIPT_DIR/../../.claude-plugin/plugin.json" version
}

# Installs one pi package, or moves its pin. Ownership is taken only when the
# package was absent: one the user installed stays theirs, pin and all.
pi_add() {  # pi_add <source> <identity>
  local cur
  cur=$(pi_state pkg "$2")
  if [ -n "$cur" ]; then
    # Unpinned, presence is enough: a pin the user chose stays.
    case "$1" in "$2"@*) ;; *) say "pi: $2 already installed"; return 0 ;; esac
    [ "$cur" = "$1" ] && { say "pi: $1 already installed"; return 0; }
  fi
  if ! pi install "$1" >/dev/null 2>&1; then
    say "pi: install of $1 failed, run: pi install $1"
    return 1
  fi
  if [ -n "$cur" ]; then
    pi_state pin "$2" "$cur" "$1"
    say "pi: $cur moved to $1"
  else
    pi_state own pkg "$2"
    say "pi: $1 installed"
  fi
}

# Puts back a pin apply moved, while the pin is still the one apply set.
pi_unpin() {  # pi_unpin <identity>
  local rec prior ours cur
  rec=$(pi_state pin-get "$1") || return 0
  prior="${rec%%$'\t'*}" ours="${rec#*$'\t'}"
  cur=$(pi_state pkg "$1")
  if [ "$cur" = "$ours" ]; then
    have pi || { say "pi: not on PATH, so $cur stays pinned"; return 0; }
    pi install "$prior" >/dev/null 2>&1 \
      || { say "pi: could not put back $prior, run: pi install $prior"; return 0; }
    say "pi: $cur put back to $prior"
  fi
  pi_state pin-forget "$1"
}

# Removes a package this setup installed. One the user installed is left.
pi_drop() {  # pi_drop <identity>
  local cur
  pi_state owns pkg "$1" || return 0
  cur=$(pi_state pkg "$1")
  if [ -n "$cur" ]; then
    have pi || { say "pi: not on PATH, so $cur stays installed"; return 0; }
    pi remove "$cur" >/dev/null 2>&1 || { say "pi: remove of $cur failed, run: pi remove $cur"; return 0; }
    say "pi: $cur removed"
  fi
  pi_state disown pkg "$1"
}

pi_npm_package() {  # pi_npm_package <name> -> npm package identity, or nothing
  version_table | awk -F'\t' -v n="$1" '$1==n && $2=="pi" && $3=="npm"{print "npm:" $4; found=1; exit} END{exit !found}'
}

# A package pi holds at a fixed version, such as npm:ac-teams@1.0.0.
pi_npm_pin() {  # pi_npm_pin <name>
  local pkg src
  pkg=$(pi_npm_package "$1") || return 1
  src=$(pi_state pkg "$pkg") || return 1
  [ "$src" != "$pkg" ]
}

# The pin apply would move to, or nothing when the installed one is current
# or newer. A newer pin is one the user chose, so it is never moved back.
pi_acstack_behind() {
  local cur ver pin
  ver=$(acstack_version); [ -n "$ver" ] || return 0
  cur=$(pi_state pkg "$PI_ACSTACK") || return 0
  case "$cur" in "$PI_ACSTACK"@*) pin="${cur##*@}" ;; *) return 0 ;; esac
  [ "$pin" = "$ver" ] && return 0
  [ "$(printf '%s\n%s\n' "$pin" "$ver" | sort -V | tail -1)" = "$ver" ] || return 0
  printf '%s\t%s' "$pin" "$ver"
}

bili_bin() {
  if [ -x "$PI_DIR/npm/node_modules/.bin/bili" ]; then
    printf '%s' "$PI_DIR/npm/node_modules/.bin/bili"
  elif have bili; then
    command -v bili
  else
    return 1
  fi
}

bili_status() {  # bili_status <bin> <client> -> installed|absent|unknown
  local line
  line=$("$1" plugin list 2>/dev/null | awk -v c="$2" '$1==c{print; exit}') || true
  [ -n "$line" ] || { echo unknown; return 0; }
  case "$line" in *"not installed"*) echo absent ;; *) echo installed ;; esac
}

bili_client() {  # bili_client install|remove <client>
  local op="$1" client="$2" bin marker status
  marker="bili:$client"
  if [ "$op" = "install" ]; then
    [ "$client" = "pi" ] || have "$client" || return 0
    pi_state owns file "$marker" && return 0
    if bin=$(bili_bin); then
      status=$(bili_status "$bin" "$client")
      if [ "$status" = "installed" ]; then
        say "pi: billion-context already enabled for $client"
        return 0
      fi
      if "$bin" plugin install "$client" >/dev/null 2>&1; then
        pi_state own file "$marker"
        say "pi: billion-context enabled for $client"
      else
        say "pi: billion-context $client setup failed, run: bili plugin install $client"
      fi
    else
      say "pi: bili command not found, so billion-context $client setup was skipped"
    fi
  elif pi_state owns file "$marker"; then
    if bin=$(bili_bin); then
      if "$bin" plugin remove "$client" >/dev/null 2>&1; then
        pi_state disown file "$marker"
        say "pi: billion-context disabled for $client"
      else
        say "pi: billion-context $client removal failed, run: bili plugin remove $client"
      fi
    else
      say "pi: bili command not found, so billion-context $client setup was left installed"
    fi
  fi
}

pi_question_bridge() {  # pi_question_bridge install|remove
  local fresh=0 rc
  if [ "$1" = "install" ]; then
    if { [ -e "$PI_QUESTION_BRIDGE" ] || [ -L "$PI_QUESTION_BRIDGE" ]; } \
        && ! pi_state owns file "$PI_QUESTION_BRIDGE"; then
      say "pi: $PI_QUESTION_BRIDGE already exists, so the question bridge was left alone"
      return 0
    fi
    [ -e "$PI_QUESTION_BRIDGE" ] || [ -L "$PI_QUESTION_BRIDGE" ] || fresh=1
    mkdir -p "$(dirname "$PI_QUESTION_BRIDGE")" \
      && cp "$SCRIPT_DIR/pi/acstack-question-blocked.ts" "$PI_QUESTION_BRIDGE" || return $?
    if pi_state own file "$PI_QUESTION_BRIDGE"; then
      say "pi: question blocked bridge written to $PI_QUESTION_BRIDGE"
    else
      rc=$?
      [ "$fresh" = 1 ] && rm -f "$PI_QUESTION_BRIDGE"
      say "pi: question blocked bridge ownership registration failed for $PI_QUESTION_BRIDGE"
      return "$rc"
    fi
  elif pi_state owns file "$PI_QUESTION_BRIDGE"; then
    rm -f "$PI_QUESTION_BRIDGE" \
      && pi_state disown file "$PI_QUESTION_BRIDGE" \
      && say "pi: question blocked bridge removed"
  fi
}

apply_pi() {
  find_pi
  if ! have pi; then
    have npm || {
      say "npm not installed, skipping pi"
      say "install Node.js, then run apply again"
      return 0
    }
    npm install -g @earendil-works/pi-coding-agent >/dev/null 2>&1 \
      || { say "pi install failed, run: npm install -g @earendil-works/pi-coding-agent"; return 0; }
    have pi || { say "pi installed, but npm's global bin is not on PATH"; return 0; }
    say "pi installed"
  fi
  # pi rewrites settings.json on every install. Handing it a file it cannot
  # parse risks the user's settings, so concede the whole component instead.
  if ! pi_state parses "$PI_SETTINGS"; then
    say "pi: $PI_SETTINGS does not parse, so nothing was installed into pi"
    say "fix that file, then run apply again"
    return 0
  fi

  patch_pi_win32_paste

  # Retire only setup-owned packages after their replacement is available.
  if pi_add npm:ac-teams npm:ac-teams; then
    pi_drop npm:pi-subagents
    pi_drop npm:@juicesharp/rpiv-todo
    pi_state merge "$PI_SUBAGENT_CFG" subagent '{"toolActivation": null}'
  fi
  if [ "$(cfg_get pi.plugin_manager true)" = "true" ]; then
    pi_add npm:pi-plugin-manager npm:pi-plugin-manager
  else
    pi_drop npm:pi-plugin-manager
  fi
  # bili's proxy dies with the session that started it, cutting off every
  # other Claude Code or Codex session. Keep it in pi; undo older installs.
  bili_client remove codex
  bili_client remove claude
  if [ "$(cfg_get pi.billion_context true)" = "true" ]; then
    pi_state merge "$BILLION_CONFIG" billion '{"pi.subagents": false}'
    if [ "$(json_field "$BILLION_CONFIG" pi.subagents)" = "False" ]; then
      pi_add "$PI_BILLION" "$PI_BILLION"
      bili_client install pi
    else
      say "pi: billion-context acp_delegate could not be disabled, so billion-context setup was skipped"
    fi
  else
    bili_client remove pi
    pi_state merge "$BILLION_CONFIG" billion '{"pi.subagents": null}'
    pi_drop "$PI_BILLION"
  fi
  if [ "$(cfg_get pi.question_tool true)" = "true" ]; then
    pi_add npm:@juicesharp/rpiv-ask-user-question npm:@juicesharp/rpiv-ask-user-question
    pi_question_bridge install
  else
    pi_question_bridge remove
    pi_drop npm:@juicesharp/rpiv-ask-user-question
  fi
  if [ "$(cfg_get pi.web_access true)" = "true" ]; then
    pi_add npm:pi-web-access npm:pi-web-access
  else
    pi_drop npm:pi-web-access
  fi
  if [ "$(cfg_get pi.lens false)" = "true" ]; then
    pi_add npm:pi-lens npm:pi-lens
  else
    pi_drop npm:pi-lens
  fi
  if [ "$(cfg_get pi.slash_anywhere true)" = "true" ]; then
    pi_add "$PI_SLASH_ANYWHERE" "$PI_SLASH_ANYWHERE"
  else
    pi_drop "$PI_SLASH_ANYWHERE"
  fi
  local old
  if old=$(pi_state pkg "$PI_ACSTACK_GIT"); then
    say "pi: $old serves old ACStack skills, run: pi remove $old"
  fi
  local ver cur; ver=$(acstack_version)
  if [ -n "$ver" ]; then
    if cur=$(pi_state pkg "$PI_ACSTACK") && [ -z "$(pi_acstack_behind)" ]; then
      say "pi: $cur already installed"
    else
      pi_add "$PI_ACSTACK@$ver" "$PI_ACSTACK"
    fi
  else
    say "pi: no plugin version beside this script, so ACStack was not installed into pi"
  fi
  if [ "$(cfg_get pi.compact_tools true)" = "true" ]; then
    pi_add npm:pi-compact-tools npm:pi-compact-tools
  else
    pi_drop npm:pi-compact-tools
  fi
  [ "$(cfg_get pi.settings.theme alex-mid-grey)" = "alex-mid-grey" ] && pi_write_theme
  if [ "$(cfg_get pi.zentui true)" = "true" ]; then
    pi_add "$PI_ZENTUI" "$PI_ZENTUI"
    pi_state merge "$PI_ZENTUI_CFG" zentui "$(pi_zentui_wanted)"
  else
    pi_state merge "$PI_ZENTUI_CFG" zentui "$(pi_zentui_release)"
    pi_drop "$PI_ZENTUI"
  fi
  if [ "$(cfg_get pi.hide_lens_lsp_status true)" = "true" ]; then
    pi_state merge "$PI_LENS_CFG" pi_lens '{"ui.hideLspStatus": true, "widget.visible": false}'
  else
    pi_state merge "$PI_LENS_CFG" pi_lens '{"ui.hideLspStatus": null, "widget.visible": null}'
  fi
  apply_lens_extra_tools

  # agentic-retro writes its own extension file. This setup only asks it to,
  # and owns the file only when it was not there before.
  if [ "$(cfg_get pi.agentic_retro true)" = "true" ]; then
    if have agentic-retro; then
      local fresh=0; [ -e "$PI_RETRO_EXT" ] || fresh=1
      if agentic-retro install-pi >/dev/null 2>&1; then
        [ "$fresh" = "1" ] && pi_state own file "$PI_RETRO_EXT"
        say "pi: agentic-retro extension written"
      else
        say "pi: agentic-retro install-pi failed, run it yourself"
      fi
    else
      say "pi: agentic-retro not on PATH, so its pi extension was skipped"
      say "install the agentic-retro plugin first, then run apply again"
    fi
  elif pi_state owns file "$PI_RETRO_EXT"; then
    rm -f "$PI_RETRO_EXT"
    pi_state disown file "$PI_RETRO_EXT"
    say "pi: agentic-retro extension removed"
  fi

  pi_state merge "$PI_SETTINGS" settings "$(pi_settings_wanted)"
  pi_state merge "$PI_KEYBINDINGS" keybindings '{"app.message.dequeue": "ctrl+enter"}'
  pi_state md write
  patch_pi_win32_paste
  patch_herdr_pi_status

  # Logging in is interactive and stores a credential, so it stays the user's.
  [ -f "$PI_DIR/auth.json" ] || say "pi: not logged in yet. Run pi, then /login"
  return 0
}

# disable pi and uninstall both come here. It undoes what apply_pi recorded
# and leaves the pi binary, its logins and its sessions alone.
remove_pi() {
  find_pi
  patch_herdr_pi_status --remove
  pi_question_bridge remove
  if pi_state parses "$PI_SETTINGS"; then
    pi_unpin "$PI_ACSTACK"
    pi_drop "$PI_ACSTACK"
    bili_client remove codex
    bili_client remove claude
    bili_client remove pi
    pi_drop "$PI_BILLION"
    pi_drop npm:pi-plugin-manager
    pi_drop npm:ac-teams
    pi_drop npm:@juicesharp/rpiv-todo
    pi_drop npm:pi-compact-tools
    pi_drop "$PI_ZENTUI"
    pi_drop npm:@juicesharp/rpiv-ask-user-question
    pi_drop npm:pi-web-access
    pi_drop npm:pi-lens
    pi_drop "$PI_SLASH_ANYWHERE"
    pi_drop npm:pi-subagents
  else
    say "pi: $PI_SETTINGS does not parse, so its packages were left installed"
  fi
  pi_state merge "$BILLION_CONFIG" billion '{"pi.subagents": null}'
  if pi_state owns file "$PI_RETRO_EXT"; then
    rm -f "$PI_RETRO_EXT"
    pi_state disown file "$PI_RETRO_EXT"
    say "pi: agentic-retro extension removed"
  fi
  pi_state merge "$PI_SETTINGS" settings \
    '{"hideThinkingBlock": null, "markdown.mermaid": null, "enableInstallTelemetry": null, "theme": null}'
  pi_state merge "$PI_ZENTUI_CFG" zentui "$(pi_zentui_release)"
  pi_state merge "$PI_LENS_CFG" pi_lens '{"ui.hideLspStatus": null, "widget.visible": null}'
  if pi_state owns file "$PI_THEME"; then
    rm -f "$PI_THEME"
    pi_state disown file "$PI_THEME"
    say "pi: ACStack theme removed"
  fi
  pi_state merge "$PI_KEYBINDINGS" keybindings '{"app.message.dequeue": null}'
  pi_state merge "$PI_SUBAGENT_CFG" subagent '{"toolActivation": null}'
  pi_state md strip
  return 0
}

# Every tool with a version worth comparing.
#   name | component key | source | reference | release asset match
# mermaid-ascii is deliberately absent: it has no version flag at all, so
# nothing here can read what is installed. `upgrade mermaid-ascii` still works,
# because upgrade_one carries an arm of its own for it. A tool that is in
# neither place is one upgrade cannot reach, whatever the docs promise.
