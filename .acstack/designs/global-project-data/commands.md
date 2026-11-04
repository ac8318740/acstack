## Project data commands

| Command | What it does |
|---|---|
| `acstack project-data migrate` | Moves legacy global files and this repo's legacy `.acstack/` into the new layout |
| `acstack project-data mode tracked` | Moves the project folder's contents into the main checkout's `.acstack/` and replaces the folder with a link |
| `acstack project-data mode global` | Moves the main checkout's `.acstack/` into the project folder and removes the link |
| `acstack project-data relink` | Renames an orphaned entry to the current key and updates its recorded path or link |

Every command:

- Preflights every move and aborts on a collision without writing anything
- Never changes the Git index, commits, or force-adds files
- Refuses while another worktree of the repo has uncommitted `.acstack/` changes it would overwrite

`project-data ensure` is removed. Its only job was the managed `.gitignore` baseline, which this design removes.
