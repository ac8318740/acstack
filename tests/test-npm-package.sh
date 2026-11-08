#!/usr/bin/env bash
# Verify the exact release artifact without runtime builds or registry access.
# With no argument, prepack builds a new artifact; CI/release can supply one.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if [ "$#" -gt 0 ]; then
  TARBALL="$(realpath "$1")"
else
  (cd "$ROOT" && npm pack --pack-destination "$WORK")
  TARBALL="$(find "$WORK" -maxdepth 1 -name '*.tgz')"
fi
mkdir -p "$WORK/home" "$WORK/install"
export HOME="$WORK/home" ACSTACK_HOME="$WORK/home/.acstack"
# The optional pi host is supplied by pi, not needed by the standalone CLI.
npm install --prefix "$WORK/install" --ignore-scripts \
  --offline --no-audit --no-fund --cache "$WORK/cache" "$TARBALL"
PACKAGE="$WORK/install/node_modules/acstack"
node --input-type=module - "$PACKAGE" <<'NODE'
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const root = process.argv[2];
const json = p => JSON.parse(readFileSync(join(root, p), 'utf8'));
const pkg = json('package.json');
assert.equal(pkg.name, 'acstack');
assert.equal(pkg.engines.node, json('cli/package.json').engines.node);
for (const manifest of ['.claude-plugin/plugin.json', 'plugin.json', 'cli/package.json']) {
  assert.equal(json(manifest).version, pkg.version, `${manifest} version must match npm`);
}
for (const path of [
  'cli/dist/index.js', 'cli/bin/acstack.js', 'hooks/hooks.json',
  'hooks/session-start.sh', 'orchestrator/AGENTS.md', 'skills/implement/SKILL.md',
  'agents/codex/task-executor.toml', 'pi/agents/task-executor.md',
  ...pkg.pi.extensions,
]) assert.ok(existsSync(join(root, path)), `missing package asset: ${path}`);
assert.ok(!existsSync(join(root, 'cli/node_modules')), 'CLI must ship bundled');
assert.ok(!existsSync(join(root, '.acstack')), 'project records must not ship');
assert.ok(!existsSync(join(root, 'cli/src')), 'CLI source is not a runtime dependency');
NODE
cd "$WORK"
CLI="$WORK/install/node_modules/.bin/acstack"
VERSION="$(node -p "require(process.argv[1]).version" "$PACKAGE/package.json")"
test "$("$CLI" --version)" = "$VERSION"
"$CLI" --help > "$WORK/help"
grep -q 'project-data' "$WORK/help"
# Exercise a bundled dependency and filesystem behavior beyond --help.
git init -q "$WORK/project"
cd "$WORK/project"
"$CLI" project-data path > "$WORK/path"
grep -q "$ACSTACK_HOME/projects/" "$WORK/path"
echo "PASS: npm artifact installs offline and runs without build scripts or CLI dependencies"
bash "$ROOT/tests/test-codex-plugin.sh" "$TARBALL"
