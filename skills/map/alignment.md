# Design review

Use an authored design for shared behavior, component boundaries, and data-flow decisions; map nodes track questions and work.

## Fog classes

- Blocking fog changes the design
- Deferred fog needs later evidence or sits below the design's scope
- Clear blocking fog before implementation
- Record the evidence or event that reopens deferred fog
- Never defer fog because asking feels inconvenient

## Review gate

- Follow `/acstack:design-doc` to author the design, bind the map, and record node contributions
- Run `~/.claude/acstack/bin/acstack design-doc <entry>` for live review
- Reconcile saved feedback and current contributions through `design-review reconcile`
- Require `approval.valid: true` from `~/.claude/acstack/bin/acstack design-review status <entry>` before implementation
- Approval covers the exact source, saved comments, and map contribution inputs
- Reopen review when those inputs change; regenerating presentation alone preserves approval
- Use `node walk`, `node frontier`, and `node diagram` for planning views, not architecture generation
- ACStack removes legacy `map --map` and `align-viewer` without aliases
- Use explicit `design-review migrate` for legacy feedback (see `/acstack:design-doc`)

## New fog during implementation

- Return design-changing fog to `/acstack:map`
- Keep other fog with its reopening trigger
- Revise the authored design and repeat reconciliation and approval when review inputs change
