#!/usr/bin/env bash
# Offline npm package checks. Opt into the installed Codex parser with ACSTACK_TEST_CODEX=1.
set -eu
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "$SCRIPT_DIR/codex-plugin-harness.mjs" "$@"
