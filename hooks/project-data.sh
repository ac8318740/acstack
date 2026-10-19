#!/usr/bin/env bash
# Source from host hooks before reading config or writing project data.
acstack_has_legacy_project_data() {
  local root="$1" name
  for name in project.yaml domain-map.yaml; do
    { [ -f "$root/acstack/$name" ] || [ -L "$root/acstack/$name" ]; } && return 0
  done
  for name in alignment-packs design-reviews maps specs changes archive decision-logs; do
    { [ -d "$root/acstack/$name" ] || [ -L "$root/acstack/$name" ]; } && return 0
  done
  return 1
}

acstack_project_root() {
  local root
  root="$PWD"
  while [ "$root" != / ]; do
    if [ -d "$root/.acstack" ] || acstack_has_legacy_project_data "$root"; then
      printf '%s\n' "$root"
      return
    fi
    root=$(dirname "$root")
  done
  git rev-parse --show-toplevel 2>/dev/null || printf '%s\n' "$PWD"
}

acstack_ensure_project_data() {
  local root="$1" bundled_cli="$2"
  if acstack_has_legacy_project_data "$root"; then
    echo 'acstack: legacy project data found; run ~/.claude/acstack/bin/acstack project-data migrate before using it.' >&2
  fi
  if ! (cd "$root" && "$bundled_cli" project-data ensure >&2); then
    echo 'acstack: project-data ensure failed; ignore policy is not confirmed installed. Skipping project activation and private writes.' >&2
    return 1
  fi
  # A second config root must never hide unmigrated project data.
  ! acstack_has_legacy_project_data "$root"
}
