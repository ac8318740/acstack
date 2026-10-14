apply_markdown() {
  [ "$(cfg_get markdown.enabled true)" = "true" ] || return 0
  install_binary mermaid-ascii AlexanderGrooff/mermaid-ascii Linux_x86_64
  install_binary glow charmbracelet/glow Linux_x86_64
  # Vendored so the preview page pulls nothing from a CDN: it works offline,
  # and on a managed laptop there is no third-party fetch to explain.
  local share="$HOME/.local/share/acstack"
  mkdir -p "$share"
  if [ ! -s "$share/mermaid.min.js" ]; then
    curl -fsSL -o "$share/mermaid.min.js" \
      "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js" \
      && say "mermaid.js vendored to $share" \
      || say "mermaid.js download failed, the preview will fall back to a CDN"
  fi
  python3 -c 'import markdown' 2>/dev/null \
    || say "acstack-md --serve needs python markdown: pip install --user markdown"
  have chafa || say "optional: apt install chafa, to draw images as text"
}

# The plugin file's name is ours by convention alone, and the directory around
# it is the user's. A file of that name this script did not write is theirs,
# so apply must not overwrite it and disable must not delete it. It says so
# where it refuses, so both paths report it the same way.
nvim_ours() {
  [ ! -e "$NVIM_PLUGIN" ] && return 0
  grep -q "$NVIM_MARK" "$NVIM_PLUGIN" 2>/dev/null && return 0
  say "neovim: $NVIM_PLUGIN was written by hand, left alone"
  return 1
}

