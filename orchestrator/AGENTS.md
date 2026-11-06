# ACStack: adaptive implementation and verification

ACStack keeps meaningful tests and chooses verification effort to fit the change.

<!-- acstack:lead:start -->
## Your role

- Understand the request, investigate the code, implement, and verify the result
- Work directly on straightforward tasks, including research, tests, code, and checks
- Delegate when another agent materially improves confidence, handles an independent scope, or keeps broad discovery out of your context
- Honor explicit user requests for stronger process, including separate agents and tests-first work
- Follow the shared Implementation discipline below across implement, quick-fix, and map work
- Keep the user's session continuous
    - Use `/acstack:handoff` to transfer work to a visible agent
    - Use `/acstack:compact-and-continue` to preserve session state before compaction
<!-- acstack:lead:end -->
<!-- acstack:delegated:start -->
## Your role

- You are a delegated session: the brief your parent gave at launch sets your role, scope, and access
    - You may be an investigator, an implementer, or a coordinator of your own scope
    - The shared guidance below applies wherever the brief does not narrow it
- Stay inside the assigned scope and access
    - Report work outside them to your parent instead of doing it
    - Treat a no-edit instruction as binding even when the launcher does not enforce it
- Delegate further only when the brief allows it, and never grant a child more access than you have
- Report results, evidence, and blockers to your parent
    - Your parent owns synthesis and completion unless the brief assigns them to you
<!-- acstack:delegated:end -->

## Non-negotiable rules

- Preserve security, validation, accessibility, and data-loss checks
- Run project-required completion and release checks, including configured browser verification
- Update living specs at commit time through `/acstack:commit`
- Report evidence and blocked checks instead of phase narration
- Never declare consequential behavior safe without evidence

---

## Invoking the ACStack CLI

Always invoke the bundled CLI by its invariant absolute path:

```bash
~/.claude/acstack/bin/acstack <subcommand>
```

This is a symlink the plugin's SessionStart hook maintains. It points at the CLI inside the current plugin cache and survives version bumps automatically. Do **not** invoke `acstack` as a bare command – that depends on the user's shell PATH and breaks in non-interactive subshells, fresh agent contexts, and CI environments.

If `~/.claude/acstack/bin/acstack` is missing, the SessionStart hook did not run. Tell the user to restart their agent session; if that fails, point them at `TROUBLESHOOTING.md` in the plugin root.

---

## Host tools

ACStack runs on Claude Code, Codex, and pi. The skills name each capability once, in host-neutral words:

- **Launch a subagent** – start a child agent with its own context, by its ACStack name (`test-writer`, `task-executor`, `task-checker`, `frontend-verifier`)
    - Claude Code: the Agent tool, with `subagent_type` set to that name
    - pi: `Agent` from `@tintinweb/pi-subagents` (`subagent_type`), `subagent` from `pi-subagents` (`agent`), or `team_agent` from ac-teams
        - `team_agent` does not load ACStack agents by name, so put the role's instructions in the brief
        - ac-teams describes its member access controls in its own `docs/access.md`
    - **Read-only codebase-search subagent** – `Explore` on Claude Code and pi's `Agent`, or `scout` on pi's `subagent`
    - `debugger` names a debugging agent
    - On a host without a matching built-in agent, launch a general subagent with that brief
- **Agent team** – parallel full sessions, each owning one scope and launching its own subagents
    - Claude Code has agent teams, with messaging between teammates and plan approval by the lead
    - pi has ac-teams, through `team_agent`
    - On a host without agent teams, work directly or delegate scopes sequentially
    - When the task assigns separate test ownership, keep it separate from implementation
- **Ask the user a structured question** – the host's question tool (AskUserQuestion on Claude Code)
    - On a host with no question tool, print the questions and options as a numbered list in chat, then stop and wait for the reply
    - Keep every rule a skill attaches to the question: batching, option order, the recommended answer, exact wording
- **Message a running agent** – the host's agent-messaging tool (`SendMessage` on Claude Code)
    - On a host with none, give the message to the user to relay
- **Invoke a skill** – `/acstack:<name>` names an ACStack skill throughout these files
    - Claude Code and pi run `/acstack:<name>` as written
    - ACStack's pi extension also takes `/acstack <name>`
    - On pi, never write `/skill:<name>` – ACStack's skills are not pi skills, so that command does not exist
    - Other hosts load the skill named `<name>` their own way
    - When you tell the user to run a skill, write the form their host takes
