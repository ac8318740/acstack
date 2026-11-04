---
status: open
mode: hitl
kind: destination
label: "ACStack design review"
summary: "ACStack draws a design doc from a map, saves browser feedback, answers questions on the map, and records exact-revision approval."
blocked-by: []
---

# ACStack design review

## Review the design before implementation

ACStack draws a design doc from a map, saves review comments, writes the reviewer's answers back to the map, and records human approval of the exact reviewed inputs.

This example keeps the existing architecture: Agent skills guide the agent; the Review command and server read the map and save review evidence. The Browser review interface shows the design and collects comments, answers, locks, and approval. Review the responsibilities, containment, and labeled arrows before implementation.

### Author, review, reconcile, and approve

1. The developer asks the agent to prepare a design through the Agent skills registered by Agent session setup
2. The agent writes one `element` node per design element, each with a collapsed `Design element` block, and hangs questions off the elements they target
3. The agent runs `acstack design-doc <map> --check`, then `acstack design-doc <map>` and keeps the server running
4. The server reads the map through its tracker and serves the prepared graph with bundled browser assets
5. The developer answers questions beside their elements; each answer writes `## Answer` and resolves the question node
6. The developer saves comments, chooses Send to agent, and pastes the copied prompt into the agent session
7. The agent revises element nodes, picks up answer follow-ups at its next frontier recompute, and reconciles each comment
8. The developer locks settled elements, or approves the revision, which locks every loose element
9. The agent requires `approval.valid: true` from `acstack design-review status <map>` before implementation
10. At map closeout, archive verifies implemented functional requirements in living specs, architecture decision records (ADRs), and agreed glossary terms before disposing of temporary nodes

### Approval belongs to exact inputs

- Approval binds `sourceRevision`, `reviewRevision`, `commentsDigest`, and `mapInputsDigest`, not the rendered page alone
- Each comment needs one explicit disposition: `applied`, `retained`, or `needs-human`, with a rationale
- Any open node targeting an element, or a `needs-human` disposition, prevents approval
- Changed element nodes, saved feedback, or targeting nodes reopen the gate; presentation regeneration alone preserves approval
- Only the developer locks an element; an agent never does

### Containment and arrows keep their existing meaning

The ACStack plugin contains Agent skills, Agent session setup, and the CLI package. The CLI package contains the Review command and server and the Browser review interface. The Project developer, the Map, and GitHub remain outside the plugin.

- Each component is one entity, shown collapsed or expanded
- Nesting means containment; arrows connect responsible entities, never ancestors to descendants
- Read one-way arrows as actor, action, and target: the server reads the map, and the developer optionally publishes Markdown
- The bidirectional review-session arrow covers the prepared graph, posted comments, answers, and locks
- Concerns describe shared requirements without changing containment

### Optional repository context

- Authoring, reconciliation, and approval guidance: `skills/design-doc/SKILL.md`
- Local review and lifecycle commands: `cli/src/commands/design-doc.ts`
- Building the design from map nodes: `cli/src/lib/design-doc.ts`
- Tracker reads and writes, and exact-input approval: `cli/src/lib/design-map.ts`, `cli/src/lib/design-lifecycle.ts`
- Closeout and evidence retention: `skills/archive/SKILL.md`


<details>
<summary>Design doc</summary>

```yaml
concerns:
- id: offline-review
  name: Offline review
  elements:
  - '007'
  - 008
  - 009
  requirement: Reviewers can inspect the design without uploading project details or fetching browser assets.
  response: The review command and server read the map and embed validated graph data with bundled browser assets, without uploading the design. Reading and answering a GitHub map still needs network access.
- id: honest-scope
  name: Honest review status
  elements:
  - '004'
  - '007'
  - 008
  requirement: An exported review artifact must not imply that a reviewer approved a map or implementation.
  response: Comments and exports are not approval. Approval requires reconciled comments, no open questions on the design, and the exact source, review, comments, and map-input tuple. Implementation checks remain separate.
```
</details>
