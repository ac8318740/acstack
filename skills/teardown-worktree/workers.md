# Retiring integrated dirty workers

A stopped worker can remain dirty after its contributions were copied into another checkout and shipped. Treat it as a removal candidate only after accounting for every change, preserving a recovery copy, and obtaining explicit approval. A merged branch tip proves nothing about uncommitted work.

This exception applies only to known workers of the completed effort. Unknown provenance, unrelated changes, or uncertain integration means keep the worktree and report the uncertainty. All owner, merge, ignored-data, live-session, and cwd checks in `SKILL.md` still apply. Orca still refuses dirty trees; leave those checkouts in place without forcing or resetting them.

## Account for every change

1. Establish the worker's provenance from its task or session records: assigned scope, base commit, integration destination, and stopped status. A directory name or the sender's recollection alone is insufficient.
2. Record its HEAD, branch, submodule status, and full status. Inspect staged and unstaged changes separately, including binary changes, deletions, renames, file modes, and symlink targets:

    ```bash
    git -C <path> status --porcelain=v1 -uall --ignore-submodules=all
    git -C <path> diff --binary --cached
    git -C <path> diff --binary
    git -C <path> ls-files --others --exclude-standard -z
    ```

    Read every untracked file or directory from that inventory; tracked diffs omit them. Classify dependency links and generated output separately under `artifacts.md`. Inspect submodule working trees when present; ignoring their status above does not establish that they hold no unique work.

3. Pin the shipped integration commit and show it is reachable from an integration branch. For each changed or untracked path, record where its contribution landed. Use content comparisons and commit diffs. When integration renamed, refined, or replaced the contribution, explain the differences with specific destination paths and commits. Patch equality can establish an exact copy; a failed equality check proves neither loss nor integration.

4. Put the resulting path-by-path evidence in the plan. Every change must be accounted for as integrated or deliberately superseded by the shipped work. Unique or unexplained content means keep the worktree. Passing tests, a merged PR, and branch ancestry alone cannot account for dirty content.

## Preserve recovery before requesting removal

Create a recovery copy outside every checkout scheduled for removal. Use a private directory, preserve file contents, modes, and symlinks without following their targets, and include staged and unstaged binary patches, HEAD and branch identifiers, the inventory, and the integration evidence. Preserve the index state as well as the working files. Include untracked and ignored preserve data; omit only paths individually established as rebuildable. Do not put secrets in shared logs.

Verify recovery by restoring into an independent repository and comparing the saved files, modes, symlink text, and staged/unstaged changes to the worker. Include the base and index objects and any submodule recovery state; the restore must not depend on Git metadata or object alternates inside a checkout being removed. A patch alone cannot recover untracked files or ignored data. Report the recovery location and verification result; leave the recovery copy in place after teardown.

Check whether remaining worktrees depend on paths inside this worker (for example, a `node_modules` symlink). A recovery copy does not keep those paths usable. Keep the worker until any dependency repair is separately approved and verified. Never follow a symlink when copying or deleting its containing tree.

## Obtain approval and recheck

Label the plan entry `integrated dirty worker`. Name the exact worktree, dirty paths, integration evidence, recovery location, and any ignored preserve paths. Ask explicitly to discard this worker copy's named uncommitted changes. A general cleanup request or an earlier approval covering other worktrees does not authorize this exception. Ignored preserve paths still require the path-specific approval in `artifacts.md`.

Immediately before removal, rerun liveness checks and compare HEAD, index, tracked and untracked contents, modes, symlinks, and ignored-data inventory against the verified recovery snapshot. Status text alone cannot detect an edit to an already-modified file. Any change invalidates the approval: stop, refresh the evidence and recovery copy, and ask again. Never reset, stash, clean, or commit the worker merely to make its status pass.

Only after these checks may the owner-specific removal in `SKILL.md` step 3 use `--force` for this approved worker. Branch deletion still requires its own merged-branch check. Report the discarded dirty paths and retained recovery location separately from clean worktree removals.
