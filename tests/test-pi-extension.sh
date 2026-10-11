#!/usr/bin/env bash
# Local test harness for pi/extension.ts, the pi port of the hooks.
#
# tests/pi-extension-harness.mjs loads the extension with a stub pi API and
# drives each handler: the CLI symlinks, the pi-subagents warning, the
# orchestrator injection, the writing style toggle, the context-pressure
# ladder, the handoff reload, and the subagent-child guard. The writing-style
# reminder, the nudges and the handoff message are each checked against the
# Claude hook's own output.
#
# Node loads the TypeScript directly by stripping the types, which needs Node
# 22.18 or later. On an older Node every check is skipped, not failed. CI runs
# this suite on Node 22 in its own job.
#
# Run it:  bash tests/test-pi-extension.sh
# Exit code is 0 when every check passes, 1 otherwise.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HARNESS="${SCRIPT_DIR}/pi-extension-harness.mjs"
CHECKS=44

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "Testing: ${SCRIPT_DIR}/../pi/extension.ts"
echo "Workdir: $WORK"
echo ""

if [ "$(node -p 'process.features.typescript || ""' 2>/dev/null)" != "strip" ]; then
  echo "  SKIP node $(node --version 2>/dev/null || echo missing) cannot strip TypeScript types"
  echo ""
  echo "----------------------------------------"
  printf 'Result: 0 passed, 0 failed, %d skipped\n' "$CHECKS"
  exit 0
fi

mkdir -p "$WORK/home" "$WORK/tmp" "$WORK/projects"

# A PATH with node and the basics, and no spechub, so the human symlink is ours
# to create.
node_dir="$(dirname "$(command -v node)")"
out="$(
  HOME="$WORK/home" TMPDIR="$WORK/tmp" PATH="${node_dir}:/usr/bin:/bin" \
    SPECHUB_TEST_WORK="$WORK/projects" PI_CODING_AGENT_DIR= SPECHUB_CONTEXT_PRESSURE_DIR= HERDR_ENV= \
    node --no-warnings "$HARNESS" 2>&1
)"
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
