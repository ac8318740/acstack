---
status: open
mode: hitl
kind: element
label: "Project developer"
summary: "Authors the design and reviews the exported artifact locally."
answers: "001"
blocked-by: []
---

# Project developer

<details>
<summary>Design element</summary>

```yaml
kind: actor
connections:
- to: '004'
  direction: one-way
  label: Requests design guidance from
- to: '010'
  direction: one-way
  label: Optionally publishes the Markdown companion to
```
</details>
