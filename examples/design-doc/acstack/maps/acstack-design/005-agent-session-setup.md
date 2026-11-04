---
status: open
mode: hitl
kind: element
label: "Agent session setup"
summary: "Registers ACStack skill commands and adds rules for planning, coding, and checking changes to the agent's session."
answers: "001"
blocked-by: []
---

# Agent session setup

<details>
<summary>Design element</summary>

```yaml
kind: component
parent: '003'
channels:
- agent
connections:
- to: '004'
  direction: one-way
  label: Registers
```
</details>
