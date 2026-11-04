# Teardown worktree: ignored data and build outputs

What to do with the files git ignores. `SKILL.md` step 1 lists them, and step 5 cleans build outputs in worktrees that stay. Each section names the step it belongs to.

## Why ignored data needs its own check

`git worktree remove` deletes every ignored file in the checkout, with or without `--force`, and says nothing. The uncommitted-work check cannot see them, because `git status` hides ignored paths.

Ignored does not mean disposable. `.env`, local databases, Terraform state, backups, notebooks, and review or design output are often ignored precisely because they are local and unique. Clean, merged, idle, and done are not proof either.

## Step 1 – list and classify

List the ignored paths, collapsed to directories, with their sizes:

```bash
git -C <path> ls-files --others --ignored --exclude-standard --directory -z \
  | xargs -0 -r -I{} du -sh -- "<path>/{}"
```

Class each path as one of two things:

- **Rebuildable**: a tool-native command regenerates it from tracked files. The table below gives the common cases. Each one needs the tracked manifest or lockfile it names to exist in the checkout.
- **Preserve**: everything else. A generated-looking name or extension alone is not evidence. When unsure, preserve.

| Path | Rebuilt by | Needs tracked | Native clean |
|---|---|---|---|
| Cargo `target/` | `cargo build` | `Cargo.toml` | `cargo clean --manifest-path <path>/Cargo.toml` |
| `node_modules/` | `npm ci`, `pnpm install`, `yarn install` | the lockfile | `rm -rf <path>/node_modules` |
| `.next/`, `dist/`, `build/` | the project's build script | `package.json` naming that output | the project's `clean` script, or `rm -rf` the directory |
| `.terraform/providers/` | `terraform init` | `.terraform.lock.hcl` | `rm -rf <path>/.terraform/providers` |
| `__pycache__/`, `.pytest_cache/`, `.mypy_cache/`, `.ruff_cache/` | the next run | nothing | `rm -rf` the directory |

The listing collapses a wholly ignored directory to one line. Class that line by everything inside it, and list inside any directory that can mix the two classes:

```bash
du -sh -- <path>/.terraform/*
```

Only the `providers/` directory under `.terraform/` is rebuildable. The rest of `.terraform/`, `*.tfstate`, and `*.tfstate.backup` are state. Preserve them.

A Python virtual environment is preserve by default, even with a tracked requirements file. Packages installed by hand do not show up in it. Call it rebuildable only when the user confirms.

Prefer the project's own clean script when `package.json`, a `Makefile`, or `justfile` defines one. Read what it deletes first.

### What the sizes do and do not say

`du` reports allocated size. Hardlinked stores, such as pnpm's, free less than that when removed. A symlink costs nothing, and removal deletes the link, never its target.

Shared caches outside the checkout, such as `~/.cargo`, `~/.npm`, and the pip cache, serve every project. They are out of scope. Never clean them from a teardown.

### Data outside the checkout

Removal leaves behind what the session created elsewhere. Report the parts you can find. Never delete them from a teardown:

- Docker Compose containers and their volumes, when Docker is installed:

    ```bash
    docker ps -a --filter "label=com.docker.compose.project.working_dir=<path>" --format '{{.Names}} {{.Status}}'
    ```

- A Cargo target directory moved out by `CARGO_TARGET_DIR` or `.cargo/config.toml`

## Step 1 – what it means for the plan

Removing a worktree deletes everything ignored in it, so:

- Every ignored path rebuildable: the worktree can go. List the paths and total size in the plan.
- Any preserve path: skip the worktree. Name each preserve path and its size, so the user can move or delete it deliberately.

The user can approve losing a named preserve path in the plan. Only an explicit approval naming that path counts. A general yes to the plan does not.

## Step 5 – clean build outputs in kept worktrees

A worktree can be skipped from retirement and still hold gigabytes of build output. Cleaning that output is a separate decision from removing the worktree. It never retires the worktree, stops an agent, or closes a workspace.

Offer it for each kept worktree whose rebuildable paths total more than about 100 MB. List the paths, sizes, and the native clean command for each. The user picks which to run.

Clean a path only when step 1's live-agent checks found nothing running in that worktree. A live agent, editor, dev server, or build may be using the output, so report the size instead and leave it.

Rerun the live-agent checks immediately before each clean. Even then, finding no process is a snapshot, not a lock. Something can start using the path a moment later. Say so in the report rather than calling the clean safe.

Run the native command from the table, against absolute paths. Never run `git clean -X` or `git clean -x`. Either one deletes every preserve path along with the build output.
