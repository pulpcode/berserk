# Information-to-Task Contract

## 1. Scope / Trigger

Read when changing task assessment, information associations, task suggestions or task-based continuation. Use `background/task-links.ts` as the shared permission/version service for browser routes and model tools. Pi JSONL remains the authority for analysis text and tool evidence; associations add metadata only.

## 2. Signatures

- The current application version is v5 (see [seat delivery](seat-delivery.md)); the v4 increment adds `information_task_overrides(event_id, task_id, job_id, data)` with a unique event/task pair. Upgrade v3 additively; keep account, handoff, background and native history data. All database owners must accept the same version.
- `TaskLinkService.recordAssessment(jobId, input, observed, toolCallId, signal?)` binds model output to its actual preprocessing job and observed task revisions.
- `TaskLinkService.list/detail/resolve/links/update/createFromSuggestion` serve all readers and mutations.
- `GET /api/tasks/:taskId/information` accepts query/sourceId/offset/limit and returns `TaskInformationPage`: page items/count plus `sources: [{id,name}]` from the full authorized effective set before filtering/pagination. Detail and files require `jobId`.
- `GET /api/information/events/:eventId/task-links?jobId=...`, `PUT .../task-links/:taskId`, `POST .../:eventId/tasks` expose judgments, manual overrides and human creation.
- Task continuation routes are `POST .../information/:eventId/analysis-options`, `POST .../analyses`, and `GET .../analyses?jobId=...&clientActionId=...`.

## 3. Contracts

`information_record_task_assessment` accepts a complete judgment: nonempty `relations: [{taskId,reason}]`, `newTaskSuggestion: {title,goal,reason}`, or both together; `emptyReason` is exclusive and requires empty relations. All-empty is invalid. Register only for explicitly enabled preprocessing profiles. Existing relations require successfully observed active public tasks at unchanged revisions; a suggestion requires a successful task search. Host validation proves provenance and shape, not semantic correctness. Preserve every supported existing-task relation before considering extra independent work; uncertainty within an existing goal does not itself require a new task. Human confirmation still owns creation.

`BackgroundProfileSnapshot.requireTaskAssessment?: boolean` defaults to false and freezes at admission. True requires `task_search` and `information_record_task_assessment`; every judgment then needs a successful current-request search. Ordinary preprocessing verifies the persisted judgment against the latest successful native recording receipt, current-request query/version evidence, active public tasks, source authority and run ownership. `recorded` and valid `unchanged` receipts are accepted; a later failed submission cannot borrow an earlier success. Reuse Pi's native `agent_end`/`followUp` mechanism, at most two repairs in the same request/session/job; normal completion adds no call. Recheck before publishing. Unresolved completion uses existing `failed` with `TASK_ASSESSMENT_INCOMPLETE`/“任务判断未完成。” and publishes no successful delivery or effective new links. Keep original output/history, prior successful batches and human overrides. Cancellation, timeout, revoked authority and sealed runs retain their existing boundaries; continuous analysis retains its separate completion/stale rules.

For required ordinary preprocessing, a frozen `taskAssessmentFormat: 'decisions'` selects an exclusive native tool input `decisions: [{taskId, verdict: 'link'|'exclude'|'insufficient', reason}]`. Absence selects the legacy `relations` input, including when reprocessing an older admission. Validate observed active-public IDs, task revisions, run ownership and conflicting repeated judgments for every verdict. Only `link` enters the existing persisted assessment.items and business links. Return all checked decisions and their task revisions in the native receipt, including on unchanged positive projections. Verify the latest current-request receipt against query evidence and current authority/revisions before publishing. Nonpositive judgments remain native evidence; manual overrides and human creation keep their existing semantics. When there are no positive links, supply an independent new-task suggestion or an empty reason. Conditional links require concrete evidence for the condition. Compare the additional deliverable to all existing full goals before proposing independent work.

