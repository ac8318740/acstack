# Durable records live in the repository; live state lives globally

ACStack stores project data in two homes chosen by the kind of data, and drops tracked mode.

- **Repository, read from the current worktree**: architecture decisions (`.acstack/decisions/`) and the glossary (`.acstack/CONTEXT.md`). Each is optional and is on only when it exists in the repository. Agents edit them on their own branch, and they merge through a pull request like code.
- **Global, a real folder at `~/.acstack/projects/<key>/`**: everything else, including `project.yaml`, maps on the files tracker, design reviews, handoffs, browser and verification state, and the test baseline.
- **Remote**: maps on the GitHub tracker stay in GitHub issues. Maps never live in Git.

## Why

Tracked mode put the one shared project folder inside the main checkout's `.acstack/`. Every agent in every worktree wrote maps, claims, and records into that working tree, which left `dev` dirty and blocked `git pull`. The two kinds of data need different homes:

- Live coordination (maps, claims, review comments, handoffs) must be one copy that every worktree sees at once. It belongs to no branch and needs no review.
- Durable records (decisions, glossary) need versioning and review, and they belong to a branch like code.

## Considered options

- All global. Rejected: decisions and the glossary leave version control, so a clone loses them and they skip review.
- All in the repository, per worktree. Rejected: each worktree gets its own maps, so parallel agents stop seeing each other's claims.
- Keep tracked mode. Rejected: it causes the dirty `dev` and pull collisions this decision fixes.
- Maps committed in Git. Rejected for the same reason as per-worktree maps; teams that want shared, visible maps use the GitHub tracker.

## Consequences

- Supersedes the tracked mode of ADR 0019; `project-data mode` and the project-folder symlink are removed
- `acstack project-data migrate` converts tracked projects and asks before moving a global project's decisions or glossary into the repository
- Design reviews belong to their map and are removed when it is archived
- `project.yaml` stays global and drops keys nothing reads; personal preferences (`workflow.handoff.*`, `workflow.grilling.questions`) move to the user-level config
