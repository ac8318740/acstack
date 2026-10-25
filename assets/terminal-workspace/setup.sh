#!/usr/bin/env bash
# ACStack terminal workspace setup.
#   setup.sh status     what is installed and enabled
#   setup.sh apply      install and configure everything enabled in the config
#   setup.sh outdated   what has a newer version, and what components are new
#   setup.sh upgrade    reinstall whatever outdated reported
#   setup.sh disable <herdr|delta|diffnav|gh_dash|harlequin|lazygit|neovim|pi|tuicr>
#   setup.sh uninstall  remove every managed block, keep the binaries
#
# Layout map:
#   config readers and shared helpers
#   installers and embedded acstack-* helper scripts
#   per-tool config writers
#   pi state, pi package, and pi config helpers
#   version, status, apply, upgrade, disable, and uninstall commands
#
# Idempotent. Only ever edits between managed markers, so hand-written config
# around it survives.
#
# Layout, top to bottom. Search for the name.
#   have, cfg_get, install_binary   shared plumbing
#   write_helpers    every mapflow-* script written to $BIN, each as a heredoc.
#                    About 1,800 lines; skip past it to reach the config steps.
#   apply_<tool>     one function per tool that writes its config, such as
#                    apply_herdr or apply_pi
#   pi_state         the Python helper that edits pi's JSON files
#   outdated_report, upgrade_one   version checks and upgrades
#   case "$ACTION"   the entry point, at the bottom. status, disable and
#                    uninstall are written inline there, so a change to one
#                    tool usually touches its apply_<tool>, its status line
#                    and its disable branch.
set -uo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]:-$0}")" && pwd)"

CFG="${ACSTACK_TW_CONFIG:-$HOME/.config/acstack/terminal-workspace.yaml}"
BIN="${ACSTACK_TW_BIN:-$HOME/.local/bin}"
# Everything installs into $BIN, and the config steps then ask `have <tool>`
# whether it worked. On a fresh machine $BIN is not on PATH yet, so without
# this every tool installs and every config step is skipped.
# herdr's own installer always targets ~/.local/bin, which is only the same
# as $BIN when ACSTACK_TW_BIN is left alone. Cover both.
PATH="$BIN:$HOME/.local/bin:$PATH"
HERDR_CFG="$HOME/.config/herdr/config.toml"
GHDASH_CFG="$HOME/.config/gh-dash/config.yml"
# LazyVim loads every file under lua/plugins, so a file of our own is a
# complete plugin spec. Nothing of the user's is edited to install it.
NVIM_PLUGIN="$HOME/.config/nvim/lua/plugins/acstack.lua"
NVIM_MARK="Written by acstack terminal-workspace"
BEGIN="# >>> acstack terminal-workspace >>>"
END="# <<< acstack terminal-workspace <<<"
# pi keeps every config file under one agent directory, and honours an
# override for it.
PI_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
PI_SETTINGS="$PI_DIR/settings.json"
PI_KEYBINDINGS="$PI_DIR/keybindings.json"
PI_QUESTION_BRIDGE="$PI_DIR/extensions/acstack-question-blocked.ts"
PI_SUBAGENT_CFG="$PI_DIR/extensions/subagent/config.json"
# agentic-retro install-pi picks its own directory, from $PI_HOME rather than
# pi's override, so look where it writes.
PI_RETRO_EXT="${PI_HOME:-$HOME/.pi}/agent/extensions/agentic-retro.ts"
PI_ACSTACK="npm:acstack"
PI_ACSTACK_GIT="git:github.com/ac8318740/spechub"
PI_BILLION="npm:billion-context"
BILLION_CONFIG="$HOME/.config/billion-context/billion-context.json"
PI_SLASH_ANYWHERE="npm:pi-slash-anywhere"
PI_ZENTUI="npm:pi-zentui"
PI_ZENTUI_CFG="$PI_DIR/zentui.json"
PI_THEME_DIR="$PI_DIR/themes"
PI_THEME="$PI_THEME_DIR/alex-mid-grey.json"
PI_LENS_CFG="$HOME/.pi-lens/config.json"
# A line starting with # is a heading in markdown, and the model reads it. An
# HTML comment carries the same marker and renders as nothing.
PI_MD_BEGIN="<!-- >>> acstack terminal-workspace >>> -->"
PI_MD_END="<!-- <<< acstack terminal-workspace <<< -->"
PI_DELEGATION="When an ACStack skill or the ACStack orchestrator says to launch a subagent, you may delegate to it."


. "$SCRIPT_DIR/lib/core.sh"
. "$SCRIPT_DIR/lib/helper-install.sh"
. "$SCRIPT_DIR/lib/apply-herdr.sh"
. "$SCRIPT_DIR/lib/apply-tuicr.sh"
. "$SCRIPT_DIR/lib/apply-herdr-numbers.sh"
. "$SCRIPT_DIR/lib/apply-yazi.sh"
. "$SCRIPT_DIR/lib/apply-tools.sh"
. "$SCRIPT_DIR/lib/apply-ghdash.sh"
. "$SCRIPT_DIR/lib/pi-state.sh"
. "$SCRIPT_DIR/lib/pi-packages.sh"
. "$SCRIPT_DIR/lib/versions.sh"
. "$SCRIPT_DIR/lib/commands.sh"

if [ "${ACSTACK_TW_NO_MAIN:-0}" != "1" ] && [ "${BASH_SOURCE[0]:-$0}" = "$0" ]; then
  acstack_tw_main "$@"
fi
