# Design review

Use a design doc for shared behavior, component boundaries, and data-flow decisions. Its elements are `element` nodes on the same map as the questions and work.

## Fog classes

- Blocking fog changes the design
- Deferred fog needs later evidence or sits below the design's scope
- Clear blocking fog before implementation
- Record the evidence or event that reopens deferred fog
- Never defer fog because asking feels inconvenient

## Review gate

- Follow `/acstack:design-doc` to write element nodes and the questions that target them
- Run `~/.claude/acstack/bin/acstack design-doc <map>` for live review
- Reconcile saved comments through `design-review reconcile`
- Stop for approval only under When to stop for the user in `orchestrator/AGENTS.md`: the plan decides something the user has not, or changes a contract or module boundary
- When you stop, require `approval.valid: true` from `~/.claude/acstack/bin/acstack design-review status <map>` before implementation
- Regenerating presentation alone preserves approval
- Use `node walk` and `node frontier` for planning views, not architecture generation

## New fog during implementation

- Return design-changing fog to `/acstack:map`
- Keep other fog with its reopening trigger
- Revise the element nodes; stop for approval again only when the revision meets When to stop for the user
