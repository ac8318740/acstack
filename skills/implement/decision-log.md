# The decision log

An afk run has no human watching it. The decision log is how that human later
sees what the agent chose, and why. Read this file before you write the first
row.

## When to write a row

Write one row per decision point, never one per action:

- **A fork chosen** – two ways to build something, and you picked one
- **A unit verified** – a node's verification passed, or a build verification went green
- **A revert** – you undid work, and the row names what triggered it
- **A blocker** – something stopped the node, and the row names it

Running a test, reading a file, or dispatching a subagent is an action. It
gets no row.

## Where the log lives

The log is one file per map, in the project folder:
`<project folder>/decision-logs/<name>.tsv`. The project folder is the path
`~/.claude/acstack/bin/acstack project-data path` prints. Every worktree of the
repository shares it, so a log survives when its worktree is removed and
`archive` can still read it. The `<name>` is the map name you pass to `--map`.

```bash
log="$(~/.claude/acstack/bin/acstack project-data path)/decision-logs/<name>.tsv"
```

- If `project-data path` fails because legacy project records exist, stop and pass its message on
    - Tell the user to update installed tools, stop old agents and review servers, and run `acstack project-data migrate` before restarting
    - Never move records automatically or create a partial project folder to work around legacy data
- Create `decision-logs/` in the project folder if it is missing

## What a row holds

A row is one tab-separated line with six columns, in this order:

| Column | Holds |
| --- | --- |
| `ts` | the time, in ISO 8601 |
| `node` | the node id |
| `decision` | what you chose, verified, reverted, or hit |
| `why` | the reason, in one short phrase |
| `evidence` | a pointer: a commit SHA, a `file:line`, or a path |
| `result` | what happened next |

- **Evidence is a pointer, never prose**, so a reader can follow it to the proof
- **Keep tabs and newlines out of every field**, because each one breaks the row

## Append only

Never edit or delete a row. A wrong call gets a new row that supersedes it,
and its `why` names the row it replaces.

`/acstack:archive` reads the log before it closes the map. It hands lasting
decisions to `record-context` and retains the original log independently of `workflow.maps.persist`.
