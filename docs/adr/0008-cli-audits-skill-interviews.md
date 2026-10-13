# The CLI audits, the skill interviews

`acstack config check` is the only health check in ACStack. It reports what is
wrong with a machine and a project. It changes nothing.

`/acstack:setup` reads that report, then asks the user what to do about each
failure. The skill writes the answers. Neither one does the other's job.

The check reads `~/.claude/settings.json` and the two project settings files,
even though Claude Code owns them and ACStack does not. A health check with a
row it cannot see is a health check nobody can trust.

## Considered options

ACStack had two commands named `check`.

The CLI's audited the host axes. The config skill's audited the project's
infrastructure in prose. Neither called the other, and a user could not tell
them apart by name.

Leaving the split in place keeps ACStack's CLI reading only ACStack's own
files. It also lets the two audits drift apart. It leaves the project half
untestable, because continuous integration cannot run prose in a skill body.

## Consequences

The check grows a `--json` output, so the skill maps a failing row to the fix
it offers. That output is an interface. Renaming a row identifier breaks the
skill silently, so the row identifiers need tests.

Every audit rule now lives in TypeScript and gets tested. No skill re-probes
the machine with its own shell commands.

A user who wants one setting changed runs `acstack config set <key> <value>`
and answers no questions. The full key reference lives in
`docs/config-reference.md`, because seventeen keys carry more nuance than a
help string holds.
