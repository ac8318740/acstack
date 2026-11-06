#!/usr/bin/env bash
# Execute the workflow's ref-update step with a fake gh; never contact GitHub.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

python3 - "$ROOT/.github/workflows/promote.yml" "$WORK/ff.sh" <<'PY'
import pathlib
import sys

text = pathlib.Path(sys.argv[1]).read_text()
step = text.split('      - name: Fast-forward main to dev\n', 1)[1]
script = step.split('        run: |\n', 1)[1].split('\n      #', 1)[0]
pathlib.Path(sys.argv[2]).write_text('\n'.join(line[10:] for line in script.splitlines()) + '\n')
PY

mkdir "$WORK/bin"
cat > "$WORK/bin/gh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$CALLS"
# The only permitted write is the original non-forced ref update.
[[ "$*" == 'api -X PATCH repos/example/repo/git/refs/heads/main -f sha=911a42c1f5dcbd0f67f2bb5ef506b3797cbe9a92' ]] || exit 99
case "$SCENARIO" in
  success)
    printf '{"ref":"refs/heads/main","secret":"%s"}\n' "$GH_TOKEN"
    ;;
  rejected)
    printf '{"message":"Update is not a fast forward","errors":[{"message":"Required status check tests is expected"}],"documentation_url":"https://docs.github.com/rest/git/refs","status":"422","headers":{"Authorization":"header-secret"}}\n'
    echo 'gh: Update is not a fast forward (HTTP 422)' >&2
    exit 1
    ;;
  secret)
    printf '{"message":"Rejected token %s\\n::warning::injected ##[warning]legacy ##[add-mask]mask","status":"403"}\n' "$GH_TOKEN"
    printf 'Authorization: Bearer header-secret\ngh: Forbidden (HTTP 403)\n' >&2
    exit 1
    ;;
  transport)
    echo 'Post failed: connection reset; Authorization: header-secret' >&2
    exit 1
    ;;
  malformed)
    echo '<html>Bad gateway: header-secret</html>'
    echo 'gh: Bad Gateway (HTTP 502)' >&2
    exit 1
    ;;
esac
SH
chmod +x "$WORK/bin/gh"

export PATH="$WORK/bin:$PATH" REPO=example/repo
export SHA=911a42c1f5dcbd0f67f2bb5ef506b3797cbe9a92 GH_TOKEN=fake-test-token
export RUNNER_TEMP="$WORK" CALLS="$WORK/calls"
pass=0
fail=0
check() {
  if "$@"; then
    pass=$((pass + 1))
  else
    printf 'FAIL: %s\n' "$*"
    fail=$((fail + 1))
  fi
}
run_case() {
  export SCENARIO="$1"
  : > "$CALLS"
  code=0
  bash "$WORK/ff.sh" > "$WORK/output" 2>&1 || code=$?
  check test "$(wc -l < "$CALLS")" -eq 1
  check test "$code" -eq "$2"
  check test "$(grep -c 'main is now at' "$WORK/output" || true)" -eq "$3"
  check test "$(grep -cE 'fake-test-token|header-secret|Nothing was changed' "$WORK/output" || true)" -eq 0
}

run_case success 0 1
run_case rejected 1 0
check grep -q 'Update is not a fast forward' "$WORK/output"
check grep -q 'Required status check tests is expected' "$WORK/output"
check grep -q 'HTTP 422' "$WORK/output"
run_case secret 1 0
check grep -q '\[REDACTED\]' "$WORK/output"
check test "$(grep -c '^::warning::injected' "$WORK/output" || true)" -eq 0
check test "$(grep -cF '##[' "$WORK/output" || true)" -eq 0
detail="$(grep '^GitHub response: ' "$WORK/output")"
check jq -e '.message | contains("##[warning]legacy ##[add-mask]mask")' \
  <<< "${detail#GitHub response: }" > /dev/null
run_case transport 1 0
check grep -q 'No JSON error response' "$WORK/output"
run_case malformed 1 0
check grep -q 'No JSON error response' "$WORK/output"
check grep -q 'HTTP 502' "$WORK/output"

printf 'Result: %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
