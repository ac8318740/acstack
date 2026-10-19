# Writing examples

These examples apply the shared communication standard in `../../output-styles/ac-writing-style.md` without prescribing one shape for every answer.

## A short reply needs only the answer

- Write: The build passes
- Avoid: `## Context`, `## Problem`, and `## Solution` sections to report a successful build

## Preserve the reason when it changes the action

- Write: Don't cache the token; it expires in five minutes
- Avoid: Don't cache the token
    - The shorter version omits the constraint that explains the recommendation
- Write: The hook writes the symlink
- Avoid: The hook writes the symlink, which means the symlink gets created
    - The second clause adds no information

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

## Use formatting to clarify the content

- Use bullets for distinct checks and numbered steps for actions that must happen in order
- Use a table when each option needs the same comparison fields
- Keep a connected explanation in prose when splitting it would hide the causal relationship
- Indent nested Markdown bullets four spaces and leave a blank line before a list
- Write `## Before you finish`, not `## Before You Finish.`
- Write `proposals, designs, and tasks`, with the Oxford comma
- Report `12 tests pass` in words rather than relying on an icon
