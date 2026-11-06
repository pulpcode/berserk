# v0.2 implementation review

Reviewed on 2026-11-06 against approved plan commit `6987d34`. This review covers the source v4 snapshot/bootstrap, host initialization and activation recovery, human source creation, actual director navigation, source-rule examples and deterministic business-flow tests. No product-code defect remained after tracing the current implementation. The reviewer made no product-code change and no commit.

## Findings fixed

- `tests/scenario-business-flow.test.ts`: the previous tests rejected creation after replay, but did not explicitly suspend a submitted request across the transition. Added a reached/release barrier before the existing creation handler. The new case submits from A, activates B, releases the old request, then checks 409, exact A/B opening-task mappings, no task or action receipt, and preserved A event ownership/hash/native bytes. It does not alter an unsourced creation path.
- `.trellis/spec/backend/{scenario-director,scenario-run-isolation,task-information,background-execution}.md` and the frontend index: replaced stale fixed-three-task and suggestion-required descriptions with the implemented versioned manifest, human source creation, per-event deduplication, privacy and all-bound archive contracts. Documented actual GET-only director navigation and explicit example-rule installation. Kept SIM-TASK-002 and further distractor evaluation deferred.

## Traced evidence

- `ScenarioStore.get` rejects unknown snapshot schemas, descriptor/definition mismatches and incomplete/duplicate task sets; version 1 snapshots retain the exact legacy three-task requirement. New instances save schema 2 plus the explicit T02/T03 bootstrap descriptor. Old messages, hashes, actions and native histories are not rewritten by the upgrade.
- `ScenarioTasks.prepare/read/initialize/requireReady` compare full saved definitions and bootstrap metadata with authenticated source provenance. Original task actions recover a commit whose mapping acknowledgment was lost; a conflicting saved task ID is rejected. Stable creation IDs are written before task effects. Existing activation pending-receipt and authorization boundaries remain in place.
- `ScenarioTasks.archive` queries every task with the old persisted owner, rather than only the opening manifest. Existing admissions, background reservations and unfinished-work checks still apply; a task that cannot archive retains its actual state and becomes read-only.
- `TaskLinkService.authorize/createFromSuggestion` require readable successful preprocessing results, current business eligibility and public-task authority. The exact parent supplies ownership; no active-run fallback was added. One SQLite transaction covers task/action/manual link/receipt. The event-wide receipt scan happens inside it, so different-job concurrent submissions cannot create duplicates. Existing API tests synchronize two such POSTs and assert one task/action/creation receipt, retained original job/input and no model/workspace side effect.
- `TaskLinksView` checks the original creation job separately from the selected readable job. Current manual links/revisions and retry responses also require the pinned override job to be readable. Business task projections remove internal ownership and retain read-only state. Public task association grants no additional source access.
- `BackgroundStore.listJobs` is persisted `rowid DESC`; event detail preserves that order and removes unreadable assessment content. `DirectorEventTasks` selects the latest successful recorded batch, falling back to the latest successful job only when none has a judgment, then reads current manual links. Excluded links and already displayed actual IDs are filtered. It issues GETs only; author task labels or equal names cannot create a navigation link. History author labels remain plain text.
- Source/profile fixtures keep the two existing mapped sources, ordinary native preprocessing and overall-seat fixed delivery. They contain no per-event task answers, new host loop, automatic task creation/assignment or new distractor cases.

## Verification

- Reviewer `npm run typecheck`: pass.
- Reviewer `npm run lint` (including dependency boundaries): pass.
- `git diff --check`: pass.
- Main session reports full Vitest pass: 136 files / 1543 tests with `--maxWorkers=2`; build passed. This collection preceded the newly added barrier case and final probe changes.
- Main session owns the final focused run of `scenario-business-flow` (now three cases) plus `probe-scenario-budget`, then affected desktop Playwright with one worker. Those final results must be recorded by the main session; this review does not predeclare them.

## Remaining scope and evidence limits

No unresolved product finding was identified in the reviewed paths. SIM-TASK-002 unsourced/global creation remains intentionally unchanged; SIM-EVAL-001 additional unrelated reports remains deferred. Deterministic providers and scripted collaboration establish engineering behavior only. Real-model execution, reasoning quality, semantic review, costs and any deployment decision need their own retained evidence; a successful job, delivery or scripted work transition is not semantic acceptance.
