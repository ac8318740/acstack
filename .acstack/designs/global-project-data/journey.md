## Proposed change

ACStack moves every machine-wide setting and every project's records into one root, `~/.acstack/`. Each repository gets one entry, `~/.acstack/projects/<key>/`, shared by all of its worktrees.

- **Global mode (default).** The project's records live in that folder. The repository holds no ACStack files and needs no `.gitignore` rules
- **Tracked mode (opt-in, per project).** The records stay in the repository's committed `.acstack/`. The project entry is a link into the main checkout's `.acstack/`, so `ls -l ~/.acstack/projects/` still shows every project

Today ACStack spreads data over four places: each checkout's git-ignored `.acstack/`, `~/.config/acstack/`, `~/.local/share/acstack/`, and `~/.acstack/` itself, which holds `ac-teams/`.

### Review questions

1. Is the split between the Project locator, the Settings resolver, and the Project data commands the right set of responsibilities in the CLI?
2. When `project-data migrate` finds `.acstack/` files already in the Git index, should it choose tracked mode automatically? The proposal says yes: tracking was already the developer's choice, and nothing moves.
3. When a project folder and a committed `.acstack/` both exist, for example after a teammate pushes tracked data to a repo you used in global mode, should ACStack refuse and ask the developer to choose with `project-data mode`? The proposal says yes.
4. Is the accepted caveat for tracked mode acceptable: edits on a feature branch's own `.acstack/` take effect only after they reach the main checkout?

### Trade-offs to judge

| Choice | Gain | Cost |
|---|---|---|
| Whole-project tracking, not per part | One root per project; no `.gitignore` management | A project can no longer track only specs and decisions |
| Key from the shared git folder's path | Every worktree finds the same entry with no setup | Moving the repo on disk orphans the entry until `project-data relink` runs |
| Link from global into the repo, not the reverse | Teammates' clones get real files, not a broken link | Tracked mode reads the main checkout's copy, not the current worktree's |
| Explicit migration only | Nothing moves silently | Every developer runs one command per machine and per project |

## Settled decisions

The developer settled these on 2026-11-02:

- Everything under `.acstack/` moves: settings, specs, maps, designs, design reviews, decision logs, decisions, verification knowledge, and handoffs
- Tracked mode covers the whole project; there is no per-part tracking
- `project-data ensure` and the managed root `.gitignore` baseline are removed
- Every global file moves, including `~/.config/acstack/*` and `~/.local/share/acstack/*`
- `ACSTACK_HOME` overrides the root; ACStack no longer reads the `XDG_*` variables
- On Windows, tracked mode uses a directory junction, which needs no special privilege
- After migration ACStack does not read the old locations. While legacy data exists, it warns once per session and names `project-data migrate`
- `~/.acstack/ac-teams/` stays where it is; the ac-teams repository owns it

## Worked journeys

### A developer starts ACStack in a new repository

1. The developer opens an agent in `~/projects/shop` and runs `/acstack:setup`
2. The Project locator asks Git for the shared git folder, `/home/dev/projects/shop/.git`, and derives the key `shop-3f9a2c`
3. Setup writes `project.yaml` into `~/.acstack/projects/shop-3f9a2c/`. **Changed:** setup used to write the repo's `.acstack/` and a managed `.gitignore` block
4. Later, a worktree at `~/.herdr/worktrees/shop/feat-x` reports the same shared git folder, so it reads the same project folder

### The developer opts a project into tracked mode

1. The developer runs `acstack project-data mode tracked` from any worktree
2. The command moves the folder's contents into the main checkout's `.acstack/`, then replaces the folder with a link to it
3. The developer commits `.acstack/`
4. A teammate clones the repo. On first use the Project locator finds no entry, sees a committed `.acstack/project.yaml` in the main checkout, and creates the link automatically

`acstack project-data mode global` reverses the move. It removes the files from the working tree and leaves deleting them from Git to the developer's next commit.

### The developer migrates an existing machine

1. ACStack warns that legacy data exists and names `acstack project-data migrate`
2. The developer updates installed tools and stops old agents and review servers, as the current legacy migration already requires
3. From each repository, the developer runs `acstack project-data migrate`
    - The first run also moves `~/.config/acstack/*` to `~/.acstack/` and `~/.local/share/acstack/*` to `~/.acstack/cache/`
    - A repo whose `.acstack/` files are in the Git index becomes tracked mode, and only the link is created (review question 2)
    - Otherwise the repo's `.acstack/` moves into its project folder, and the managed `.gitignore` block is removed
4. The command preflights every move and aborts on a collision without writing anything

### A repository moves on disk

1. The developer moves `~/projects/shop` to `~/work/shop`. The new shared git folder gives a new key, which has no entry
2. The Project locator finds an entry named `shop-*` whose recorded repo path no longer exists, and prints `acstack project-data relink`
3. Relink renames the entry to the new key and updates its recorded path, or its link target in tracked mode

## Effect on other work

The large-read guard (branch `feat/large-read-guard`) reads its settings through one function. This change repoints that function at the Settings resolver; the guard's callers do not change.
