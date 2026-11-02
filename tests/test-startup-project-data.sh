#!/usr/bin/env bash
set -eu
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/home"
HOME="$WORK/home" ACSTACK_HOME="$WORK/acstack" XDG_CONFIG_HOME="$WORK/config" XDG_DATA_HOME="$WORK/share" \
  ACSTACK_TEST_WORK="$WORK" PI_SUBAGENT_CHILD= PI_SUBAGENTS_HERDR_BRIDGE= AC_TEAMS_MEMBER= \
  node --no-warnings "$SCRIPT_DIR/startup-project-data-harness.mjs"
