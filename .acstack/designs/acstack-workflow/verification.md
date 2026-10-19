# Design workflow verification

The developer approved the current design and manually verified the header controls; all required local checks pass before map closeout.

## Scope

- Branch: `design-doc`, with uncommitted changes after checkpoint `4550016`
- Planning: GitHub map `design-doc`, root #351, with contributions from #352, #353, and #354
- Authored entry: `.acstack/designs/acstack-workflow/design.yaml`
- Canonical review identity: `acstack-workflow`, separate from the original `acstack-design` review
- Portable example: `examples/design-doc/acstack/design.yaml`, intentionally unbound to this repository's GitHub map

## Required checks

| Check | Command or evidence | Result |
|---|---|---|
| Build and generated distributions | `npm --prefix cli run build && node scripts/gen-codex-agents.mjs && node scripts/gen-pi-agents.mjs` | Pass |
| Type checking | `npm --prefix cli run typecheck` | Pass |
| Lint | `npm --prefix cli run lint` | Pass |
| CLI tests | `npm --prefix cli test` | 1,791 tests pass across 54 files |
| Shell and integration suites | `bash tests/run-all.sh` | 1,489 tests pass across 15 suites |
| Whitespace | `git diff --check` | Pass |
| Prose review | `acstack lint-prose` over the review brief, CLI spec, and contributor guide | Three reviewed passive-voice suggestions; no missing actor changes the meaning |

The project has no configured frontend, formatter, test-collection command, or test-count baseline.
Standalone browser checks exercise the CLI's generated viewer independently of project frontend configuration.

## Product audit and regression protection

The audit followed planning, authored source, review comments, reconciliation, approval, implementation, archive, and explicit legacy migration.
It also checked skill discovery, host instruction delivery, settings, public commands, and the generated Markdown companion.

| Gap | Correction and evidence |
|---|---|
| Different comments could collapse during legacy import | Migration preserves distinct identities and anchors while recognizing repeated exports; real CLI regressions cover identities, aliases, retries, and unchanged source evidence |
| New source versions could lose selected historical obligations | Canonical history discovery carries meaningful selected feedback forward; invalid history fails closed with its filename and original error |
| A map root could reference an entry bound elsewhere | Status, reconciliation, and approval validate reciprocal tracker, map, and repository-relative entry bindings |
| Planning consumers lacked the validated binding | Status exposes the entry's exact `{ tracker, map }`, or literal `null` for an unbound example |
| Mermaid declared container identities twice | A container has one subgraph identity shared with relationship endpoints |
| The example described completed features as deferred | The example now explains current reconciliation, exact approval, explicit migration, and retained archive evidence |

Independent reviewers verified migration preservation, the approval and binding corrections, the diagnostic catch, and the real map-linked review's readiness.
The regression tests exercise actual CLI operations and filesystem effects rather than relying on mock counts.

## Host delivery

Localhost provider captures verified the canonical communication block in actual parent and delegated-child requests.
The captures used test provider responses; they prove instruction delivery, not model compliance or paid-provider behavior.

| Host | Parent | Delegated child |
|---|---|---|
| Claude Code 2.1.282 | Pass | Pass: source `task-checker` |
| Codex 0.163.0 | Pass | Pass: native `task-checker` role |
| Pi 1.3.0 | Pass | Pass: source `task-checker` |

- Codex needs enabled, trusted hooks; plugin installation alone does not grant hook execution
- Codex needs a fresh session after the first startup installs named roles
- The Codex smoke used native v1 role selection and an invocation-only trust bypass for reviewed test hooks
- No global hook-trust setting or provider configuration changed
- `CONTRIBUTING.md` records the operational prerequisites without recommending a global trust bypass

## Presentation checks

- Official Mermaid 11.17.2 parses and renders both Markdown companions into SVG
- Each diagram retains nine entities, two containers, six relationship endpoint pairs, and the bidirectional runtime/viewer arrow
- Desktop and 390-pixel mobile checks confirm readable document bullets and no page horizontal overflow
- Browser verification uses an independent disposable profile and only local GET requests
- The approval button becomes enabled after validated status responses return HTTP 200, without any approval click
- The real GitHub-backed status takes about 30 seconds in the final check; the button stays disabled while it loads
- Mermaid's default incoming CLI edge crosses the container heading slightly
- GitHub-hosted rendering remains unchecked; the official library runs locally

