# ACStack workflows

*Every request ends the same way, with your specs updated from the diff. What changes is how many questions you settle first.*

ACStack routes a request down one of three paths. Every path ends at a commit that updates your specs.

- **The path depends on what is in your way**: nothing, a bug, or an unanswered question
- **A clear request goes straight to implementation and adaptive verification** (see section 4)
- **A bug goes to root-cause analysis first** (see section 2)
- **A request with open questions becomes a to-do graph** you work through (see section 1)
- **The rest of this document** is the detail behind one box of the diagram below

```mermaid
flowchart TD
    R["A request<br/>(feature, bug, refactor)"] --> Q{"What stands<br/>in the way?"}
    Q -->|"nothing – the way is clear"| I["Implement<br/>(implement)"]
    Q -->|"it is broken"| F["Root-cause fix<br/>(quick-fix)"]
    Q -->|"open decisions"| M["Map<br/>(chart, then work the frontier)"]
    M -->|"work nodes"| I
    I --> T["Verify the change<br/>(shared Implementation discipline)"]
    F --> T
    T --> C["Commit<br/>(acstack:commit)"]
    C --> Y["Sync specs from the diff<br/>(domain-map.yaml)"]
    Y --> L[("Living specs<br/>.acstack/specs/")]
    M -->|"every question answered"| A["Archive<br/>(check the decisions landed,<br/>then delete the nodes)"]
    A --> L
```

| Step in the diagram   | Detail    |
| --------------------- | --------- |
| Map, the to-do graph  | section 1 |
| Implement             | section 2 |
| Asking and recording  | section 3 |
| Verify the change     | section 4 |
| Commit **and** sync   | section 5 |
| Archive               | section 6 |
| Living specs          | section 7 |

The request box is a terminal, not a step. Section 5 covers two boxes because one command does both.

Section 8 describes this document. No box holds it.

## 1. The map, meaning the to-do graph

*One kind of record replaces the fixed proposal, design, and tasks pipeline earlier versions used. Nothing stores the map itself. It is queries over the nodes.*

- **A map** is a set of small records called nodes
- **A node** is one question to settle or one piece of work to do
- `/acstack:map` is the entry point for planned work
    - It charts a map when none exists, opening with a grill, a round of questions that fixes the destination and surfaces the fog
    - The destination is what finished looks like
    - It works the frontier instead when a map exists
- ACStack never sorts requests into sizes
    - Nothing picks a different process for a big one
    - There is one path, and only the node count changes

A node carries one of five statuses.

| Status | What it means |
| --- | --- |
| `fog` | nobody can state it precisely yet |
| `open` | ready to settle |
| `claimed` | someone is working it |
| `resolved` | settled |
| `out-of-scope` | deliberately dropped |

A node carries a `kind`, a `label`, and a `mode` too. Two link types connect the nodes.

- **`kind`** is one of five: `destination`, `notes`, `decision`, `research`, `work`
    - It picks the node's shape in a diagram, never how the map routes it
- **`label`** is the node's short name for a diagram, at most four words
- **`mode`** says who settles the node: `hitl` for a human, `afk` for an agent alone
- **`answers`** names the one node whose answer raised this one
    - The parent links form a tree, which gives you a reading order
    - An agent packages a handoff by walking that tree
- **`blocked-by`** names any number of nodes that must resolve before this one starts
    - The blocking edges form a directed acyclic graph, meaning the edges never loop back
    - These edges tell you what you can work right now

Every node body carries a diagram, two at most. A childless `notes` node is the one exception.

- A node with children draws its own subtree, rendered by `acstack node diagram`
- Every other node draws what its question or its change touches, drawn by the agent
- A second mermaid fence under each diagram is its legend, showing only the cues that diagram uses
- On GitHub every node id in a diagram links to its issue
- `skills/map/visuals.md` holds the rules

ACStack works depth out from `answers`. Nobody declares it. The map itself is five queries.

| The question | The query |
| --- | --- |
| Where are we going? | the root node |
| What have we decided? | the `resolved` nodes, in the order the decisions happened |
| What can we work now? | the `open` nodes with no unresolved blockers |
| What is not yet specified? | the `fog` nodes |
| What did we drop? | the `out-of-scope` nodes |

Nodes live in a tracker. That is the storage layer, and you can swap it.

- A tracker provides four operations and nothing more: create, read, update, list
- GitHub issues are the default
    - The first line of every issue body carries all of that node's edges
    - One list call therefore returns the whole graph
    - A sub-issue and a dependency mirror those edges, so GitHub's own interface draws the map
- Files under `.acstack/maps/<name>/` are the fallback
    - Frontmatter holds the edges, so those files carry no header line
- Frontier, claim, and resolve build on those four operations
    - No tracker implements them itself

**Build no more process than the job needs.**

- You create a map only when the fog will outlive the session
- You settle one question in conversation
    - That leaves an architecture decision record (ADR), not a map

## 2. Implement

*A unit of work carries its own size. One node is a quick change.*

*Forty is a long effort. Nothing declares which.*

- `/acstack:implement` claims `afk` work nodes from the frontier when a map exists
    - It treats the request itself as the work item when none does
    - Either way, investigate relevant code directly or through useful delegation
- The command resolves paths at claim time
    - A node describes behaviour
    - It can sit unstarted for weeks
- The shared Implementation discipline applies inside each claim (see section 4)
- A node only ever moves `open -> claimed -> resolved`
    - The agent releases the claim when work stalls
    - The node is plainly open again
- Progress is a query, not a checkbox file
    - Resuming never means re-reading an effort end to end

`/acstack:quick-fix` stays separate. A broken thing is a different problem from an unanswered question.