Task discovery/coverage is a general tool/Profile method: discover authorized active public tasks through existing pagination, inspect full goals, and record all evidence-based relevant tasks, including confirmation and continuing constraints. Distinguish conditional impact from confirmed impact, and missing evidence from unrelatedness. Never inject scenario answer mappings or treat a successful query as proof of exhaustive semantic coverage.

Persist judgment in `BackgroundJob.taskAssessment`; publish only after the existing successful native-result verification. For each reader, select the newest-created readable successful complete batch using persisted job insertion order, never completion order or a per-task union. A failed or unrecorded later analysis does not erase the last complete batch. An explicit empty batch does.

Manual `{revision,mode,jobId,reason?}` uses event/task CAS. `include` pins a readable successful version, `exclude` persists across reprocessing, `auto` restores computed behavior. Keep revision metadata available to authorized managers even when restoring auto yields no visible association; absence from `links` does not mean revision zero. Conflict recovery preserves draft text and reloads decision versions.

Human source creation accepts `{jobId,clientActionId,title,goal,reason,context?}` through the existing `createFromSuggestion` service and route. Require a readable, succeeded preprocessing job with a verified result, current public-task management and business-collaboration eligibility, and source-content/context rights. A model `newTaskSuggestion` is optional: use it only as editable form defaults; without one, open the same blank form. Unrecorded judgments, explicit no-assignment and existing-task judgments do not remove the person's creation authority. Failed, cancelled or unfinished analyses never authorize creation. Title, goal and association reason require explicit human confirmation.

In one existing SQLite transaction, create TaskSpace, task_actions, manual include and the backward-compatible `taskSuggestionCreation` receipt. Use `AccessStore.createInTransaction`, not nested calls to `create`. The verified source event/job and optional run owner are part of the immutable idempotency input. Same-action payload changes conflict, including substituting another job. Check creation receipts for the whole event inside the transaction so concurrent submissions from different reprocessing jobs return one actual task/receipt, even after its association is removed or its task archived. Preserve each historical job's original receipt; later jobs read the existing event creation without receiving a copied receipt. No name matching, model request, directory, WorkItem or file import occurs here.

`TaskLinksView.creation` and its `creationJobId` identify the original creation only when that original analysis is readable. Check the current override's pinned job separately before returning its reason or revision metadata, including creation retry responses. A readable later analysis does not authorize earlier or differently scoped analysis content. An unreadable existing creation still blocks another creation without exposing its task ID or reason. Task DTOs in links and creation responses omit internal `scenarioInstanceId`, projecting `readOnly` when the established owner is sealed; ownership remains in storage and commit-time checks. Ending a run rejects both stale creation and old lost-response retries rather than rebinding them to the next run.

Read authorization is task visibility AND successful preprocessing content rights (actual seat delivery OR source grant) AND context scope. Scope alone is insufficient. Filter before pagination, counts, titles and reasons. Task links do not expand source recipients. Seat analyses and personal spaces remain private. Source pause stops new intake, not access to old authorized results.

`task_information_list/read` are read-only main-seat tools, including seat analysis; they do not require external-context configuration. No child or service-history access is added. Read requires the exact effective task/event/job and has a 256 KiB result limit. Default context never injects all related information.

Analysis text can occur before a metadata-recording tool. Derive display and continuation text from public assistant messages of that exact request through its verified final message. Preserve earlier text separately under “processing statements” and the actual final response; do not silently promote intermediate claims to final conclusions. Single-message responses retain their existing format. Exclude tool bodies, thinking blocks and other requests. Do not add another stored transcript or model call to repair presentation.

Continuation uses `origin: {kind:'inbox',deliveryId}` or `{kind:'task_information',taskSpaceId,eventId,jobId}`. Preserve originless legacy actions/jobs through the deliveryId fallback, including an old preparing action resumed after upgrade. Revalidate origin when admitting and claiming work. Detail includes only this seat's continuations for the exact task/event/job. Browsing and capability options do not create a workspace; explicit preparation does. The preparation endpoint alone never starts a conversation request. The explicit Web send action may then call the ordinary session-message endpoint; reads, query recovery and reopening do not send.

