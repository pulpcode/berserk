# Final Trellis review — 2026-10-13

This report covers the implementation review, not deployment approval or a claim that every acceptance scenario passed. The parent session owns the full-suite results and final implementation validation record. No source simulator writes, notifications or commits were performed by this reviewer.

## Findings fixed by reviewer

1. `src/annotations/service.ts`: `update_object` merged untrusted `changes.sourceRefs` before the source-scope scan. Non-array values or null entries threw TypeError rather than the controlled INVALID_INPUT response. Validate the merged feature before scope iteration. The regression covers three malformed structures, HTTP error status 400 at the service boundary, unchanged revision and absent receipt.
2. `src/pi/annotation-tools.ts`: receipt lookup checked the actor but did not check the captured task. A known action ID from another task could reveal its receipt to the model running in the current task. Reject nonmatching taskId with ANNOTATION_NOT_FOUND; preserve the authorized global user HTTP receipt behavior. Regression uses two real task workspaces under one actor.
3. `tests/pi/annotations.test.ts`: added native automatic-compaction coverage. An r1 selection is retained, the draft advances to r2 with different coordinates, Pi compacts through its real default path, and the tool rereads r1 geometry. No host summary implementation or history rewriting was introduced.
4. `.trellis/spec/backend/map-annotations.md`: recorded the receipt scope, validation ordering and editing-base invariants.
5. `src/annotations/service.ts`: after the parent approved the design interpretation, comparison now traces fixed ancestor revisions and checks IDs in the common baseline snapshot. Regressions cover sibling branches independently creating the same short ID and an ancestor adding the same ID after the branch point.

## Findings delegated to the owning UI implementer

- A form opened on r1 used the refreshed binding head r2 when eventually saving all old fields, allowing a silent overwrite. Capture the editing revision/base at form/drawing start; only explicit conflict review may advance it. The implementer confirmed the issue and is adding the browser regression.
- Comparing an own draft with a reference could not isolate the own side: the UI looked up `annotationKey(ref)` against a group keyed `own`. Match by the group's version reference.
- Confirmed mutation receipts cleared pending state but left the submitted geometry/form buffer marked unsaved. Reconcile only the corresponding submitted input.
- Initial fixed annotation selections currently load a version; scope-specific layer/object navigation must honor the selection for positioning/visibility without suggesting that every object was selected.
- Source group text should not hardcode simulated status independently of actual source metadata.

The reviewer inspected the owner's subsequent code: fixed editing starts are passed from form/drawing to apply, queryReceipt returns the acknowledged receipt, own-group comparison uses version references, initial selection scopes drive geometry positioning, and the source group now uses neutral text. Unfinished drawing counts as dirty. A capturing popstate guard preserves an unsaved editor when the user cancels navigation; review caught a local `history` state variable shadowing the browser API, and the owner corrected it to `window.history`. Same-version initial references with different object selectors now use selector-aware view deduplication. Both final corrections were verified in the frozen source. The browser owner is rerunning five regression tests; those are not recorded as passing here solely from code inspection.

## Design finding raised to parent

The parent approved an object-aware common-fixed-baseline check using existing immutable snapshots, with no new storage or public ID restriction. That correction is implemented and tested. Remaining identity convention: deleting and later reusing an ID within the same lineage still means the same logical object. Enforcing globally unique creation identities across the full history was deliberately not introduced.

## Coverage and remaining limitations

- Backend review traced actor capture, seat/task/session checks, monotonic source restrictions, private-origin redaction on read and derivation, immutable publication hashes, short transaction CAS/idempotency, archival admission, and v1/v7/v8 migration handling.
- Native Pi review traced v1 byte-compatible message generation, v2 validation, fixed annotationRefs, bounded metadata, excluded child/background annotation tools, captured accounts and text-only queue boundaries.
- Existing browser coverage includes independent drafts/publication/current selection, explicit references, Terra Draw point/line/polygon/text and drag, page reload, no-WebGL coordinate editing, and direct stale-save conflict. Refresh-before-save is a distinct race and needs its new regression.
- Not yet demonstrated by existing browser tests at review time: delayed old task/session responses, overlap picking, browser history navigation with unsaved input, style reload restoration and lost-response receipt reconciliation. A successful three-test browser suite cannot stand for every scenario listed in implement.md.
- Native compaction fixed-reference reread is now directly tested. Exact token measurements and sustained many-turn accumulated context costs remain separate from byte limits and the small-vs-large automatic-context regression.
- Initial real-provider probe failed without tool calls. The Pi owner subsequently isolated a provider incompatibility in tuple-valued JSON Schema `items`; the fixed-length array schema retains stricter latitude validation in the service. The parent reports the five-step real-provider core probe passed after correction; extended model semantics remain separately recorded by its owner. Deterministic tools and schema compilation alone do not prove natural-language correctness.

## Reviewer verification

- Backend targeted tests: 12/12 passed after malformed-update and common-baseline fixes.
- Pi targeted tests: 11/11 passed, including cross-task receipts and native compaction reread.
- Scoped ESLint: passed after fixing a prefer-const issue in the new compaction test.
- TypeCheck: passed after the first reviewer fix and again after the provider-schema tuple typing repair. The final browser navigation edits occurred subsequently, so the parent/UI final gate remains required.
- `git diff --check`: passed at review checkpoint.
- Full-suite lint, build, unit tests and Playwright are run by the parent/UI owner. Their final results belong in the overall validation record.

Reviewer status: source review complete; reviewer fixes and targeted regressions are ready. No unassigned blocking code finding remains. Final delivery must still use the parent/UI owner's results from checks run against the frozen implementation, and keep the untested scenarios above explicit.


## Parent integration closeout

Final frozen-code gate on 2026-10-13: full typecheck, lint/dependency boundaries, 71 Vitest files / 745 tests and production build passed. The real provider's twelve scenarios and observed behavior limitations are recorded in pi-live-acceptance.md. Browser back protection now uses the existing App pop entry's cancelable event; final targeted back, overlap and actual WebGL rendering scenarios passed. The serial eight-case rerun passed 8/8 (52.3s), including both earlier browser timeouts and all six annotation scenarios. Full-browser failures remain in the evidence. Final evidence is in implementation-validation.md.
