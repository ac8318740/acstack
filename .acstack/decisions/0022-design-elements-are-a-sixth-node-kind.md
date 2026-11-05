# Design elements are a sixth node kind, and the frontier skips them

A map node can carry `kind: element`, which marks it as an element of the map's design doc. Its status is the element's state: open is loose, and resolved is locked. Only the user locks an element, so `element` nodes never reach the frontier in either mode. This amends [0012](0012-node-kind-is-a-closed-set-of-five.md), where kind picked a shape and never a route.

## Considered options

- Reuse `decision` for elements. Rejected: every loose element would sit on the hitl frontier, and grilling would lock elements the user never reviewed in the design doc.
- Flag elements with a body block on any kind. Rejected: the frontier would still route them, and the flag would hide what the node is.

## Consequences

- Kind now routes in one case: the frontier drops `element` nodes on both trackers, including the hand-run GitHub query.
- `element` draws as a parallelogram, and the legend's widest form now fills all 18 slots.
- `acstack node kinds` lists `element`, so GitHub materialisation creates the `kind:element` label.
- An agent never resolves an element node. The user locks one from its drawer, or approves the design, which locks every loose element.