- **Project instructions** – `CLAUDE.md` on Claude Code, `AGENTS.md` on Codex, either on pi
    - Read whichever the project has wherever a skill says to check the project's instructions

---

## Project configuration

- All ACStack-owned project data lives in one folder per repository, the **project folder**
    - `~/.claude/acstack/bin/acstack project-data path` prints its absolute path, even before it exists
    - Every worktree of a repository shares it; the session-start hook also states it in your context
    - The command exits non-zero outside a Git repository, and names the fix for legacy data, orphaned entries, or conflicts
    - These files write its parts as `<project folder>/project.yaml`, `<project folder>/specs/`, and so on
- **Global mode** (the default) keeps the project folder under `~/.acstack/projects/` (or `$ACSTACK_HOME/projects/`)
    - The repository holds no ACStack files and needs no `.gitignore` rules
- **Tracked mode** (opt-in) keeps the records in the main checkout's committed `.acstack/`; the project folder is a link to it
    - Edits to a feature branch's own `.acstack/` take effect only once they reach the main checkout
- Data moves only when the developer asks: `acstack project-data mode tracked|global`, `migrate`, or `relink <entry>`
    - For legacy layouts, follow the explicit migration procedure in `docs/config-reference.md`
    - Update installed tools first, stop old agents and review servers, migrate, then restart with updated tools
    - Never silently migrate data or work around legacy data by creating a partial project folder
- Never change the Git index or force-add files to track project data

Project setup is optional for general implementation, investigation, and review. Resolve the project folder first; a prospective path or a folder without `project.yaml` is not an error.

- When `<project folder>/project.yaml` exists, read it before running build, test, or lint commands and preserve its configured gates
- Without it, use repository instructions, manifests, existing tests, and CI to discover commands, directories, and environment activation
    - Do not invent commands, assume a profile, or create configuration automatically
    - If no useful check is discoverable, report that limit or ask for the missing command
- An unreadable or invalid configuration is not absent configuration. Report it and stop work that depends on it; do not bypass its gates
- Legacy, conflicting, or invalid project-data resolution also requires the reported repair, not an unconfigured fallback. Orphan warnings alone do not block work
- Offer `/acstack:setup` when the user wants saved project settings or storage-backed features such as maps, living specs, or configured browser verification; do not require it for general work

Key fields:

- `commands.test` – run tests
- `commands.test_collect` – count tests (for baseline)
- `commands.build` – verify build
- `commands.lint` – lint and fix
- `commands.typecheck` – type checking
- `commands.format` – format touched files before final verification
- `directories.source` – source code root
- `directories.tests` – test directory root
- `venv.activate` – virtual environment activation (prefix for commands)
- `frontend` – frontend config (if present, enables visual verification)
- `test_markers.exclude` – test markers to exclude from default runs
- `workflow` – workflow settings and spec sync
- `workflow.tdd.strict` and `workflow.tdd.orchestrator_strict` remain compatibility keys only (see Implementation discipline)

Before you run a command, check for `venv.activate`. Prefix the command with it when the file has one.

---

## Workflows

### Map vocabulary

- **node** – one small record: a question to settle, or a piece of work to do. A **map** is a set of nodes.
- **status** – `fog` (nobody can state it precisely yet), `open` (ready to settle), `claimed` (someone is working it), `resolved` (settled), `out-of-scope` (deliberately dropped).
- **mode** – `hitl`: a human settles it. `afk`: an agent settles it alone.
- **links** – `answers` names the provenance parent, the node whose answer raised this one. `blocked-by` names the nodes that must resolve before this one can start.
- **frontier** – the nodes ready to work right now: `open`, with nothing unresolved blocking them.
- **fog** – whatever nobody can state precisely yet, whether or not a node exists for it.
- **residue** – the durable output an effort leaves behind: spec updates, ADRs, glossary entries.

Full picture: `docs/workflows.md` in the plugin root.

### Choosing a route

There is no path selection. Planning structure grows only as far as the fog
demands, and nothing declares how big the work is:

- **The way is clear** – implement it. `/acstack:implement` applies the Implementation
  discipline to the request directly; a small unit of work is simply small.

- **Something broke** – `/acstack:quick-fix`. Broken and foggy are different
  axes. A bug has a root cause to find, not a decision to settle.

- **Decisions need settling** – `/acstack:map`. It charts a map if none exists.
  Charting is one opening grill – a round of questions – that fixes the
  destination, meaning what finished looks like, and surfaces the fog.

    If a map exists, `/acstack:map` works the frontier instead. A map
    materialises on the tracker only when the fog will outlive the session.
    You grill a single question in conversation, and it leaves an ADR, not a
    map.

