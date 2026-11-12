#!/usr/bin/env bash
# Runs skills/browser-verify/measure.js against tests/fixtures/frontend-measure.html
# in headless Chrome through agent-browser, and checks that each planted
# violation is caught while the clean region stays clean.
#
# Run it:  bash tests/test-frontend-measure.sh
# Exit code is 0 when every check passes, 1 otherwise. Without agent-browser
# the suite reports its checks as skipped.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
MEASURE="${ROOT}/skills/browser-verify/measure.js"
FIXTURE="${ROOT}/tests/fixtures/frontend-measure.html"
CHECKS=10

pass=0
fail=0
ok() { printf '  \033[32mPASS\033[0m %s\n' "$1"; pass=$((pass + 1)); }
no() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; fail=$((fail + 1)); }

if ! command -v agent-browser >/dev/null 2>&1; then
  echo "  SKIP agent-browser is not installed"
  echo "Result: 0 passed, 0 failed, ${CHECKS} skipped"
  exit 0
fi

export AGENT_BROWSER_SESSION="acstack-measure-test-$$"
trap 'agent-browser close >/dev/null 2>&1' EXIT
ab() { agent-browser "$@"; }
# --no-sandbox: VMs and containers often lack user namespaces for Chrome's sandbox.
if ! ab --args "--no-sandbox" --allow-file-access open "file://${FIXTURE}" >/dev/null; then
  no "open fixture in headless Chrome"
  echo "Result: ${pass} passed, $((fail + CHECKS - 1)) failed"
  exit 1
fi

# Rules found in a region, as a sorted unique list.
rules() { ab --json eval "acstackMeasure.run({scope: '$1'})" | node -e '
  const r = JSON.parse(require("fs").readFileSync(0, "utf8")).data.result;
  console.log([...new Set(r.violations.map((v) => v.rule))].sort().join(" "));'; }
expect() { # region, expected rules, label
  local got; got="$(rules "$1")"
  [ "$got" = "$2" ] && ok "$3" || no "$3 (expected '$2', got '$got')"
}

ab eval --stdin < "$MEASURE" >/dev/null || no "measure.js loads"
expect '#clean' '' 'clean region reports nothing'
expect '#off-font' 'type-size' 'off-scale font size'
expect '#padding' 'sibling-padding' 'unequal sibling padding'
expect '#lone' 'lone-word' 'lone last-line word'
expect '#edges' 'edge' 'near-miss shared edge'
expect '#contrast' 'contrast' 'low contrast'
expect '#target' 'target-size' 'small target'

# Jiggle: a 300ms transition must be awaited, not measured on the same tick.
ab eval "acstackMeasure.snapshot({scope: '#moving'})" >/dev/null
ab eval "document.querySelector('#moving').classList.add('busy')" >/dev/null
got="$(ab --json eval "acstackMeasure.jiggle()" | node -e '
  const v = JSON.parse(require("fs").readFileSync(0, "utf8")).data.result.violations;
  console.log(v.map((x) => x.selector + " " + x.expected + " -> " + x.actual).join("; "));')"
[[ "$got" == "#slide "* ]] && ok "jiggle caught after the transition" || no "jiggle caught after the transition (got '$got')"
x() { echo "$got" | sed -E 's/^#slide ([0-9.]+),.* -> ([0-9.]+),.*/\1 \2/'; }
read -r x0 x1 <<<"$(x)"
[ "$(node -e "console.log(Math.round($x1 - $x0))")" = "16" ] && ok "jiggle measured the settled position" || no "jiggle measured the settled position ($x0 -> $x1)"

ab eval "acstackMeasure.snapshot({scope: '#steady'})" >/dev/null
ab eval "document.querySelector('#steady-save').textContent = 'Saving'" >/dev/null
got="$(ab --json eval "acstackMeasure.jiggle()" | node -e '
  console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).data.result.violations.length);')"
[ "$got" = "0" ] && ok "fixed-width label change does not jiggle" || no "fixed-width label change does not jiggle (got $got)"

echo "Result: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
