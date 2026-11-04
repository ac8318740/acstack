# Design source example

This design uses four files in one directory. The entry owns questions and cross-element concerns; both endpoints declare the same relationship.

## Entry: design.yaml

```yaml
id: checkout-design
name: Checkout design
summary: The checkout CLI reads orders from a local store.
elements: [checkout.yaml, orders.yaml]
questions:
  - id: missing-order
    target: {type: edge, id: read-orders}
    question: Should a missing order stop the command?
    proposal: Stop with an error naming the missing order; do not write partial results.
    recommendation: Stop, so incomplete output cannot be mistaken for a complete result.
    choices: [Stop without writing results, Skip the missing order and report it]
    highlights:
      - element: orders
        start: {line: 4, column: 1}
        end: {line: 4, column: 28}
concerns:
  - id: local-data
    name: Local data
    elements: [checkout, orders]
    requirement: Orders must stay on the developer's machine.
    response: The CLI reads local files without a network service.
```

The authoring agent chooses each question's input. Omit `choices` for free text. Add `multiple: true` to a choice question when several answers can apply. The viewer adds an Other write-in automatically; single-choice answers cannot combine a listed choice with Other, while multi-select answers can.

## Element: checkout.yaml

```yaml
id: checkout
name: Checkout CLI
summary: Inspects locally stored orders.
kind: component
channels: [cli]
relationships:
  - id: read-orders
    from: checkout
    to: orders
    direction: one-way
    label: Reads
```

## Element: orders.yaml

```yaml
id: orders
name: Order files
summary: Persist the orders inspected by the checkout CLI.
kind: store
detail: orders.md
relationships:
  - id: read-orders
    from: checkout
    to: orders
    direction: one-way
    label: Reads
```

## Supporting detail: orders.md

```markdown
<details>
<summary>Missing orders</summary>

Stop if an order is missing; do not write partial results.

</details>
```

The question highlights `Stop if an order is missing` on line 4 of `orders.md`. `element` names the element that declares this detail file, even when the question targets a relationship. Positions are 1-based; the end is exclusive. Columns count UTF-16 code units (editor coordinates), with a tab counting as one unit. Keep ranges in sync when editing the Markdown; out-of-bounds ranges fail validation.

Opening target details expands the enclosing disclosures and scrolls to the first highlight. Ranges highlight rendered prose, table cells, and inline code, not Markdown syntax, link URLs, fenced code, or Mermaid nodes. A range with no rendered text produces an explicit notice rather than highlighting unrelated content.
