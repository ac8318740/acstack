"""Keep herdr's single Pi status writer aware of background subagents."""
import os
import sys
import tempfile
from pathlib import Path

path = Path(sys.argv[1])
remove = sys.argv[2:] == ["--remove"]
if not path.exists():
    sys.exit(0)
if path.is_symlink() or not path.is_file():
    sys.exit("  pi: herdr status patch skipped: reporter is not a regular file")

begin = "// >>> acstack terminal-workspace: background status >>>"
end = "// <<< acstack terminal-workspace: background status <<<"


def marked(text):
    return f"  {begin}\n{text}  {end}\n"


replacements = [
    ("  let agentActive = false;\n", "  let agentActive = false;\n" + marked('''  // shortcut: no workflow/reload replay; extend when Tintin exposes active-run snapshots.
  const backgroundAgents = new Set<string>();
  let busyCount = 0;
''')),
    ("    if (agentActive) {\n", marked('''    // blocked > active parent or children > idle
    if (agentActive || backgroundAgents.size > 0 || busyCount > 0) {
''')),
    ('  pi.events.on("herdr:blocked", (data) => {\n', marked('''  // Tintin's in-process children share this bus, but never own the pane status.
  pi.events.on("subagents:started", (data) => {
    if (!rootSession || typeof data?.id !== "string" || !data.id) return;
    backgroundAgents.add(data.id);
    publishState();
  });
  for (const event of ["subagents:completed", "subagents:failed"]) {
    pi.events.on(event, (data) => {
      if (!rootSession || typeof data?.id !== "string") return;
      backgroundAgents.delete(data.id);
      publishState();
    });
  }
  // nicobailon/pi-subagents uses balanced active intervals instead of IDs.
  pi.events.on("herdr:busy", (data) => {
    if (!rootSession || typeof data?.active !== "boolean") return;
    busyCount = Math.max(0, busyCount + (data.active ? 1 : -1));
    publishState();
  });
''') + '  pi.events.on("herdr:blocked", (data) => {\n'),
]

text = path.read_text()
if not text.startswith("// installed by herdr\n") or "HERDR_INTEGRATION_ID=pi\n" not in text:
    sys.exit("  pi: herdr status patch skipped: unrecognised reporter")
# These lifecycle guards must still exist before adding shared-bus listeners.
required = [
    '  pi.on("agent_settled", (_event, ctx) => {',
    '    if (ctx?.mode !== "tui") {',
    '    if (!rootSession || ctx?.isIdle?.() !== true) {',
]
if any(text.count(anchor) != 1 for anchor in required):
    sys.exit("  pi: herdr status patch skipped: upstream lifecycle changed")
patched = begin in text
if patched == (not remove):
    # Validate every managed block before treating an existing patch as ours.
    if patched and any(text.count(new) != 1 for _, new in replacements):
        sys.exit("  pi: herdr status patch skipped: managed blocks were changed")
    sys.exit(0)

for old, new in replacements:
    if text.count(new if remove else old) != 1:
        sys.exit("  pi: herdr status patch skipped: upstream layout changed")
for old, new in replacements:
    text = text.replace(new, old, 1) if remove else text.replace(old, new, 1)

# Validate all matches first, then replace atomically so a failed patch leaves no partial writer.
fd, temporary = tempfile.mkstemp(dir=path.parent, prefix=".acstack-herdr-")
try:
    with os.fdopen(fd, "w") as stream:
        stream.write(text)
    os.chmod(temporary, path.stat().st_mode)
    os.replace(temporary, path)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)
print(f"  pi: herdr background status patch {'removed' if remove else 'applied'}")