Evidence: `/tmp/acstack-design-doc-review/final-private-and-mermaid/report.md`, its JSON report, rendered SVGs, and screenshots.

## Publication feedback revision

The two human comments distinguish local source storage from optional GitHub publication.

- Original feedback remains unchanged in `.acstack/design-reviews/acstack-workflow/c25db945828b2faf/review.json`
- Both designs now identify local editable source, an optional published companion, and Git ignore rules that control tracking rather than publication
- Both GitHub and source-store drawers expose the explanation; the mirrored publication arrow explicitly says `Optionally`
- Independent review finds both comments addressed without an unresolved product decision
- Explicit reconciliation applies comments 0 and 1 and all three map contributions to revision `94011f77d29fadcf`
- The full CLI suite passes again with 1,789 tests across 54 files after these prose changes
- Official Mermaid rendering passes for both companions; desktop, mobile, and the expanded GitHub explanation pass read-only browser checks
- The earlier shell, build, lint, and type checks were not repeated for this prose-only revision

Evidence: `/tmp/acstack-design-doc-review/publication-feedback-review.md`, `publication-feedback-full-tests.log`, `publication-feedback-reconcile-result.json`, and `publication-feedback-render/report.json`.

## Header approval controls

- The header and document approval buttons share one confirmation modal and the existing exact-input approval checks
- The header shows `Approved` after successful approval
- The developer manually verified the latest UI and approved the real design
- The shared-control regression passes with the complete 1,791-test CLI suite
- Three stale label and root-wrapper tests were corrected with the developer's permission without weakening their behavior assertions
- Build, generated distributions, type checking, lint, and all 15 shell suites pass
- A temporary approval-request failure permits retry with fresh input checks; the independent regression failed before the one-line fix and passes afterward
- The map guidance keeps copyediting-only work exempt from design documents
- No duplicate browser pass was run after the developer's manual check

## Actual review state

- The live review serves the real GitHub-bound entry rather than the portable unbound example
- Three contributions have verified provenance to root #351
- Explicit `applied` receipts explain how the authored design incorporates each contribution
- The map has no unresolved blocking question
- CLI status confirms `approval.valid: true` for source revision `83675924924f158410b6e5a41b8f1c1450431dde5730f429114696a21f56ead1`
- The approval in `94011f77d29fadcf/review.json` binds the current source, comment revision and digest, map inputs, and selected historical feedback
- New comments or changed inputs require renewed reconciliation and approval

The original tracked review files remain unchanged from checkpoint `4550016`:

- `.acstack/design-reviews/acstack-design/9808f5f6cd7fc83f/review.json`
- `.acstack/design-reviews/acstack-design/b7a4e8b774ba6ba3/review.json`
- `.acstack/design-reviews/acstack-design/7be95ebe4ea155cb/review.json`

## Shipping authorization

The developer authorized map closeout and the gated shipping pipeline through a merge to `dev`.
Closeout retains authored designs, canonical reviews, imported evidence, and decision logs.
Pre-commit review, spec sync, continuous integration, and applicable pull-request review still gate shipping.
Promotion to `main` and worktree removal remain outside this authorization.

## Session evidence

- `/tmp/acstack-design-doc-review/packages-full-cli-final.log`
- `/tmp/acstack-design-doc-review/actual-workflow-status.json`
- `/tmp/acstack-design-doc-review/actual-workflow-reconciliation.json`
- `/tmp/acstack-design-doc-review/publication-feedback-reconciliation.json`
- `/tmp/acstack-design-doc-review/host-smoke/codex-native/verified-evidence.json`
- `/tmp/acstack-design-doc-review/standalone-final/report.md`
- `/tmp/acstack-design-doc-review/final-private-and-mermaid/report.md`

These temporary files supplement the results above; repository tests and authored artifacts provide the reproducible record.
