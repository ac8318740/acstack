#!/usr/bin/env bash
# Offline regression tests; all patching happens in a disposable directory.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HELPER="$ROOT/assets/terminal-workspace/lib/patch-herdr-pi.py"
WORK="$(mktemp -d)"
# Count completed groups: patch contracts, installer wiring, and writer behavior.
passed=0
skipped=0
finish() {
  status=$?
  failed=0
  if [ "$status" -ne 0 ]; then failed=1; fi
  printf '\nResult: %d passed, %d failed, %d skipped\n' "$passed" "$failed" "$skipped"
  rm -rf "$WORK"
  exit "$status"
}
trap finish EXIT

if [ ! -f "$HELPER" ]; then
  echo 'FAIL: missing herdr Pi patch helper' >&2
  exit 1
fi

python3 - "$HELPER" "$ROOT/tests/fixtures/herdr/herdr-agent-state.ts" "$WORK" <<'PY'
from pathlib import Path
import subprocess
import sys

helper, fixture, work = map(Path, sys.argv[1:])
original = fixture.read_bytes()
reporter = work / 'herdr-agent-state.ts'

def patch(path, *args):
    return subprocess.run([sys.executable, str(helper), str(path), *args],
                          capture_output=True, text=True)

def succeed(path, *args):
    result = patch(path, *args)
    assert result.returncode == 0, result.stderr

missing = work / 'absent.ts'
succeed(missing)
succeed(missing, '--remove')
assert not missing.exists(), 'absent reporter must remain absent'
print('ok absent reporter is a safe no-op')

for name, content in (
    ('unknown', b'// unknown upstream\n'),
    ('missing agent_settled hook', original.replace(b'agent_settled', b'changed_settled')),
):
    reporter.write_bytes(content)
    result = patch(reporter)
    assert result.returncode != 0, f'{name} upstream must be rejected'
    assert reporter.read_bytes() == content, 'rejected patch must not modify reporter'
print('ok unknown and incomplete layouts fail without partial edits')

reporter.write_bytes(original)
succeed(reporter)
patched = reporter.read_bytes()
assert patched != original, 'known upstream must receive the patch'
succeed(reporter)
assert reporter.read_bytes() == patched, 'patch must be byte-idempotent'
print('ok known upstream patches idempotently')

succeed(reporter, '--remove')
assert reporter.read_bytes() == original, 'removal must restore exact upstream bytes'
succeed(reporter, '--remove')
assert reporter.read_bytes() == original, 'repeated removal must be a no-op'
print('ok removal restores upstream idempotently')

succeed(reporter)
user_edit = b'\n// unrelated user customization\n'
reporter.write_bytes(reporter.read_bytes() + user_edit)
succeed(reporter, '--remove')
assert reporter.read_bytes() == original + user_edit, 'removal must preserve unrelated edits'
print('ok removal preserves unrelated user edits')

# Editing an inserted event token must make managed-block removal refuse safely.
modified = patched.replace(b'subagents:started', b'subagents:customized', 1)
assert modified != patched, 'patched reporter must subscribe to child starts'
reporter.write_bytes(modified)
result = patch(reporter, '--remove')
assert result.returncode != 0, 'modified managed block must not be removed'
assert reporter.read_bytes() == modified, 'refused removal must preserve every byte'
print('ok modified managed block removal refuses without edits')

link = work / 'linked-reporter.ts'
link.symlink_to(reporter)
for content in (original, patched):
    for args in ((), ('--remove',)):
        reporter.write_bytes(content)
        result = patch(link, *args)
        assert result.returncode != 0, 'symlink reporter must be refused'
        assert link.is_symlink(), 'refusal must preserve the symlink'
        assert reporter.read_bytes() == content, 'refusal must preserve the symlink target'
print('ok symlink patch and removal refuse without changing the target')

# Leave a patched copy for the real-writer behavioral checks.
reporter.write_bytes(original)
succeed(reporter)
PY
passed=$((passed + 1))