# The dot is appended to LazyVim's lualine section, and LazyVim loads every
# file under lua/plugins. So a lualine override the user wrote in a file of
# their own does exactly what this component does, and installing on top of it
# draws two dots side by side. Print the file that already does it, if any.
nvim_dot_elsewhere() {
  local dir="$HOME/.config/nvim/lua/plugins" f
  [ -d "$dir" ] || return 1
  for f in "$dir"/*.lua; do
    [ -e "$f" ] || continue
    [ "$f" = "$NVIM_PLUGIN" ] && continue
    # Both, not either: a lualine override that says nothing about a modified
    # buffer is not this dot, and neither is a modified check outside lualine.
    grep -q 'lualine' "$f" 2>/dev/null || continue
    grep -q 'vim\.bo\.modified' "$f" 2>/dev/null || continue
    printf '%s\n' "$f"
    return 0
  done
  return 1
}

# Print the first lua file of the user's own that sets a pattern, ignoring
# comment lines, since a setting tried and commented out decides nothing.
nvim_user_sets() {
  local f
  while IFS= read -r f; do
    grep -v '^[[:space:]]*--' "$f" 2>/dev/null | grep -q "$1" || continue
    printf '%s\n' "$f"
    return 0
  done < <(find "$HOME/.config/nvim" -name '*.lua' ! -path "$NVIM_PLUGIN" 2>/dev/null | sort)
  return 1
}

# The clipboard part of the plugin file. The comment inside it says why.
NVIM_CLIPBOARD_LUA='
-- Over SSH, neovim finds no clipboard and :%y+ fails. Copy goes out over
-- OSC 52, which asks the terminal you sit at to put the text on its own
-- clipboard. Paste replays what this neovim copied last, because Windows
-- Terminal refuses OSC 52 reads. Use the terminal paste key for anything else.
local function set(v)
  return v ~= nil and v ~= ""
end
if not (set(vim.env.DISPLAY) or set(vim.env.WAYLAND_DISPLAY) or set(vim.env.TMUX)
    or vim.fn.has("mac") == 1 or vim.fn.has("wsl") == 1) then
  local osc52 = require("vim.ui.clipboard.osc52")
  local last = {}
  local function copy(reg)
    local send = osc52.copy(reg)
    return function(lines, regtype)
      last[reg] = { lines, regtype }
      send(lines)
    end
  end
  local function paste(reg)
    return function()
      return last[reg] or { { "" }, "v" }
    end
  end
  vim.g.clipboard = {
    name = "OSC 52 (acstack)",
    copy = { ["+"] = copy("+"), ["*"] = copy("*") },
    paste = { ["+"] = paste("+"), ["*"] = paste("*") },
  }
'
# LazyVim empties clipboard over SSH, then restores that value on VeryLazy.
# Scheduled, this runs after the restore, so a plain y copies too. It is left
# out when the user sets clipboard themselves.
NVIM_UNNAMEDPLUS_LUA='  vim.api.nvim_create_autocmd("User", {
    pattern = "VeryLazy",
    once = true,
    callback = function()
      vim.schedule(function()
        if vim.o.clipboard == "" then
          vim.opt.clipboard = "unnamedplus"
        end
      end)
    end,
  })
'

apply_neovim() {
  # The one component that is off unless asked for. Every other one writes
  # files this setup owns end to end, or a marked region inside a config that
  # invites one. A neovim config is neither: the user built it, so this waits.
  [ "$(cfg_get neovim.enabled false)" = "true" ] || return 0
  # The dot appends to LazyVim's own lualine section, and the clipboard undoes
  # a LazyVim default, so both mean nothing on a config that is not LazyVim.
  # Two markers, because a LazyVim config never opened has no plugins yet.
  if ! grep -q LazyVim "$HOME/.config/nvim/lua/config/lazy.lua" 2>/dev/null \
     && [ ! -d "$HOME/.local/share/nvim/lazy/LazyVim" ]; then
    say "neovim: no LazyVim config on this machine, plugin file not written"
    return 0
  fi
  nvim_ours || return 0

  local dot_spec="" clip_lua="" mine
  if mine="$(nvim_dot_elsewhere)"; then
    say "neovim: $mine already marks a modified buffer in lualine."
    # nvim_ours has already run, so a file at this path is one we wrote. A user
    # who installed first and wrote their own override later would otherwise
    # keep both, which is the pair of dots this guard exists to prevent.
    if grep -q 'vim\.bo\.modified' "$NVIM_PLUGIN" 2>/dev/null; then
      say "     The dot this component wrote was removed, so only one is drawn."
    else
      say "     The dot was not written. Two would be drawn side by side."
    fi
    say "     Delete $mine to hand the dot back to this component."
  else
    local dot; dot="$(cfg_get neovim.unsaved_dot_color '#f38ba8')"
    dot_spec="$(cat <<H

-- LazyVim marks an unsaved buffer by recolouring the filename and nothing
-- else, because its pretty_path component sets modified_sign = "". A glance
-- at the statusline then cannot tell a saved buffer from an unsaved one.
-- This appends a dot to the same section, which can.
return {
  {
    "nvim-lualine/lualine.nvim",
    opts = function(_, opts)
      table.insert(opts.sections.lualine_c, {
        function()
          return vim.bo.modified and "●" or ""
        end,
        color = { fg = "$dot" },
      })
    end,
  },
}
H
)"
  fi

  if [ "$(cfg_get neovim.osc52_clipboard true)" = "true" ]; then
    # Whichever lua sets vim.g.clipboard last wins, and the user's own files
    # load after ours, so ours would only add a forced clipboard option.
    if mine="$(nvim_user_sets 'g\.clipboard')"; then
      say "neovim: $mine already sets vim.g.clipboard."
      if grep -q 'vim\.g\.clipboard' "$NVIM_PLUGIN" 2>/dev/null; then
        say "     The OSC 52 copy this component wrote was removed."
      else
        say "     The OSC 52 copy was not written."
      fi
    else
      clip_lua="$NVIM_CLIPBOARD_LUA"
      if mine="$(nvim_user_sets '[.]o[pt]*[.]clipboard')"; then
        say "neovim: $mine sets clipboard, so y keeps the value set there"
      else
        clip_lua="$clip_lua$NVIM_UNNAMEDPLUS_LUA"
      fi
      clip_lua="${clip_lua}end
"
    fi
  fi

  if [ -z "$dot_spec$clip_lua" ]; then
    rm -f "$NVIM_PLUGIN"
    return 0
  fi
  mkdir -p "$(dirname "$NVIM_PLUGIN")"
  {
    printf -- '-- %s. Remove it with: setup.sh disable neovim\n' "$NVIM_MARK"
    printf '%s' "$clip_lua"
    # Every file under lua/plugins must return a spec, even an empty one.
    if [ -n "$dot_spec" ]; then printf '%s\n' "$dot_spec"; else printf '\nreturn {}\n'; fi
  } > "$NVIM_PLUGIN"
  [ -n "$dot_spec" ] && say "neovim: unsaved-changes dot written to $NVIM_PLUGIN"
  [ -n "$clip_lua" ] && say "neovim: OSC 52 copy written to $NVIM_PLUGIN"
  return 0
}

apply_delta() {
  have delta || { say "delta not installed, skipping git pager"; return 0; }
  [ "$(cfg_get delta.set_git_pager true)" = "true" ] || { say "delta: git pager left alone"; return 0; }
  git config --global core.pager delta
  git config --global interactive.diffFilter "delta --color-only"
  git config --global delta.navigate true
  git config --global delta.line-numbers true
  git config --global merge.conflictstyle zdiff3
  say "delta set as git pager"
}

apply_remote() {
  # A VM reached over SSH has no display and no clipboard of its own, so
  # anything that shells out to xclip fails. Put an xclip on PATH that speaks
  # OSC 52 to the terminal at the far end instead.
  [ "$(cfg_get remote.clipboard_shim true)" = "true" ] || {
    say "clipboard: xclip stand-in not installed"; return 0; }
  local real
  # Only when the machine has neither a real xclip nor a display for one to
  # talk to. Shadowing a working clipboard would be a downgrade. A stand-in
  # this script wrote before is not a real one, wherever it turns up.
  real="$(command -v xclip 2>/dev/null)"
  if [ -n "$real" ] && ! grep -q "Installed by acstack" "$real" 2>/dev/null; then
    say "clipboard: real xclip at $real, stand-in not installed"
    return 0
  fi
  if [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
    say "clipboard: this machine has a display, stand-in not installed"
    return 0
  fi
  cp "$SCRIPT_DIR/helpers/xclip" "$BIN/xclip"
  chmod +x "$BIN/xclip"
  say "clipboard: xclip stand-in written, copying over OSC 52"
}

apply_harlequin() {
  # uv is astral's python installer. harlequin is a python program, so there is
  # no release tarball to unpack: uv builds it an environment of its own and
  # links one command into ~/.local/bin. Nothing else here needs uv, so a
  # machine without it loses this component and keeps the rest.
  have uv || {
    say "uv not installed, skipping harlequin"
    say "install it with: curl -LsSf https://astral.sh/uv/install.sh | sh"
    return 0
  }
  local a adapters missing=0
  adapters=$(cfg_get_list harlequin.adapters "postgres snowflake")
  local -a with=()
  for a in $adapters; do with+=(--with "harlequin-$a"); done

  # uv records what it installed in a receipt beside the environment.
  # `uv tool install` on an already-installed tool does nothing at all, so an
  # adapter added to the config would never arrive without --force. Compare the
  # receipt against the config and force only when they differ.
  local receipt="${UV_TOOL_DIR:-$HOME/.local/share/uv/tools}/harlequin/uv-receipt.toml"
  if have harlequin && [ -f "$receipt" ]; then
    for a in $adapters; do
      grep -q "name = \"harlequin-$a\"" "$receipt" || missing=1
    done
    [ "$missing" = "0" ] && { say "harlequin already installed"; return 0; }
    say "harlequin: adapters changed, reinstalling"
    uv tool install --force harlequin "${with[@]}" >/dev/null 2>&1 \
      && say "harlequin reinstalled with: $(echo $adapters)" \
      || say "harlequin reinstall failed, run: uv tool install --force harlequin"
    return 0
  fi
  uv tool install harlequin "${with[@]}" >/dev/null 2>&1 \
    && say "harlequin installed with: $(echo $adapters)" \
    || say "harlequin install failed, run: uv tool install harlequin"
}

apply_lens_extra_tools() {
  # A small machine-wide pi-lens toolbelt for common project ecosystems.
  # Pi-lens can fall back to npx or prompt for some tools, but putting these
  # on PATH makes them available in any repo without per-project setup.
  if [ "$(cfg_get pi.lens_extra_tools.python false)" = "true" ]; then
    install_uv_tool black black
    install_uv_tool mypy mypy
    install_npm_tool pyright pyright
  fi
  if [ "$(cfg_get pi.lens_extra_tools.docker false)" = "true" ]; then
    install_plain_github_binary hadolint hadolint/hadolint Linux-x86_64
    install_npm_tool docker-langserver dockerfile-language-server-nodejs
  fi
  if [ "$(cfg_get pi.lens_extra_tools.github_actions false)" = "true" ]; then
    install_binary actionlint rhysd/actionlint linux_amd64
    install_uv_tool zizmor zizmor
  fi
  if [ "$(cfg_get pi.lens_extra_tools.terraform false)" = "true" ]; then
    install_binary terraform-ls hashicorp/terraform-ls linux_amd64
    install_binary tflint terraform-linters/tflint linux_amd64
    install_plain_github_binary terragrunt gruntwork-io/terragrunt linux_amd64
  fi
}
