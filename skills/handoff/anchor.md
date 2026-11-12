# What a handoff or anchor carries

The `handoff` and `compact-and-continue` skills both read this file. A handoff
note goes to another agent; an anchor survives a compaction in this session.
Both are written for a reader that no longer has this conversation.

## Reference state, never copy it

A note that restates the repository is a second copy of it, correct only at the
moment you wrote it. If the reader can learn something by running a command, it
should run the command.

| Do not write it down        | The reader gets it from                                                            |
| --------------------------- | ---------------------------------------------------------------------------------- |
| Map state and reading order | `~/.claude/acstack/bin/acstack node walk --map <name>` (reading order of the map)  |
| What can be worked next     | `~/.claude/acstack/bin/acstack node frontier --map <name>` (what is workable now)  |
| Files in flight             | `git status --short` and `git diff`                                                |
| Test baseline, last result  | `<project folder>/.test-baseline` and referenced check logs; reuse valid evidence under the shared policy |
| What the code does          | the code and its tests                                                             |

On GitHub, `--map` refuses – pipe `gh issue list` into `--stdin` per the map
skill's `trackers/github.md`.

The same applies to architecture decision records, issues, and commits.
Reference records and check logs by path or URL, with the tested revision,
environment, command, and result. A handoff or compaction alone does not require
a suite rerun. Anchor evidence that exists only in the conversation.

**Do not search the codebase for this.** Build the note from what is already in
context. If you are about to search source files, stop: the conversation holds it.

## The five things only the note can carry

Nothing on disk records these, so whatever you leave out is lost.

1. **Next action**: the single concrete thing to do first
2. **Decisions made**: so nobody reopens and re-argues them
3. **Open questions and blockers**: including anything waiting on the user
4. **Agent-team coordination**: each scope, its agent and checkout, the shared
   interfaces, and the integration owner. Carry usable
   intermediate outputs, remaining uncertainty, change impact, and start or
   completion prerequisites not already recorded elsewhere
5. **Suggested skills**: which skills the reader should invoke, by name

Omit any that do not apply. Do not pad. Prose follows the `writing` skill.

Head the note with these sections, dropping any with nothing under it: Next
action, Decisions made, Open questions and blockers, Agent-team plan, Suggested
skills, References. References holds the commands from the table above.

## Redaction

The note leaves the conversation. Strip credentials, tokens, API keys,
connection strings, and personal data before writing. Reference where a secret
lives, never its value. This is not optional.
