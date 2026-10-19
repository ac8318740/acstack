# Retire legacy review through explicit migration

ACStack replaces the old map-diagram review commands with authored design review, without compatibility aliases. An explicit migration preserves feedback and decisions without pretending that a planning graph describes the system's architecture.

## Considered options

Keeping both command paths would preserve old scripts but leave agents choosing between incompatible review workflows. Automatic conversion would avoid a migration step but guess how planning nodes correspond to architecture elements.

## Consequences

- Existing scripts must use the replacement commands
- Migration requires an authored design and explicit comment-target mappings
- Original packs, comments, and decision logs remain unchanged
- Imported approvals remain history and require fresh approval under [0020](0020-bind-design-approval-to-exact-inputs.md)
- Archive retains design source and review evidence even when temporary map nodes are removed

This decision supersedes the command workflow in [0018](0018-alignment-packs-use-local-viewers.md).
