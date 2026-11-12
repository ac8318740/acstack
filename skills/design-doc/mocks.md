# Mocks on an element

Give an element concrete mocks, flows, and sample data under `mocks:` in its config block. The reviewer opens them from the Mocks tab.

```yaml
mocks:
  - title: Checkout page      # optional; defaults to the path
    od: {design: checkout, page: home}
  - html: checkout.html
    illustrative: true        # an illustration, not a requirement
  - markdown: journey.md
  - mermaid: flow.mmd
  - fixture: order.json       # or a .csv file
    schema: order.schema.json # optional JSON Schema
```

- Each entry names exactly one kind: `od`, `html`, `markdown`, `mermaid`, or `fixture`
- Keep mock files in the element folder, `<project folder>/maps/<map>/elements/<element-id>/`
    - Paths are relative to that folder and never leave it
    - Never use a top-level `designs/` folder
- Prefer OpenDesigner for UI mocks. `od` names an OpenDesigner design and one of its pages
    - The review server builds it with `open-designer build <design> --page <id>` each time the reviewer opens it
    - Give a loose element's mock at least two variants, so the reviewer can compare different options
    - Use inline HTML only when OpenDesigner is not installed or a single static page is enough
- Type fixtures with JSON Schema, unless the code that reads them is untyped
    - Fixtures show structure, not volume: keep each one under 20 KB
    - OpenDesigner pages import the same fixture file as props, so keep one copy in the element folder
- Every mock on a locked element is a requirement unless it sets `illustrative: true`
- Mock what each element exposes
    - Every element this design builds with a `web`, `mobile`, `desktop`, or `cli` channel needs a mock; `--check` fails without one
    - Show a CLI as a Markdown file with the commands and their output in a `text` block
    - Show a database schema as a fixture with its JSON Schema, or a Mermaid `erDiagram`
    - Show a file or directory layout as a Markdown tree in a `text` block
    - `--check` warns about a store with no mock
- When the design extends existing code, build its mocks from that code: reuse its components, styles, sample data, and real command output, so the mock shows the change and not a redesign