# Source the public installer entrypoints in an isolated home and agent directory.
(
  export HOME="$WORK/home" PI_CODING_AGENT_DIR="$WORK/custom-agent"
  export ACSTACK_TW_NO_MAIN=1 ACSTACK_TW_BIN="$WORK/bin"
  export ACSTACK_TW_CONFIG="$WORK/workspace.yaml"
  export HERDR_TEST_FIXTURE="$ROOT/tests/fixtures/herdr/herdr-agent-state.ts"
  mkdir -p "$HOME/.pi/agent/extensions" "$PI_CODING_AGENT_DIR/extensions" "$ACSTACK_TW_BIN"
  default_reporter="$HOME/.pi/agent/extensions/herdr-agent-state.ts"
  reporter="$PI_CODING_AGENT_DIR/extensions/herdr-agent-state.ts"
  cp "$HERDR_TEST_FIXTURE" "$default_reporter"
  cp "$HERDR_TEST_FIXTURE" "$reporter"
  printf 'herdr:\n  integration: pi\n' > "$ACSTACK_TW_CONFIG"
  cat > "$ACSTACK_TW_BIN/herdr" <<'STUB'
#!/usr/bin/env bash
set -eu
case "$*" in
  update|"integration install pi")
    cp "$HERDR_TEST_FIXTURE" "$PI_CODING_AGENT_DIR/extensions/herdr-agent-state.ts"
    printf '%s\n' "$*" >> "$PI_CODING_AGENT_DIR/herdr-calls"
    ;;
  "config check") echo 'config: ok' ;;
esac
STUB
  chmod +x "$ACSTACK_TW_BIN/herdr"
  # shellcheck disable=SC1091
  . "$ROOT/assets/terminal-workspace/setup.sh"
  patch_herdr_pi_status
  if cmp -s "$HERDR_TEST_FIXTURE" "$reporter"; then
    echo 'FAIL: installer did not patch PI_CODING_AGENT_DIR reporter' >&2
    exit 1
  fi
  cmp "$HERDR_TEST_FIXTURE" "$default_reporter"
  patch_herdr_pi_status --remove
  cmp "$HERDR_TEST_FIXTURE" "$reporter"
  echo 'ok installer patches and removes only the overridden agent directory'

  upgrade_one herdr
  grep -qx 'update' "$PI_CODING_AGENT_DIR/herdr-calls"
  if cmp -s "$HERDR_TEST_FIXTURE" "$reporter"; then
    echo 'FAIL: herdr upgrade did not reapply reporter patch' >&2
    exit 1
  fi
  cmp "$HERDR_TEST_FIXTURE" "$default_reporter"
  echo 'ok herdr upgrade reapplies the patch after upstream replacement'

  apply_herdr
  grep -qx 'integration install pi' "$PI_CODING_AGENT_DIR/herdr-calls"
  if cmp -s "$HERDR_TEST_FIXTURE" "$reporter"; then
    echo 'FAIL: herdr integration install did not reapply reporter patch' >&2
    exit 1
  fi
  cmp "$HERDR_TEST_FIXTURE" "$default_reporter"
  echo 'ok herdr apply reapplies the patch after integration installation'

  for component in pi herdr; do
    patch_herdr_pi_status
    ACSTACK_TW_NO_MAIN=0 bash "$ROOT/assets/terminal-workspace/setup.sh" disable "$component"
    cmp "$HERDR_TEST_FIXTURE" "$reporter"
    cmp "$HERDR_TEST_FIXTURE" "$default_reporter"
    echo "ok disable $component restores the exact upstream reporter"
  done
)
passed=$((passed + 1))

if [ "$(node -p 'process.features.typescript || ""' 2>/dev/null)" != strip ]; then
  echo 'SKIP: reporter execution requires Node with TypeScript stripping'
  skipped=$((skipped + 1))
  exit 0
fi
node --no-warnings "$ROOT/tests/integration/herdr-pi-status.mjs" "$WORK/herdr-agent-state.ts"
passed=$((passed + 1))
