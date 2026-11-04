---
status: open
mode: hitl
kind: element
label: "Browser review interface"
summary: "Receives the prepared design graph and syncs comments with the local server."
answers: "001"
blocked-by: []
---

# Browser review interface

<details>
<summary>Design element</summary>

```yaml
kind: component
parent: '006'
channels:
- web
examples:
- title: Order summary
  od:
    design: order-summary
    page: summary
  illustrative: true
- title: Reviewing an example
  markdown: review-flow.md
- title: How a comment anchors
  mermaid: comment-anchor.mmd
- title: Saved comments
  fixture: comments.json
  schema: comments.schema.json
```
</details>
