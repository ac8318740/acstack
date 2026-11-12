# Concurrent work from usable intermediate outputs

Publish useful outputs early so related work can proceed before every upstream task finishes. State what is settled, what remains uncertain, and which work would change if an input changes. Accept the combined result only after upstream acceptance, integration checks, and required review.

The active rules live under Implementation discipline in [`orchestrator/AGENTS.md`](../orchestrator/AGENTS.md). This document explains how to apply them and the practices they draw on.

## Start when inputs support useful work

A task may need an accepted upstream result before it can start. Another may already have enough evidence to begin, while still needing that result before final acceptance.

| Prerequisite | Effect | Example |
| --- | --- | --- |
| Start | Wait until the required input is accepted | A migration needs the approved data-retention rule before choosing what to delete |
| Completion | Begin grounded work; wait for upstream acceptance before finishing | A client uses a published API draft while the API owner validates compatibility |

For the client, publish the draft's revision, request and response examples, unresolved error behavior, and affected callers. The client can implement agreed fields and write focused tests now. It pauses the error-handling branch if that input is missing. Before acceptance, reconcile the accepted API and run client/server integration checks.

In AC Teams, existing `dependencies` remain start prerequisites. `completionDependencies` express final prerequisites; `completionBlockedBy` reports which are unfinished. Use these mechanics only on hosts that support them. ACStack map `blocked-by` links still block start; they do not gain completion-only semantics.

Keep the two meaningful tasks. Do not split them into artificial stages just to make the tracker allow concurrency, remove a real blocker, or mark unfinished work accepted.

## Make intermediate outputs usable

Share an artifact or decision when another scope can act on it. A useful update identifies:

- The path or link and revision, with the finding, contract, or focused check evidence.
- What consumers can rely on and which assumptions remain provisional.
- The likely impact if an assumption changes, including affected callers or tests.
- Any concrete missing input, its owner, and the part of the work it blocks.

Notify consumers when the contract changes. Continue the parts still justified by available inputs. Ask for the missing decision where needed; do not fill it with an invented requirement. Required user approval, security checks, and consequential independent review still apply.

## Coordinate edits and verify the combined result

Assign responsibilities, shared interfaces, and an integration owner. Each writer works in its own checkout, under Solo and Team modes in `orchestrator/AGENTS.md`, so edits never race. The lead merges the branches and reconciles conflicts.

Focused checks support intermediate decisions. Final acceptance requires accepted upstream outputs, reconciliation of changed assumptions, and checks against the final combined revision. Reuse earlier evidence only while its relevant inputs remain unchanged. Report any blocked check or unresolved risk.

## Established practices explain the pace and safeguards

These practices show how teams exchange enough information to act before all work is final. Their application to coding agents is ACStack's adaptation; none supplies permission to bypass acceptance checks.

### Military planning shares intent and early orders

The Marine Corps' [MCDP 5, *Planning*](https://www.marines.mil/portals/1/publications/mcdp%205%20planning.pdf) describes parallel planning across echelons with continuous coordination. [MCTP 3-20C, chapter 5](https://www.marines.mil/portals/1/Publications/MCTP%203-20C%20GN.pdf?ver=2019-01-31-114859-677) describes warning orders that pass early information so subordinate planning can begin before the complete order is ready. Planning continues as the situation develops.

The Army's [ADP 6-0, *Mission Command*](https://rdl.train.army.mil/catalog-ws/view/100.ATSC/1FE33715-CFD1-4614-A489-B3E0480C3F80-1428688882108/adp6_0.pdf) connects shared understanding and clear commander's intent with disciplined initiative. People can act within a common purpose and constraints as circumstances change. Initiative carries responsibility for staying aligned with that intent.

For ACStack, give teammates the destination, constraints, current decisions, and useful early findings promptly. Let them act within that scope while other work develops. Changes affecting another scope require an update; missing authority or a concrete essential input requires a pause of the affected work.

### JPL Team X updates a shared design concurrently

NASA's [*What is Team X?*](https://ntrs.nasa.gov/citations/20130009192) describes JPL's concurrent engineering team: diverse specialists work in real time, in the same place, with shared data to produce an integrated mission design. Specialists see and respond to the effects of each other's design choices during the study.

For ACStack, publish a shared interface or design draft early, with its assumptions and revision. Consumers can test consequences while the owner refines it. When a change affects another subsystem, reconcile that impact together rather than waiting for a supposedly complete handoff. The integrated result still needs validation.

### Film editors assemble dailies while shooting continues

Frame.io's [*Editing stages*](https://workflow.frame.io/guide/editing-stages), under "Assembly Edit", describes editors building an assembly from the previous day's dailies while production continues shooting. This rough assembly gives scenes structure and can reveal unusable or missing shots while reshoots are still practical. Avid's [NEXIS | EDGE introduction](https://www.avid.com/resource-center/avid-nexis-edge-intro) describes access to dailies during production so editorial work can begin early.

For ACStack, deliver usable increments for integration as they become available. An early assembly exposes missing interfaces or incompatible behavior while their owners can still respond. The assembly remains provisional; final acceptance waits for the completed inputs and finishing checks.
