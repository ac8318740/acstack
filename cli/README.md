# acstack-cli

The command-line half of [ACStack](https://github.com/ac8318740/acstack) – a
map-based agentic coding workflow where an agent plans changes as a graph of
nodes before writing code.

**ACStack does not publish this CLI to npm. You do not need to install it.**
It ships inside the ACStack plugin as a prebuilt bundle.

The plugin's SessionStart hook links it into place. See
[CONTRIBUTING.md](../CONTRIBUTING.md) for why.

## What it does

The CLI owns the project state. It reads and writes `acstack/project.yaml` and
the change graph beside it, and it does nothing else – no model calls, no
network.

| Command | Purpose |
|---|---|
| `acstack list` | List active changes or specs |
| `acstack show <name>` | Display a change or spec |
| `acstack node create/get/set` | Read and write graph nodes |
| `acstack node walk/frontier/path` | Traverse the graph |
| `acstack archive` | Archive a completed change |
| `acstack config` | Read and write project config |
| `acstack feedback` | Record feedback against a node |

Run `acstack --help`, or `acstack <command> --help`, for the full surface.

Any other subcommand runs `acstack-<name>` from PATH, the way git does.

## Using it from another agent harness

Nothing stops you. The binary is on PATH at `~/.local/bin/acstack` on any
machine with the plugin installed, and it has no Claude Code dependency.

What it does not give you is the *method*. ACStack ships that separately,
as skills and agent definitions that tell an agent how to use these commands.

The CLI runs the commands. The skills and agent definitions define the
workflow.

## Requirements

Node 20 or newer. The bundle contains everything it needs and installs no
dependencies.