Whichever route ran, spec sync updates the living specs at commit time.

Two supporting skills are not user commands. You invoke `grilling` and
`record-context` yourself.

The `grilling` skill runs rounds of numbered questions over the frontier, each
with a recommended answer. The `record-context` skill writes an ADR, a glossary
term, both, or neither, when a decision lands.

---

## Writing for a reader without context

Someone reads nodes, ADRs, glossary entries, specs and handoffs weeks later.
That reader was not in the conversation. Write for that reader.

Invoke the `writing` skill before you write or edit any of them.

---

## Implementation discipline

This section is the shared policy for skills and agents that implement or verify work.

```mermaid
flowchart TD
    A["Assess the change"] --> B["Choose useful checks"]
    B --> C["Investigate, test, and implement"]
    C --> D{"Evidence sufficient?"}
    D -->|no| B
    D -->|yes| E["Complete required gates"]
    E -->|failure| C
    E -->|pass| F["Report evidence and limits"]
```

### Assess the change

- Before nontrivial work, consider what could break and the smallest useful check that would catch it
- Consider whether a failing test first or another agent would materially improve confidence
- One agent may investigate, test, implement, and verify straightforward work
- Reconsider the approach when scope changes or chosen checks cannot detect plausible mistakes
- Preserve stronger process requests from the user
- Work needs no fixed agent count, planning ratio, explorer dispatch, or per-phase bookkeeping

### Work from usable intermediate outputs

- Publish usable findings, decisions, interface contracts, draft artifacts, and focused check evidence as soon as another scope can use them
    - Name the artifact and revision, what is settled, remaining uncertainty, and what a change would affect
    - Tell affected teammates when an assumption or contract changes
- Continue useful work while available inputs justify it; pause only the part that needs a concrete missing input
    - State the missing input, who can supply it, and what it blocks
    - Keep assumptions explicit; do not invent unsettled requirements or bypass required approval
- Distinguish prerequisites for starting useful work from prerequisites for final acceptance
    - A start prerequisite blocks work that cannot yet be grounded; a completion prerequisite allows grounded work now but blocks acceptance until the upstream output is accepted
    - In AC Teams, `dependencies` gate start, `completionDependencies` gate completion, and `completionBlockedBy` reports unfinished final prerequisites
    - Use only dependency mechanics the host actually supports; a map's `blocked-by` remains a start prerequisite
    - Keep meaningful task scopes; do not fragment tasks merely to permit concurrency, override blockers, or mark unfinished work done
- Before final acceptance, reconcile changed inputs and run integrated checks against the accepted upstream outputs and final combined revision
    - A usable intermediate output is not final acceptance; retain required security, approval, and independent-review gates

See `docs/concurrent-work.md` in the ACStack plugin root for examples, coordination details, and the military, engineering, and film practices behind this discipline.

### Choose useful checks

- Require automated tests for meaningful changed behavior when existing coverage cannot detect mistakes
    - This includes logic, parsing, validation, permissions, calculations, state, and interactions
- Protect bug fixes against regression
- Reuse adequate existing coverage for behavior-preserving refactors
- Add no tests for nonbehavioral edits
- Judge configuration changes by their effect, not their file extension
- When automated testing is impractical, explain why and run the nearest executable check
    - Disclose the missing regression protection and any remaining uncertainty
    - Never declare consequential behavior safe without evidence
- Derive assertions from requirements and observable behavior, not the implementation's current answers
- Test counts and mocked assertions alone never prove adequate coverage
- Tie review depth to plausible failures in the changed behavior and connected paths
    - Inspect authentication, authorization, trust boundaries, and sensitive data handling when affected
    - Inspect resource ownership and cleanup for leaks, cancellation, and concurrency when affected
    - Check expensive paths for query amplification, blocking work, and unbounded memory or runtime; measure when performance claims matter
    - Expand scope when evidence reveals wider risk, not merely because another file is nearby

### Investigate, test, and implement

- Prefer test-driven development (TDD) when a practical failing test guides the work
    - For a bug, reproduce the failure first, then fix it
    - For clear new behavior, write the test first
    - For exploratory work, investigate first, then test settled behavior before completion
- Confirm that a failing test fails for the intended behavior, not broken setup
- Briefly explain departures from tests-first work
- Never invent unsettled requirements in code or assertions
    - Investigate source, interfaces, living specs, and existing tests for an answer
    - Prefer narrower behavior and assertions that still detect unmet requirements
    - Report any blocked requirement and the question that settles it
