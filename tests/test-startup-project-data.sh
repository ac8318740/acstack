#!/usr/bin/env bash
set -eu
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/home"
HOME="$WORK/home" ACSTACK_TEST_WORK="$WORK" node --no-warnings "$SCRIPT_DIR/startup-project-data-harness.mjs"
