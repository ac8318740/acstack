# The map is the only design-doc source

A design doc is built from its map's `element` nodes and the questions that target them. Nothing else feeds it. The standalone YAML entry, design questions authored in YAML, and `## Design contributions` are gone, with no migration path. Answers and locks from the viewer go back to the map through its tracker, so the map and the design doc cannot drift apart.

## Considered options

- Keep the YAML entry and bind it to a map. Rejected: two sources had to stay in step through contributions and reconciliation, and the map still could not show the design.
- Generate YAML from the map. Rejected: a second copy invites hand edits that the next generation overwrites.

## Consequences

- `design-doc` and `design-review` take a map name and read the tracker named by `workflow.maps.tracker`
- Approval binds element content, saved comments, and the open nodes targeting elements; it no longer binds file bytes, paths, or contributions
- Design questions are hitl nodes; answering one writes `## Answer` and resolves it through the tracker
- `design-review migrate` and legacy feedback import are removed; earlier canonical reviews stay on disk but no longer load against a map
- Review evidence still outlives temporary map nodes regardless of `workflow.maps.persist`

This decision supersedes [0020](0020-bind-design-approval-to-exact-inputs.md) where it binds approval to authored files and contributions, and [0021](0021-retire-legacy-review-through-explicit-migration.md) where it keeps explicit migration.