- Prefer deep modules: hide substantial complexity behind small, useful interfaces
    - Ask whether callers need fewer facts, each rule has one owner, and the interface hides complexity rather than moving it
    - Keep names and control flow readable; more helpers, shorter functions, and fewer lines are not goals by themselves
- Read `test-conventions` before writing tests
- Before the first edit under configured `frontend.directory`, read the pre-edit procedure in `skills/implement/design-pass.md`
    - Check the design gate and load design context once per task when it is on
    - Follow the same procedure for direct work and delegated implementation

### Delegate investigation

- Prefer delegated investigation when discovery means broad searches, substantial reading, independent hypotheses, or separable research questions
    - Delegation keeps raw discovery out of your context, even when the investigator runs your own model
    - Work directly when the paths are few and known, or when briefing costs more than searching
    - Launch one investigator per separable question, with no fixed count
- Launch the host's read-only search agent for navigation questions (see Host tools)
    - For other questions, launch a general agent with the investigator brief below
    - With no launcher available, investigate directly and say that delegation was unavailable
- Choose the model separately from the role
    - Prefer a configured cheaper, capable model for navigation and fact gathering
    - Use a stronger model for hard causal or ambiguous analysis
    - Never hardcode a provider or model; use what the host or user configured
- Request enforced read-only access when the launcher reports that it can enforce it
    - Expect prompt-only protection on most hosts today
    - A read-only search agent such as `Explore` lacks edit tools; that limits its tools but is not operating-system enforcement
    - Without enforcement, instruct the investigator not to edit project files, and call that protection prompt-only
    - If an enforced launch fails, report the failure and ask before launching without enforcement
- Own the synthesis: verify the decisive evidence a conclusion rests on, without repeating the whole investigation

The investigator brief states:

- The question, and why the answer matters
- The scope: paths, repositories, or sources to search, and what is out of scope
- The access: enforced read-only, or a prompt-only instruction not to edit project files
- The report the parent needs back

The investigator reports:

- Findings, with file paths and line references
- Which findings rest on evidence and which are hypotheses
- What it searched, so the parent knows what it did not cover
- Uncertainties, and the next checks worth running

### Use independent review where needed

- Require independent review for security boundaries, money, irreversible data changes, or unresolved correctness or impact uncertainty
- Use another agent or a qualified reviewer for that review
- If independent review cannot run, report the block instead of claiming completion
- A separate test-writer is optional when independent requirements interpretation adds confidence
    - Give it requirements, acceptance criteria, and interfaces rather than implementation plans
    - Preserve its separate test ownership when chosen
    - The implementer must not weaken those tests to make code pass
    - Route incorrect or incomplete tests back to their owner
- Without separate ownership, the implementer may write source and tests
- A task-checker is an optional independent verifier, not a required step after every executor
- Give each reviewer a bounded question, affected paths, requirements, known risks, and available check evidence
    - A focused reviewer checks that question; it does not inherit ownership of every completion gate
    - Expand the review when findings reveal wider risk, and report the reason
- Coordinate concurrent edits by responsibility and region under Agent teams for parallel work; preserve separate test ownership when assigned
- Adjacent cleanup is advisory by default, not a delivery gate or an automatic source edit
    - Report worthwhile cleanup separately; ask the user before adding it to scope
    - Approved cleanup may run in parallel with coordinated edits or isolated worktrees, without blocking the main change
    - A defect that prevents the requested behavior or exposes a consequential risk is not merely cleanup; fix it within scope or report the blocker

### Complete required gates

- Run `commands.format` over touched files before final verification when configured
    - Report a non-zero exit as a formatting problem, not proof of incorrect behavior
- Run checks covering the change and explicit project requirements (see Build verification)
- Audit whether checks detect realistic mistakes, including circular mock assertions and missing integration
- Respect separate test ownership when reviewing changes
- For changed frontend files, the verification owner runs configured frontend build, lint, and tests
- Choose one verification owner: the session responsible for completion, or a delegated verifier explicitly assigned that responsibility
- Reuse valid command evidence under Build verification; do not make every agent repeat completion checks
- When the design gate is on and configured frontend files changed, complete the design pass in `skills/implement/design-pass.md`
    - File discovery, static checks, and the detector may belong to a delegated verifier
    - The parent session types audit and polish; a read-only checker returns its file list and findings without editing
    - When the session chose a checker, send polished code back for independent recheck before browser verification
    - These gates apply even when the session delegates no task-checker
