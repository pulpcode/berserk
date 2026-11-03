# Frontend implementation notes

Date: 2026-10-26. Owner: continuous_frontend.

## Boundary

The existing UI could only read single-event preprocessing and task associations. This implementation projects the shared continuous contracts in the task description page, existing information rules/overview and workbench. It preserves the existing private conversation and explicit handling paths. No browser-owned DTO copies, model loop, report parsing, synthetic domain widgets or additional persistent column were added.

## Changes

- `src/web/ContinuousAssessments.tsx`: current task assessment cards with final narrative, task-specific change reason, fixed task revision, input cutoff, pending inputs and paused/retired status; explicit history/evidence/private discussion in existing native modal panel. Selected job remains pinned when a newer publication arrives. Draft scope includes job and task. Reuses ContextEvidence and InformationContinuation.
- `src/web/ContinuousRules.tsx`: common managed sources, intersected profiles/recipients, configuration generation boundary, explicit source-mode switch notice, paused backlog and recovery controls. Failed save retains editor and requires explicit read/merge; lost create response uses exact clientActionId receipt lookup.
- TaskHome/main integrate assessment below description and above independent composer. InformationCenter adds recipient-authorized records independently from source permissions and work-overview permission. A records-only seat defaults into that permitted tab.
- Workbench adds important continuous notifications with fixed job ID in URL and reuses InboxHandlingControl. Reading or publication does not mark handled, and marking handled retains the selected detail even when its row leaves the pending filter.
- InformationContinuation has an optional conversation-only presentation used only by continuous results; legacy background/conversation behavior remains unchanged.
- Shared desktop CSS uses existing `--line`, `--muted`, button and Panel styles, with wrapping controls and bounded report content. No phone-specific additions.

## Validation

- Applied trellis-before-dev and ui-ux-pro-max focused keyboard/async update guidance.
- Final scoped ESLint and git diff --check passed for new components, integration files and browser tests.
- Typecheck during shared implementation reported backend/test migration union and UUID narrowing failures; no frontend or scoped browser-test type errors remain. Main agent owns final shared typecheck.
- Added `tests/e2e/continuous.spec.ts` using real Fastify, SQLite and Pi native history with deterministic provider only. Covers fixed v1 discussion under v2, retained independent drafts, no model execution during read/history, recipient-only quiet unassigned results, and explicit important reminder handling.
- With main-agent coordination, ran `npm run test:e2e -- tests/e2e/continuous.spec.ts --workers=1`: **4 passed (35.9s)**. Includes actual private send asserting provider context contains pinned v1 and excludes v2; recipient-only quiet result and explicit reminder handling; public-task-only reader isolation; new config generation, retired readonly and epoch-specific pause/resume. No browser suite remains active.
- Screenshots visually inspected: `test-results/continuous-fixed-history.png` (1440px), `continuous-history-narrow-desktop.png` (900px, no horizontal overflow) and `continuous-config-generations.png`. Existing modal scrolling, actions and layout remain legible.

## Coordination / limitations

- Public routes/DTOs owned by continuous_backend. Current versions expose pauseReason/latestJobId; first-ever failure is visible to managers in configuration list even if there is no published task result.
- Continuous continuation currently supports private conversation only, no second background-analysis submission. The UI hides that action while leaving legacy UI unchanged.
- Final DTO adaptation renders raw event/task-revision inputs and authorized attachment download links, separates processingText from final narrative, and uses isCurrent for readonly retired configurations. Query evidence reuses authorized native query messages.
- Backend receipt lookup now returns the exact creation epoch even after retirement. Control requests use epochId; edits use logical stream ID and CAS. No-scope profiles are disabled in the continuous selector, with explanation.

## Final desktop-suite follow-up

The full-suite Chinese composition case failed before IME handling: retained trace `call@12426` resolved the message textarea as disabled, then invoked typing without an enabled-state wait. The input remained empty and the following category option never appeared; cleanup navigation obscured the original timeout. The unchanged isolated rerun passed. Applied the same explicit `expect(input(page)).toBeEnabled()` readiness assertion already used by its sibling case, only in `tests/e2e/references.spec.ts:255`; no product, timeout or cleanup changes.

Final combined validation: continuous 4 cases plus references Chinese case **5/5 passed**, with isolated Playwright output at `/private/tmp/axon-final-ui-checks`. Scoped ESLint and diff whitespace checks pass. The three continuous screenshots in `experiments/harness-lab/test-results/` were regenerated at 22:59 local time; original full-suite failure trace remains preserved.
