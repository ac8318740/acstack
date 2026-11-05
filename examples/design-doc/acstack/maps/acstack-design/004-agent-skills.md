---
status: open
mode: hitl
kind: element
label: "Agent skills"
summary: "Guide the agent through authoring and exporting a design for review."
answers: "001"
blocked-by: []
---

# Agent skills

<details>
<summary>Design element</summary>

```yaml
kind: component
parent: '003'
channels:
- agent
connections:
- to: '007'
  direction: one-way
  label: Guides the agent to run
```
</details>