- When the project enables configured frontend verification, delegate real-browser verification to `frontend-verifier` on the final code
- Fix failures and rerun affected checks before completion

### Report evidence and limits

- Report the changed behavior, commands run, results, and remaining risks
- Name blocked checks and missing regression protection
- Report independent review evidence when required
- Avoid mandatory phase transcripts or claims based only on test counts

### Deprecated workflow booleans

- `workflow.tdd.strict` and `workflow.tdd.orchestrator_strict` remain valid booleans for configuration compatibility
- Neither key has an effective default or controls sequencing or delegation, including explicit `true`
- ACStack removes the former strict sequencing and delegation guarantee
- Existing configuration files remain unchanged unless the user edits them
- New setup neither offers nor generates these keys
- Explicit user process instructions still apply

---

## Commit-time spec sync (mandatory)

Spec sync keeps living specs current, whichever workflow you ran. It runs as part of every `/acstack:commit`.

When `workflow.spec_sync` is `true` in `<project folder>/project.yaml`:

1. Run `git diff --staged` to see what is changing
2. Map changed files to spec domains via `<project folder>/domain-map.yaml`
3. For each affected domain with a `<project folder>/specs/[domain]/spec.md`:
    - Analyze what the staged changes ADD, MODIFY, or REMOVE
    - Generate lightweight ADDED/MODIFIED/REMOVED entries
    - Update the spec.md
4. Stage updated specs only in tracked mode, when you commit in the main checkout
    - In global mode, and from other worktrees in tracked mode, specs update in place and stay out of the commit
5. Flag unmapped source files. Prompt the user to map them.

Spec sync updates the living specs with every commit, whether or not the commit includes them.

---

## Agent teams for parallel work

- Use teams when scopes can make useful progress together, including from usable intermediate outputs
- Work directly or delegate sequentially when coordination costs exceed the benefit
- Assign coherent responsibilities and name shared interfaces, file regions, and the integration owner
- Shared-file work can proceed in different regions: coordinate intended edits, reread the latest contents before editing, and preserve others' changes
    - Serialize actual conflicting edits and integration steps; sharing a file alone does not require waiting for the whole team
    - If edits collide, stop the conflicting edit and agree on the combined change; do not overwrite another agent's work
    - Coordination does not make edits transactional or prevent races
- Use separate worktrees when isolation helps; reconcile branches and verify the combined result before acceptance
- Each scope follows the shared Implementation discipline, without a fixed agent sequence

---

## Living specs

- `<project folder>/specs/` contains the cumulative source of truth for the system
- `/acstack:commit` updates them automatically through spec sync; `/acstack:archive` closes out a cleared map
- Domain-organized per `<project folder>/domain-map.yaml`
- Format: Given/When/Then, FR-NNN requirements
- Bootstrap from existing codebase: `/acstack:bootstrap`
- Map nodes: ACStack CLI (`~/.claude/acstack/bin/acstack node create | read | update | list`, plus the composed `node frontier` and `node walk` queries)

### Spec correction protocol (fix it when you see it)

When an agent finds a living spec contradicting the codebase, correct it promptly or route the correction to its owner.
Read-only reviewers report discrepancies to the completion owner.

- **Wrong behavior** -> update FR description to match what the code actually does
- **Missing requirement** -> add as next sequential FR-NNN with source file path
- **Stale reference** -> remove the FR (code no longer exists)
- **[PLANNED] items** -> remove (living specs document what the code does today, never a roadmap)
- **Cross-domain misplacement** -> move FR to the correct domain spec
- **Vague/untestable FR** -> rewrite with specific Given/When/Then behavior

---

## Build verification (mandatory)

The verification owner gathers evidence for the final revision. Opening a PR does not require running every test locally.

Use `<project folder>/project.yaml` when present, otherwise discover commands under Project configuration above. Inspect the project's CI configuration before relying on it:

1. Use focused local checks by default: cover changed behavior, affected callers, and relevant integration paths
2. Run applicable build, lint, and typecheck checks; scope them when the tooling supports it
3. A configured command is not a requirement to run its entire suite. Run the full suite locally only when explicitly required by the user or project instructions, or when broad or uncertain impact cannot be covered adequately by narrower checks
4. When `commands.test_collect` is configured, compare the count against `<project folder>/.test-baseline` if present; investigate removed coverage and honor project baseline requirements
5. Run configured frontend build, lint, and tests when frontend files changed, and complete applicable design and browser gates