- A bug has a root cause to find, not a decision to settle
- `/acstack:quick-fix` therefore never creates a node

## 3. Asking the questions, and writing the answers down

*Three skills the agent reaches for itself, without you typing a command, carry the interviewing, the recording, and the writing.*

- **`grilling`** is the interview
    - It works through your decisions one round at a time
    - A round asks the whole frontier, every question whose prerequisites have resolved, numbered, each with a recommended answer
    - It then recomputes the frontier and repeats
    - Facts are the agent's job, never yours
    - It investigates technical facts directly or through useful delegation
    - Presentation follows `workflow.grilling.questions`, the host's question tool by default
    - It falls back to inline prose past 4 questions, or for a question with no discrete options
    - There is no question cap
    - The set of answerable questions bounds itself
- **`record-context`** fires when a decision lands
    - It writes an ADR under `.acstack/decisions/` only when the decision is hard to reverse *and* surprising *and* a real trade-off
    - It writes a glossary term when a term got settled, in `.acstack/CONTEXT.md` for cross-domain vocabulary
    - It writes a domain term in `.acstack/specs/<domain>/CONTEXT.md` instead
    - It can write both, or neither
    - ACStack generates the ADR index from the files
    - Nobody hand-edits it
- **`writing`** holds the standard every durable artifact follows: node answers, ADRs, glossary entries, specs and handoffs
    - The words to avoid live in `skills/writing/vocabulary.md`

## 4. Verify the change

*Choose checks that can detect realistic mistakes, then gather evidence before completion.*

```mermaid
flowchart LR
    A["Assess what breaks"] --> B["Choose checks and useful delegation"]
    B --> C["Test and implement"]
    C --> D["Verify evidence and required gates"]
    D -->|insufficient or failed| B
    D -->|pass| E["Report results and limits"]
```

- The authoritative policy lives in `orchestrator/AGENTS.md`, under Implementation discipline
- One agent can investigate, test, implement, and verify straightforward work
- Practical tests-first work remains preferred
- Another agent adds independent interpretation or review when useful or required by the shared policy
- Choosing separate test ownership prevents the implementer from weakening those tests
- Formatting and project-required completion checks still apply
- Frontend design checks run under `skills/implement/design-pass.md`, even without a delegated checker
- Configured real-browser verification runs on the final code after required gates pass
- Report commands, results, and blocked checks rather than phase narration
- Deprecated TDD booleans no longer control order or delegation, including explicit `true`
    - Existing config remains readable without automatic rewriting
    - New setup offers no replacement switches


## 5. Commit and sync specs

*Spec sync runs on every commit on every path. It reads the diff. Your specs therefore describe what you built, not what you planned.*

`/acstack:commit` groups changes into MECE commits. MECE means mutually exclusive and collectively exhaustive: no change appears twice, and no change goes missing. Before writing them it does five things.

1. Reads `.acstack/domain-map.yaml` to map each changed file to a domain.
2. Works out what the diff adds, modifies or removes, for each affected domain with a `spec.md`.
3. Writes those entries into the domain's spec and stages them in the same commit.
4. Flags source files that match no domain.
5. Checks the glossaries.

On the glossary check:

- It says so when the diff renames or deletes an identifier matching a glossary term
- It never edits the glossary
- For specs the code wins
- For the glossary the human wins

Four cases stop sync.

- `workflow.spec_sync` set to `false`
- no domain map
- no file matching a domain
- a change that touches only docs and config

**Without `.acstack/domain-map.yaml` this step does nothing, silently.**

- `/acstack:setup` generates that file
- `acstack config check` reports it as missing on a project set up before that existed

## 6. Archive

*A map is working state, not a record you keep. Archive checks the decisions reached your specs, your decision notes, and your glossary, then deletes the nodes.*

- `/acstack:archive` checks for a cleared map: empty frontier, no fog, no claims
- It spot-checks that the specs, the decision notes and the glossary captured what the effort settled
- It then disposes of the nodes
    - It deletes them by default
    - It moves them to `.acstack/archive/<date>-<name>/nodes/` when `workflow.maps.persist` is `true`
    - Keeping nodes is off by default
    - A kept map is a second copy of every decision
    - The two drift apart
    - On the GitHub tracker there is nothing to dispose
    - A closed issue is already the archive
- Archive runs either way
    - The user types `/acstack:archive`
    - `/acstack:map` hands off to it once every node resolves
    - The disposal step then asks you first
- Legacy `.acstack/changes/` directories from the pre-map workflow still archive the old way
    - An upgrade therefore never strands work

## 7. Living specs

*What the project keeps. ACStack deletes a map once every question resolves. `.acstack/specs/` outlives it.*

- Specs live at `.acstack/specs/<domain>/spec.md`, organised by the domains in `domain-map.yaml`
- Each spec states numbered functional requirements (`FR-NNN`) in Given, When, Then form
- They are cumulative
- They describe only what the code already does
- A roadmap item in a living spec is a bug in the spec

Two rules keep them honest.

- **Two writers, one target**
    - Commit-time sync handles incremental change
    - Archive verifies a completed map left nothing behind
    - Both converge on the same files
- **Fix it when you see it**
    - Any agent that finds a spec contradicting the code corrects the spec immediately
    - It rewrites wrong behaviour, appends missing requirements, and deletes stale references

`/acstack:bootstrap` generates the first set from an existing codebase. A project never starts from an empty directory.

## 8. Where the design record lives

*This section describes the document, not the system. No diagram box holds it.*

- The reasoning behind this design lives in the issues labelled `wayfinder` on this repository
- That covers why one node type, why four tracker operations, and why no tiers
- Each issue is one decision with the reasoning that produced it
