---
name: grilling
description: Interview technique for settling open decisions in rounds. A round asks the whole frontier – every question whose prerequisites are settled – numbered, each with a recommended answer, then recomputes and repeats. Use whenever decisions need a human and requirements are foggy, with or without a map. Called by /acstack:map for charting and frontier work; also usable directly in conversation.
---

# Grilling

Grilling settles open decisions by asking the user a whole round of questions
at once. One technique at two scales.

The frontier is the set of questions ready to ask – every open question with
settled prerequisites.

In conversation you work it out as you go. On a map – a stored graph of
question and work nodes – you ask the tracker for it. You limit it to `hitl`
nodes, meaning the ones a human must answer rather than an agent.

On the files backend:

`~/.claude/acstack/bin/acstack node frontier --map <name> --mode hitl`

The map skill's `trackers/` docs declare other backends. Same structure
either way – the only difference is whether the frontier outlives the
session.

## The round

1. **Compute the frontier.** Every question with settled prerequisites,
   nothing else. Never ask a question whose answer depends on one still open.

2. **Facts are your job, never the user's.** Skip a question that an
   environment fact would answer.

   Investigate directly or through useful delegation under the shared
   Implementation discipline in `orchestrator/AGENTS.md`. Fold the evidence
   into the round.

3. **Run it before you ask it.** Check whether running something could answer
   the question – behaviour, timing, output, or performance. If it could,
   build a throwaway prototype directly or through useful delegation:
    - Build it in `/tmp/acstack-proto/<node-id>/`, or
      `/tmp/acstack-proto/<short-slug>/` with no map
    - Import repo code by absolute path, and never create a prototype
      file inside the repo
    - Record the answer and its evidence, then delete the folder
    - Keep the evidence on the node, or in the conversation with no map

    Questions of taste, product, or preference still go to the user. No
    prototype code is ever copied into the repo – the real build goes
    under the shared Implementation discipline in `orchestrator/AGENTS.md`.

4. **Number the questions.** Attach a recommended answer to each, with one
   line of reasoning. A question you cannot recommend an answer for is usually
   two questions.

5. **Present the whole round at once** (see Presentation). One round, one
   message. Never trickle questions one at a time.

6. **Record each answer.** If no option matches, the reply itself is the
   answer, never the nearest option.

7. **Recompute the frontier.** Answers surface new questions and unblock old
   ones. Derive the next round fresh. Never continue down a list planned in
   advance.

## Presentation

`workflow.grilling.questions` in `.acstack/project.yaml` picks the mode:

| Value            | Behaviour                                                                            |
| ---------------- | ------------------------------------------------------------------------------------ |
| `tool` (default) | the host's question tool (AskUserQuestion on Claude Code), one call per round        |
| `inline`         | questions as prose in the reply – also what `tool` means on a host with no such tool |

**`tool` falls back to inline** for any round it cannot hold: more than 4
questions, or any question with no discrete options. Never split one round
across two tool calls – a round is the whole frontier, and splitting it
reintroduces the ordering the frontier exists to prevent. In tool mode, put
the recommended option first with "(Recommended)".

**Inline format**: numbered questions, options in a table, the recommended
option **bolded** with its one-line reason. Prose follows the `writing` skill.

Whichever mode runs, an open answer survives: if the user types something no
option covers, that text is the answer.

## Stop condition

Stop when the frontier is empty, or the user signals stop ("stop", "done",
"proceed").

There is no question cap. Settled prerequisites already bound the
frontier, and provenance keeps it narrow. Every question hangs off the
answer that surfaced it, so nothing unrelated can join the round.

A cap would be a blunt proxy for a guarantee the frontier definition
provides.

## On a map

When the questions are map nodes, each answer is a resolution – all through
the tracker's `update` and `create` operations:

1. Append the answer to the node body under `## Answer`. Mark the node
   resolved. On the files backend, one `acstack node update` call does both.

    Write the answer per the `writing` skill.

2. Create a node for each new question the answer surfaced, with `answers`
   naming the node that surfaced it. Mark precise questions `open`; mark the
   rest `fog`. If fog does not change the design, write the
   evidence or event that reopens it.

3. Invoke the `record-context` skill for each resolution – it decides whether
   the decision earns an ADR, a glossary term, both, or neither.

4. Redraw the resolved node's own diagram to mark the path you chose, then
   regenerate its parent's. The map skill's `visuals.md` holds the rules and
   the command.

5. Recompute the frontier with the tracker's query and present the next
   round.

**Example** – the `## Answer` body of a node asking whether map nodes
belong in git:

```markdown
## Answer

Map nodes stay local by default under `.acstack/maps/`.
The user can opt in through native root `.gitignore` exceptions.

The durable output is the living specs, the architecture decision records and
the glossary. The `record-context` skill extracts each one as a node
resolves, so nothing of lasting value leaves with the nodes.
```
