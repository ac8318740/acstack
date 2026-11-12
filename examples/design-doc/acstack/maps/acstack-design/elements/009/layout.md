# Files tracker layout

One Markdown file per node, under the project folder. Element mocks sit beside the nodes.

```text
<project folder>/maps/acstack-design/
├── 001-acstack-design-review.md   root: the design doc's title, summary, and concerns
├── 002-project-developer.md       element node: front matter plus a "Design element" block
├── ...
└── elements/
    └── 008/                       mocks for element 008
        ├── review-flow.md
        └── comments.json
```
