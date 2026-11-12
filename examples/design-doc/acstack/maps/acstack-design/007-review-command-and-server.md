---
status: open
mode: hitl
kind: element
label: "Review command and server"
summary: "Reads and validates the map, serves the browser review interface, saves comments, writes answers and approval to the map, and exports Markdown."
answers: "001"
blocked-by: []
---

# Review command and server

<details>
<summary>Design element</summary>

```yaml
kind: component
parent: '006'
channels:
- cli
- web
connections:
- to: 009
  direction: one-way
  label: Reads and resolves nodes in
- to: 008
  direction: bidirectional
  label: Exchanges the design and comments with
mocks:
- title: Terminal output
  markdown: terminal.md
```
</details>
