# mapflow-cli

The command-line half of [Mapflow](https://github.com/ac8318740/spechub) – a
map-based agentic coding workflow where an agent plans changes as a graph of
nodes before writing code.

**Mapflow does not publish this CLI to npm. You do not need to install it.**
It ships inside the Mapflow plugin as a prebuilt bundle.

The plugin's SessionStart hook links it into place. See
[CONTRIBUTING.md](../CONTRIBUTING.md) for why.

## What it does

The CLI owns the project state. It reads and writes `mapflow/project.yaml` and
the change graph beside it, and it does nothing else – no model calls, no
network.

| Command | Purpose |
|---|---|
| `mapflow list` | List active changes or specs |
| `mapflow show <name>` | Display a change or spec |
| `mapflow node create/get/set` | Read and write graph nodes |
| `mapflow node walk/frontier/path` | Traverse the graph |
| `mapflow archive` | Archive a completed change |
| `mapflow config` | Read and write project config |
| `mapflow feedback` | Record feedback against a node |

Run `mapflow --help`, or `mapflow <command> --help`, for the full surface.

Any other subcommand runs `mapflow-<name>` from PATH, the way git does.

## Using it from another agent harness

Nothing stops you. The binary is on PATH at `~/.local/bin/mapflow` on any
machine with the plugin installed, and it has no Claude Code dependency.

What it does not give you is the *method*. Mapflow ships that separately,
as skills and agent definitions that tell an agent how to use these commands.

The CLI runs the commands. The skills and agent definitions define the
workflow.

## Requirements

Node 20 or newer. The bundle contains everything it needs and installs no
dependencies.
