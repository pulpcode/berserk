# Information-to-Task Contract

## 1. Scope / Trigger

Read when changing task assessment, information associations, task suggestions or task-based continuation. Use `background/task-links.ts` as the shared permission/version service for browser routes and model tools. Pi JSONL remains the authority for analysis text and tool evidence; associations add metadata only.

## 2. Signatures

- Application SQLite schema v4 adds `information_task_overrides(event_id, task_id, job_id, data)` with a unique event/task pair. Upgrade v3 additively; keep account, handoff, background and native history data. All database owners must accept the same version.
- `TaskLinkService.recordAssessment(jobId, input, observed, toolCallId, signal?)` binds model output to its actual preprocessing job and observed task revisions.
- `TaskLinkService.list/detail/resolve/links/update/createFromSuggestion` serve all readers and mutations.
- `GET /api/tasks/:taskId/information` accepts query/sourceId/offset/limit and returns `TaskInformationPage`: page items/count plus `sources: [{id,name}]` from the full authorized effective set before filtering/pagination. Detail and files require `jobId`.
- `GET /api/information/events/:eventId/task-links?jobId=...`, `PUT .../task-links/:taskId`, `POST .../:eventId/tasks` expose judgments, manual overrides and human creation.
- Task continuation routes are `POST .../information/:eventId/analysis-options`, `POST .../analyses`, and `GET .../analyses?jobId=...&clientActionId=...`.

## 3. Contracts

`information_record_task_assessment` accepts exactly one complete judgment: nonempty `relations: [{taskId,reason}]`, empty relations plus `newTaskSuggestion: {title,goal,reason}`, or empty relations plus `emptyReason`. No field means no recorded judgment. Register only for explicitly enabled preprocessing profiles. Existing relations require successfully observed active public tasks at unchanged revisions; a suggestion requires a successful task search. Host validation proves provenance and shape, not semantic correctness.

Persist judgment in `BackgroundJob.taskAssessment`; publish only after the existing successful native-result verification. For each reader, select the newest-created readable successful complete batch using persisted job insertion order, never completion order or a per-task union. A failed or unrecorded later analysis does not erase the last complete batch. An explicit empty batch does.

Manual `{revision,mode,jobId,reason?}` uses event/task CAS. `include` pins a readable successful version, `exclude` persists across reprocessing, `auto` restores computed behavior. Keep revision metadata available to authorized managers even when restoring auto yields no visible association; absence from `links` does not mean revision zero. Conflict recovery preserves draft text and reloads decision versions.

Human suggestion creation accepts `{jobId,clientActionId,title,goal,reason,context?}`. Require current task-management and source-content rights. In one existing SQLite transaction, create TaskSpace, task_actions, manual include and `taskSuggestionCreation` receipt. Use `AccessStore.createInTransaction`, not nested calls to `create`. The source event/job is part of the idempotency input. A job receipt prevents two people from creating twice from the same suggestion, even after an association is removed or its task archived. No model request, directory, WorkItem or file import occurs here.

Read authorization is task visibility AND successful preprocessing content rights (actual seat delivery OR source grant) AND context scope. Scope alone is insufficient. Filter before pagination, counts, titles and reasons. Task links do not expand source recipients. Seat analyses and personal spaces remain private. Source pause stops new intake, not access to old authorized results.

`task_information_list/read` are read-only main-seat tools, including seat analysis; they do not require external-context configuration. No child or service-history access is added. Read requires the exact effective task/event/job and has a 256 KiB result limit. Default context never injects all related information.

Analysis text can occur before a metadata-recording tool. Derive display and continuation text from public assistant messages of that exact request through its verified final message. Preserve earlier text separately under “processing statements” and the actual final response; do not silently promote intermediate claims to final conclusions. Single-message responses retain their existing format. Exclude tool bodies, thinking blocks and other requests. Do not add another stored transcript or model call to repair presentation.

Continuation uses `origin: {kind:'inbox',deliveryId}` or `{kind:'task_information',taskSpaceId,eventId,jobId}`. Preserve originless legacy actions/jobs through the deliveryId fallback, including an old preparing action resumed after upgrade. Revalidate origin when admitting and claiming work. Detail includes only this seat's continuations for the exact task/event/job. Browsing and capability options do not create a workspace; explicit preparation does. The preparation endpoint alone never starts a conversation request. The explicit Web send action may then call the ordinary session-message endpoint; reads, query recovery and reopening do not send.

No new environment key. Existing profiles opt in through `tools`; old profiles/history remain valid. Restore the pre-upgrade database when rolling back to schema-v3 code, preserving any newer data first.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Unobserved task / suggestion before successful search | `TASK_NOT_QUERIED`; no partial batch |
| Task revision changed / stale manual revision | 409 `INFORMATION_LINK_CONFLICT`; re-read, preserve draft |
| Foreign source/scope/task or disabled actor | No content or count disclosure; reject exact reads |
| Failed/cancelled/interrupted preprocessing | Judgment not published; prior successful result retained |
| Removed or replaced task/event/job | 409; no silent substitution or new continuation |
| Invalid mixed judgment / oversized fields | `INVALID_INPUT`; no truncation |
| Same creation action with changed payload | Conflict; do not update the existing task |
| Concurrent creation for same suggestion | Return one actual task/receipt |

## 5. Good / Base / Bad Cases

Base: one analysis references two public tasks with separate reasons; both lists reference the same event/job and original blobs.
Good: an authorized person edits a proposed task, creates it atomically with the source link, then explicitly starts a seat conversation with selected files.
Bad: treating successful delivery as proof of correct relevance, creating tasks because a search is empty, or copying full analysis text into publicly visible task descriptions.

## 6. Tests Required

Run typecheck, lint/boundaries, Vitest, build and desktop Playwright sequentially per test runner. Core tests cover whole-batch version selection, permissions, CAS including include→auto→include, private collections, transaction rollback, creation receipts and v3→v4 reopen. API/native-Pi tests cover actual tool registration, query observations, no-side-effect browsing, exact files and seat/task continuation history. E2E covers suggestion response loss, retained conflict drafts, task switching and delayed navigation.

Keep real-provider semantic evidence separate from deterministic tests. Use isolated synthetic tasks/events, including changed task conditions, unrelated reference material and an independent work request. Do not force a second classification call or inject expected IDs to make the probe pass.

## 7. Wrong vs Correct

Wrong: infer revision=0 from an absent association, assume `canReadJob` authorizes a new route, or give an old originless preparation a differently tagged job that fails integrity on restart.
Correct: expose authorized decision revisions separately, compose source/delivery and scope checks, and preserve legacy origin semantics while all new actions carry explicit origins.
