---
name: writing
description: Apply ACStack's shared communication standard to durable artifacts, including specs, decisions, map nodes, handoffs, documentation, and pull request bodies. Read before writing or editing them.
---

# Writing

Write durable artifacts so a reader outside the conversation can understand the current answer and act on it.

## Load the shared standard

Read `../../output-styles/ac-writing-style.md` relative to this skill directory before writing your first artifact in a session.
Read `examples.md` beside this skill for examples of applying that standard.

The marked communication block in the output style is the canonical source for both chat and durable prose.
Claude Code loads the output style and its hook extracts that block on user turns.
The pi extension injects the style and extracts the same block.
Read the file even when your host does not inject it; a reference alone does not load its instructions.

## Make the artifact stand alone

- State the current behavior, decision, or requested action before its supporting detail
- Include the context a future reader cannot recover from the conversation
    - Name relevant files, commands, actors, and constraints
    - Explain unfamiliar project terms before relying on them
    - Keep necessary trade-offs, failure conditions, and evidence
- Put decision history in a separate section when it helps explain the current answer
- Read `../visual-docs/SKILL.md` for longer explanations or relationships that need a diagram, if you have not read it this session
- Keep the shared standard in its canonical file instead of maintaining copies here

## Review for meaning before mechanics

- Read the artifact as someone unfamiliar with this repository
- Cut words only when the reader loses no necessary information
- Check that terms, identifiers, and links match the source being described
- Read `vocabulary.md` for common simpler alternatives and punctuation conventions
    - Treat word suggestions in context; a technical term or quotation can need the original wording
- Run `~/.claude/acstack/bin/acstack lint-prose <paths>` when available
    - The command warns and never blocks
    - Its sentence, paragraph, passive-voice, and vocabulary checks are heuristics, not proof of unclear or incorrect writing
    - Review each warning; preserve wording when changing it would lose meaning or accuracy

ACStack draws on ASD-STE100 (Simplified Technical English) for plain-language techniques, not its licensed dictionary or mandatory length limits.