No new environment key or database schema. Existing profiles opt in through `tools`; absent/false `requireTaskAssessment` preserves optional recording and old histories remain readable. Mixed judgments and the new profile field are not accepted by older validators: back up code/config/data together and preserve new evidence before restoring a paired snapshot; code-only rollback is insufficient. Restore the pre-upgrade database when rolling back to schema-v3 code, preserving any newer data first.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Unobserved task / suggestion before successful search | `TASK_NOT_QUERIED`; no partial batch |
| Task revision changed / stale manual revision | 409 `INFORMATION_LINK_CONFLICT`; re-read, preserve draft |
| Foreign source/scope/task or disabled actor | No content or count disclosure; reject exact reads |
| Failed/cancelled/interrupted preprocessing | Judgment not published; prior successful result retained |
| Removed or replaced task/event/job | 409; no silent substitution or new continuation |
| Relations plus an independent new-task suggestion | Save both; display both; no automatic task creation |
| Empty reason plus work / all-empty / oversized fields | `INVALID_INPUT`; no truncation |
| Required recording still missing/invalid after two native repairs | Existing failed status; no successful delivery or published new judgment |
| Same creation action with changed payload | Conflict; do not update the existing task |
| Successful readable analysis without new-task suggestion | Human may fill the existing form and confirm creation |
| Concurrent creation from different analyses of the same event | Return one actual task/receipt; keep the original job and immutable action input |
| Original creation/current override job unreadable | Hide its receipt/reason/revision; prevent duplicate creation |

## 5. Good / Base / Bad Cases

Base: one analysis references two public tasks with separate reasons; both lists reference the same event/job and original blobs.
Good: an authorized person edits a proposed task or fills a blank source form, creates it atomically with the source link, then explicitly starts a seat conversation with selected files.
Bad: treating successful delivery as proof of correct relevance, creating tasks because a search is empty, or copying full analysis text into publicly visible task descriptions.

## 6. Tests Required

Run typecheck, lint/boundaries, Vitest, build and desktop Playwright sequentially per test runner. Core tests cover whole-batch version selection, permissions, CAS including include→auto→include, private collections, transaction rollback, creation receipts and v3→v4 reopen. API/native-Pi tests cover actual tool registration, query observations, no-side-effect browsing, exact files and seat/task continuation history. Human-creation regressions cover successful no-suggestion jobs, same-event/different-job concurrent POSTs, immutable action conflicts, archive/restart, original/current-job scope privacy and sealed-run refusal. E2E covers both suggestion and blank-form cancellation/response loss, retained conflict drafts, task switching and delayed navigation.

Required-preprocessing native tests cover zero extra calls on the normal path, missing/failed saves, the two-repair limit, same-request `unchanged`, later failed submissions, missing query evidence, version reread, cancellation/timeout/revocation and sealed runs. Contract/API/browser tests cover mixed relations plus suggestion, retained relations after explicit human creation and no automatic task/workspace creation.

Keep real-provider semantic evidence separate from deterministic tests. Freeze an evaluation-only information × tasks-at-analysis-time rubric before trials; do not retroactively score tasks created afterwards as missed. Report saved execution, definite associations, uncertain cases and new-work appropriateness separately. Use isolated synthetic tasks/events, including changed task conditions, unrelated reference material and an independent work request. Do not force a second classification call or inject expected IDs to make the probe pass.

## 7. Wrong vs Correct

Wrong: infer revision=0 from an absent association, assume `canReadJob` authorizes a new route, or give an old originless preparation a differently tagged job that fails integrity on restart.
Correct: expose authorized decision revisions separately, compose source/delivery and scope checks, and preserve legacy origin semantics while all new actions carry explicit origins.
