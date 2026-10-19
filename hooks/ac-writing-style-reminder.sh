#!/bin/sh
# Per-turn reminder for the ac-writing-style output style.
#
# Built-in styles (Concise, Proactive) carry a `turnReminder` field that the CLI
# re-injects every turn. A file-based output style cannot set one: the
# frontmatter schema accepts only name, description, keep-coding-instructions
# and force-for-plugin. This hook supplies the equivalent.
#
# The reminder text is EXTRACTED from output-styles/ac-writing-style.md on every
# turn, never stored. A hand-typed copy drifts from the style the moment either
# one changes. The marked communication block is the canonical standard for
# chat and durable writing. Extract it in full, including nested guidance;
# headings and checklist item counts are not an extraction contract.
#
# Output is JSON only, with suppressOutput true, so nothing reaches the user's
# transcript. The hook stays silent unless the active output style is this one.

set -u

# Drain stdin so the CLI never sees a broken pipe.
{ command -p cat 2>/dev/null || cat; } >/dev/null 2>&1 || :

silent() { printf '{}\n'; exit 0; }

# --------------------------------------------------------------------------
# Gate: only speak when ac-writing-style is the active output style.
# --------------------------------------------------------------------------

read_style() {
  [ -f "$1" ] || return 1
  sed -n 's/.*"outputStyle"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1" 2>/dev/null | head -1
}

# Project settings win over user settings, the same order the CLI resolves them.
style=$(read_style ".claude/settings.local.json" || true)
[ -n "${style:-}" ] || style=$(read_style ".claude/settings.json" || true)
[ -n "${style:-}" ] || style=$(read_style "${HOME}/.claude/settings.json" || true)

case "${style:-}" in
  *ac-writing-style|*ac-agentic-coding-writing) ;;
  *) silent ;;
esac

# --------------------------------------------------------------------------
# Locate the output style the reminder derives from.
# --------------------------------------------------------------------------

root="${CLAUDE_PLUGIN_ROOT:-}"
[ -n "$root" ] || root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
style_file="${root}/output-styles/ac-writing-style.md"

[ -r "$style_file" ] || silent

# --------------------------------------------------------------------------
# Extract, escape, and emit.
# --------------------------------------------------------------------------

awk '
  function esc(s) {
    gsub(/\\/, "\\\\", s)
    gsub(/"/, "\\\"", s)
    gsub(/\t/, "\\t", s)
    return s
  }
  function emit(s) { out = out esc(s) "\\n" }

  /^<!-- acstack:communication:start -->$/ { shared = 1; next }
  /^<!-- acstack:communication:end -->$/   { complete = shared; exit }
  shared                                  { emit($0) }

  END {
    if (!complete || out == "") exit 1
    printf "{\"suppressOutput\": true, \"hookSpecificOutput\": {\"hookEventName\": \"UserPromptSubmit\", \"additionalContext\": \"ac-writing-style reminder\\n\\n%s\"}}\n", out
  }
' "$style_file" || silent
