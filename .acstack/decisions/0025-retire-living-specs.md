# Retire living specs and spec sync

ACStack no longer keeps living specs. Tests are the executable specification, ADRs hold the reasons behind hard decisions, the glossary holds settled terms, and clean code plus the repository's own structure docs let a reader drill down. A spec that restates behavior is a second copy that drifts, and syncing it costs work on every commit.

## Considered options

- Keep specs, on by default. Rejected: four files carried the sync procedure and two of them contradicted each other on the default and on missing specs.
- Keep specs as an opt-in. Rejected: it keeps the sync and bootstrap skills, the domain map, and the config schema alive for a second copy of behavior.

## Consequences

- The sync and bootstrap skills, `workflow.spec_sync`, and `domain-map.yaml` are removed; `/acstack:commit` no longer updates specs
- Existing `specs/` folders stay on disk untouched; nothing migrates or deletes them
- ACStack does not mandate an architecture file; each repository keeps its structure doc in its own convention
- Behavior that only a spec recorded needs a test, or it has no record
