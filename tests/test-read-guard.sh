#!/usr/bin/env bash
# Tests the large-read guard: the shared policy in hooks/lib/read-guard.mjs and
# the Claude Code and Codex hook in hooks/read-guard.mjs. The Pi handler is
# covered by tests/test-pi-extension.sh.
#
# Run it:  bash tests/test-read-guard.sh
# Exit code is 0 when every check passes, 1 otherwise.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HARNESS="${SCRIPT_DIR}/read-guard-harness.mjs"
CHECKS=92

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

out="$(TMPDIR="$WORK" ACSTACK_HOME="$WORK/acstack-home" XDG_CONFIG_HOME="$WORK/config" XDG_DATA_HOME="$WORK/share" node --no-warnings "$HARNESS" 2>&1)"
status=$?

pass=0
fail=0
while IFS= read -r line; do
  case "$line" in
    "ok "*)     printf '  \033[32mPASS\033[0m %s\n' "${line#ok }"; pass=$((pass + 1)) ;;
    "not ok "*) printf '  \033[31mFAIL\033[0m %s\n' "${line#not ok }"; fail=$((fail + 1)) ;;
    *)          [ -n "$line" ] && printf '  %s\n' "$line" ;;
  esac
done <<<"$out"

# A crash part-way, or a check that never ran, is a failure too.
if [ "$status" -ne 0 ] || [ $((pass + fail)) -ne "$CHECKS" ]; then
  printf '  \033[31mFAIL\033[0m harness ran %d of %d checks (exit %d)\n' $((pass + fail)) "$CHECKS" "$status"
  fail=$((fail + 1))
fi

echo ""
echo "----------------------------------------"
printf 'Result: %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || exit 1
