#!/bin/sh
# Startup context is independent of project activation and selected output style.
set -eu
root="${CLAUDE_PLUGIN_ROOT:-}"
[ -n "$root" ] || root="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
exec node "$root/hooks/communication-standard.mjs" "$root"
