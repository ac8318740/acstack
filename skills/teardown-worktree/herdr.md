# Teardown worktree: herdr

The herdr branches of the teardown. Each section names the `SKILL.md` step it belongs to.

## Step 1 – herdr's answer

A herdr workspace holds tabs, and each tab holds panes. One status for the whole workspace therefore says nothing about the other tabs in it. So enumerate the panes before every removable verdict.

Start with the cheap hint:

```bash
herdr worktree list
herdr workspace list
```

Workspace status is only a hint. `working`, `blocked`, `idle`, or `done` can describe this session, which step 2 will move. `unknown` can hide another tab's agent. Always list every pane before deciding:

```bash
herdr pane list --workspace <workspace-id>
```

The listing covers every tab, not only the focused one. Each entry carries `pane_id`, `tab_id`, `agent`, `agent_status`, `cwd` and `foreground_cwd`.

Resolve this session's current pane id, initially from `$HERDR_PANE_ID`. After any move, refresh it as step 2 describes. Exclude only that verified pane by identifier, never by status. Every other pane still counts, whatever the workspace `agent_status` said. If identity is ambiguous, stop; do not exclude a guessed pane.

The `w26` teardown skipped this step. It read its own workspace's `done` as its own verdict, removed the workspace, and killed a live session in the second tab.

Excluding by `pane_id` keeps every other pane inside the check. The step 3 rules then stop the removal.

Then read what actually runs in each remaining pane:

```bash
herdr pane process-info --pane <pane-id>
```

Any one of these three makes the worktree a skip:

- The pane's `agent_status` is `working`, `blocked`, `idle` or `done`.
- `foreground_processes` holds an agent, `claude` or `codex` for example.
- A foreground process has a `cwd` inside the worktree's checkout path.

The third case is not an agent. An editor or `gh dash` counts here. Deleting the directory under it still breaks it.

Close it deliberately, or leave the worktree alone.

A `(deleted)` cwd signals a stale directory. Report it; it does not prove the pane is safe to remove. Other panes still block removal under step 3.

Cross-check the pane count against the tabs, every time:

```bash
herdr tab list --workspace <workspace-id>
```

Sum `pane_count` across the tabs. A sum above the number of rows `pane list` returned means the enumeration missed something. Skip the worktree and report it.

Name every blocking pane in the plan, so the user can close it deliberately.

## Step 2 – Host: herdr

When `active` is `herdr`, move the pane out first, or step 3 deletes the worktree under a pane still sitting in that workspace.

The move needs this pane's own identifier, and `active` being `herdr` does not guarantee it. The detector reports `herdr` when either of herdr's two environment markers holds a value, and only one of them names the pane. So if `$HERDR_PANE_ID` is empty, herdr's markers are incomplete – say so and stop, rather than issuing a pane move against a blank target.

Find the main repo's workspace in `herdr workspace list`: `worktree.repo_root` is the main checkout and `worktree.is_linked_worktree` is `false`. More than one workspace can match, since any pane opened at the repo root qualifies. Prefer the one whose label is the repo name, and ask when it stays ambiguous.

Then:

```bash
herdr pane move "$HERDR_PANE_ID" --new-tab --workspace <main-workspace-id> --focus
```

If no such workspace exists because it closed earlier, create one first:

```bash
herdr workspace create --cwd <main-root> --label <repo-name> --no-focus
```

Read the move result, then refresh `herdr pane list --workspace <main-workspace-id>` and `herdr pane process-info --pane <new-pane-id>`. A move can change the pane identifier; verify the same session or terminal at its destination and use its new identifier for subsequent checks. Stop if that match is ambiguous. Do not keep trusting the old `$HERDR_PANE_ID` after a move.

A pane move changes workspace membership. Verify the persistent harness cwd separately as `SKILL.md` step 2 requires, then continue teardown in this session. Keep the old checkout if either move cannot be verified.

## Step 3 – Owner: herdr

Which command to use depends on whether herdr still holds a workspace for the worktree. Read `open_workspace_id` from `herdr worktree list`.

With a workspace, enumerate its panes first:

```bash
herdr pane list --workspace <workspace-id>
```

Exclude only the verified current pane id from steps 1 and 2. Refuse the removal while any other pane remains. Name those pane ids to the user and move to the next worktree.

With the workspace clear, let herdr do it, so the sidebar row goes with the worktree:

```bash
herdr worktree remove --workspace <workspace-id> --force
```

Without a workspace, plain git:

```bash
git -C <main-root> worktree remove --force <path>
git -C <main-root> worktree prune
```

The worktree this session just left may still have a workspace. Moving the last pane out closes the workspace, and a pane in a second tab keeps it open.

So read `open_workspace_id` from `herdr worktree list` again after step 2. A workspace id still set means the pane enumeration above runs on that workspace too, before you remove anything.
