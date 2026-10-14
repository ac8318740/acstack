# Alignment review

The alignment artifact is the human-readable end-state view that the CLI renders from the map.

## Fog classes

- Blocking fog changes the artifact
- Deferred fog needs later evidence, or sits below the level the artifact must settle
- Clear blocking fog before implementation starts
- Leave deferred fog on the map with the evidence or event that reopens it
- Never defer fog because asking feels inconvenient

## Review gate

Build the artifact after diagrams are current:

```bash
~/.claude/acstack/bin/acstack map --map <name>
```

The artifact is disposable. The map remains the source of truth.

Run the review before implementation when `workflow.alignment_packs.approval_gate` is true:

```bash
~/.claude/acstack/bin/acstack align-viewer --map <name>
```

If the review requests changes, read the feedback file the command prints.
Update the map, regenerate the diagrams, and rerun the review.

Start implementation only after the reviewer approves the artifact, or after the project disables the approval gate.

## New fog during implementation

- If new fog changes the artifact, return to `/acstack:map`
- If new fog does not change the artifact, keep working with a local note
- Rebuild or rerun the review when implementation changes the artifact
