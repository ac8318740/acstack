#!/usr/bin/env bash
# Offline package checks. ACSTACK_TEST_CODEX=1 adds native Codex install/hook discovery (no auth/LLM).
set -eu
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "$SCRIPT_DIR/codex-plugin-harness.mjs" "$@"