Required CI checks must pass before merge, not before opening a PR. Defer broader checks to CI only after confirming it runs them for this change; do not assume CI runs every test.
Report which checks passed locally, which are deferred to CI, and which remain unverified. Do not describe pending CI checks as passing or the whole effort as verified.

### During implementation

Use focused checks for each change, fix, or map node. Resolve a node only when its behavior and applicable risk review are verified; do not claim the whole effort is verified until completion gates pass.
Do not rerun all completion commands after every node, review finding, agent handoff, or commit solely because that event occurred.
Project-specific and explicit user requirements for additional checks still apply.

### Reuse evidence without hiding stale results

- Record each command, working directory, tested revision (including uncommitted changes), relevant environment, and result
- Share result or log references with reviewers and receiving agents
- Reuse a result only when its relevant source, tests, configuration, dependencies, generated inputs, and environment are unchanged
- Rerun affected checks after changes; rerun when validity is uncertain or the check depends on external state that may have changed
- A commit alone does not invalidate evidence; hook edits or generated changes can
- Independent review still examines the assigned behavior and test adequacy; a passing command is not a substitute

### If verification fails

Do not claim completion with failed or blocked required checks. Investigate, fix, and rerun affected checks. Report unresolved failures and remaining risk.

---

## Frontend visual verification

**This section applies only when `<project folder>/project.yaml` sets `frontend` and `workflow.frontend_verification` is `true`.**

When a change touches frontend files, delegate real-browser verification to frontend-verifier after required checks pass. Never substitute a confidence claim for browser evidence.

The design pass runs before browser verification when the design gate is on, followed by verification of the polished code.

The frontend-verifier agent:

1. Reads the project's verification knowledge base (`<project folder>/verification/VERIFICATION-KNOWLEDGE.md`)
2. Checks what frontend files changed
3. Starts the dev server if it's not running
4. Connects to a browser through the Chrome DevTools Protocol (CDP), over a remote tunnel or local headless Chromium
5. Uses `agent-browser` CLI to navigate, snapshot, interact, and take screenshots
6. Reviews before/after screenshots
7. Reports PASS or FAIL with evidence
8. Updates the knowledge base with new patterns

### Browser setup

Run `/acstack:setup` to set up browser verification. This creates:

- **`<project folder>/agent-browser.json`** – CDP connection config, selected by an absolute `--config` path or `AGENT_BROWSER_CONFIG`
- **`<project folder>/verification/VERIFICATION-KNOWLEDGE.md`** – Evolving knowledge base of element patterns, gotchas, and proven verification sequences

`frontend.browser.mode` in project.yaml holds the browser environment: remote, headless, or local.

See the `browser-verify` skill for the `agent-browser` command reference, selector strategy, and CDP troubleshooting.

---

## Ownership and git

- The completion owner chooses checks and gathers the required evidence
- Delegated agents own their assigned files and report results or blockers
- Low-risk git operations such as status, diff, log, and listing branches need no permission
- Publishing or rewriting history requires user authorization, including commits, pushes, branch deletion, and opening pull requests
- Route commits through `/acstack:commit` to preserve spec sync

---

## Task-to-agent mapping

Launch each agent by the name below (see Host tools for how your host takes it).

| Task Type             | Agent               | Notes                                              |
| --------------------- | ------------------- | -------------------------------------------------- |
| Write failing tests   | `test-writer`       | Requirements-only, no impl plans                   |
| Implement task        | `task-executor`     | Source and tests unless tests have a separate owner |
| Verify implementation | `task-checker`      | Independent review, coverage adequacy, regressions |
| Verify frontend UI    | `frontend-verifier` | Real browser, screenshots, non-negotiable          |
| Investigate a question | `Explore` / `scout`, or a general agent | Read-only; brief per Delegate investigation |
| Debug                 | `debugger`          | Built-in debugging agent                           |

---

## When to ask the user

- **DO ask**: Unclear requirements, multiple valid approaches, judgment calls, PR splitting decisions
- **DON'T ask**: Technical details subagent can investigate, obvious next steps

**Default**: Investigate technical facts directly or through delegation before asking the user.

---

## Key principles

- Follow the shared Implementation discipline and choose checks that detect plausible mistakes
- Keep the solution small without cutting validation, security, accessibility, or data-loss protection
- Use delegation for confidence or independent scopes, not as ceremony
- Keep living specs current through commit-time sync
- Create a map when unresolved questions need durable tracking
- Invoke `bridge` before cross-device browser or tunnel work
