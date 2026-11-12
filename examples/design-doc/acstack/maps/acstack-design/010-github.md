---
status: open
mode: hitl
kind: element
label: "GitHub"
summary: "Hosts a published copy of the Markdown companion when the developer chooses to share it."
answers: "001"
blocked-by: []
---

# GitHub

Map nodes define the design; GitHub hosts a published copy of the Markdown companion only if the developer chooses to share it.

- The map drives the review
    - The Review command and server read the element nodes through the map's tracker to generate the browser view and Markdown companion
    - Revise element nodes when the design changes
    - Answers and approval from the browser resolve map nodes through the same tracker
- GitHub hosts a published copy
    - The Project developer can commit and push the generated companion for others to read on GitHub
    - On the GitHub tracker the map itself lives in issues; this diagram's publication arrow is separate from that

<details>
<summary>Design element</summary>

```yaml
kind: external-system
location: github.com, in the project's repository
channels:
- web
```
</details>
