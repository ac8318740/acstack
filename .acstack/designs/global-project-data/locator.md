## How the Project locator finds a project

1. Ask Git for the shared git folder: `git rev-parse --path-format=absolute --git-common-dir`
2. Resolve that path to its real path, so a symlinked checkout path gives the same key
3. Build the key: the main checkout's folder name, a hyphen, and the first 6 hex characters of the SHA-256 of the real path, for example `shop-3f9a2c`
4. Look up `<root>/projects/<key>`, where `<root>` is `ACSTACK_HOME` or `~/.acstack`
    - A real folder means global mode
    - A link means tracked mode; the target is `<main checkout>/.acstack`
    - No entry, with a committed `.acstack/project.yaml` in the main checkout: create the link (a junction on Windows), then use tracked mode
    - No entry, and another `<name>-*` entry records a repo path that no longer exists: report the orphan and name `project-data relink`
    - No entry otherwise: the project has no ACStack data yet

The main checkout is the parent of the shared git folder. Outside a Git repository there is no key, and commands that need project data say so.

A global-mode folder records its shared git folder in `project.json`, so an orphan can be matched to its moved repo.
