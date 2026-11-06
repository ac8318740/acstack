# Writing examples

These examples apply the shared communication standard in `../../output-styles/ac-writing-style.md` without prescribing one shape for every answer.

## Fit the answer to what the reader needs

- Asked whether the build passed: `Build passes`
- Avoid: Listing commands, timings, and passing checks when the result alone answers the question
- Asked whether the change is ready: `Tests pass; permission to deploy still needed`
- Avoid: `Tests pass` when that hides a blocker; keep any detail that changes the reader's understanding, decision, or next action
- If unsure whether a caveat matters, include its essential point briefly
- Asked five yes/no questions: give five short answers in the same order, not five explanations
- Asked which backend works offline, after discussing the options: `Files backend`
- Avoid: Repeating the options and their trade-offs when the reader already knows them
- Handing work to another agent: include the files, constraints, checked behavior, blockers, and next action needed to continue
- Avoid: `Use files backend` as a handoff when the receiving agent lacks the decision's context

Reports to the user can use fragments. Durable documents need precise wording and enough context for their intended reader to understand them without the conversation.

## Preserve the reason when it changes the action

- Write: Don't cache the token; it expires in five minutes
- Avoid: Don't cache the token
    - The shorter version omits the constraint that explains the recommendation
- Write: The hook writes the symlink
- Avoid: The hook writes the symlink, which means the symlink gets created
    - The second clause adds no information

## Literal headings and ordinary words

Headings name their contents. A reader should understand the subject without knowing the project or interpreting a slogan.

| Avoid | Write |
| --- | --- |
| Review three cooperating stages, not a new workflow | 3 import steps |
| New and corrected orders share the same routing policy | Choosing a folder for an order |
| An authority boundary beneath the workflow | Who may change an order |

Explain the shared rule in the body: "New and corrected orders use the same folder rules."

## Direct statements and relevant limits

Avoid contrast formulas in explanations:

> These are code contracts, not proof of live operation.

State the concrete behavior and its evidence limit separately:

> The source code includes order import. The live service has not been tested.

Delete irrelevant comparisons. Keep limits that affect a decision, and retain direct safety instructions such as "Do not delete the original file."

## Give each level one question to answer

- Write: The release is blocked by two failed checks
    - The CLI build fails on a missing import
    - The hook suite fails on malformed JSON
- Avoid: The release is blocked by these items
    - The CLI build fails on a missing import
    - Run `npm test`
    - Yesterday we considered changing the hook

The first list names blockers at the same level.
The second mixes a blocker, an action, and history.

## Keep the overview connected to the detail

- Write: The SessionStart hook creates the CLI symlink
    - `hooks/session-start.sh` links the bundled CLI to `~/.claude/acstack/bin/acstack`
- Avoid: The startup mechanism prepares the launcher
    - `hooks/session-start.sh` creates a symlink

The first version ties the readable name to the file and its output.
The second makes the reader guess whether the names identify the same thing.

## Define unfamiliar terms before relying on them

- Write: Work the frontier, meaning the nodes ready to work now
- Avoid: Work the frontier returned by the tracker
- Write: The map holds nodes; each node has a status
- Avoid: The map holds nodes; each item has a status

## Separate the current decision from its history

- Write: Use the files backend because it works offline
    - Decision history: We rejected the issues backend because this deployment has no network access
- Avoid: We first considered issues, then investigated files, and eventually chose files

## Keep necessary qualifications and evidence

- Write: The unit tests pass; browser verification is blocked because Chrome is unavailable
- Avoid: All checks pass
- Write: The parser rejects duplicate keys
- Avoid: The parser offers comprehensive validation

## Choose clear words without enforcing word counts

- Write: Use the bundled CLI
- Avoid: Utilize the bundled CLI
- Write: The browser verification knowledge base records selectors that survived a page reload
- Avoid: Removing a necessary term to meet a three-word noun limit
- Write: The file was deleted before the hook ran
- Avoid: Inventing an actor to force active voice when the logs do not identify who deleted the file

## Show relationships without inventing containment

- Write: The API and worker both use the authentication module
- Avoid: Nesting the worker under the API because both depend on authentication
- Write: The parser exposes `parse(text)` and keeps tokenization internal
- Avoid: Listing every tokenizer helper before explaining the parser's interface

## Synthesize the proposal before nested supporting detail

Avoid a teaser summary followed by a long introduction that hides the decision:

```yaml
summary: A simpler order workflow.
```

```markdown
# The next chapter for orders
We considered several ways to improve order entry. This proposal brings three
components together. The following sections explain their responsibilities.
## Components
The Importer reads files, the Validator checks records, and the Writer saves orders.
## Considerations
Local files need manual transfer. We have not chosen an import authorization owner.
```

Write an always-visible summary of the full proposal (about 10 seconds to read, not an enforced word count):

```yaml
summary: >-
  Replace manual order entry with file imports validated before storage.
  The Importer and Validator prepare orders for the Writer.
  Operators transfer files manually between devices.
  Launch requires a decision on who may authorize imports.
```

Then put distinct supporting explanations under nested, literal headings:

```markdown
# 3 import components
## Component responsibilities

- **Importer:** reads the source file.
- **Validator:** rejects invalid records.
- **Writer:** saves accepted orders.

### Invalid records
If a record is invalid, the import stops before saving any records. The operator can correct the file and retry.

## Moving files between devices
Operators transfer files manually.

# Import permissions
The team must choose who can authorize an import before enabling writes.
```

In the design UI, the YAML summary stays visible while Markdown headings become closed nested sections. Each parent states what its children explain.

The authorization blocker remains visible before any section opens. The final section explains the decision needed. The Markdown starts with a heading because a preamble would only repeat the summary.

## Guarantees for a design reviewer

For a human reviewing a design, replace the implementation checklist:

> Validate IDs, revisions, payload fields, duplicate records, permissions, and destination paths. Acquire the shared lock, reread state, write a recovery record, and resume unfinished work before retrying.

With the reviewable contract:

> Reject stale or unauthorized changes. Recover interrupted writes before retrying, without duplicating records.

Keep any unresolved atomicity or authorization decision explicit. The shorter contract does not remove implementation requirements; their detailed enforcement belongs in implementation records.

## Use formatting to clarify the content

- Use bullets for distinct checks and numbered steps for actions that must happen in order
- Use a table when each option needs the same comparison fields
- Keep a connected explanation in prose when splitting it would hide the causal relationship
- Indent nested Markdown bullets four spaces and leave a blank line before a list
- Write `## Before you finish`, not `## Before You Finish.`
- In durable prose, write `proposals, designs, and tasks`, with the Oxford comma
- Report `12 tests pass` in words rather than relying on an icon
- Prefer parentheses for asides: `Use the local backend (no network needed)`
- Add a short parenthetical example when it clarifies ambiguity: `Reject reserved names (e.g., CON on Windows)`
