# Task Handoff Contract (W01-8)

## 1. Scope / Trigger

Read when changing test seats, collaboration tools, work items, handoff files or their Web integration. This is a concrete two-seat workflow, not a generic Run/workflow engine. Pi owns conversation history and execution; SQLite owns business state and receipts. No real authentication, external dispatch, automatic receiver execution or whole-workspace queue is provided.

## 2. Signatures

- `LAB_TEST_SEATS='[{"id":"test-seat","name":"席位 A"},{"id":"seat-b","name":"席位 B"}]'`: optional, exactly two distinct entries including `LAB_SEAT_ID`. Omission retains legacy single-seat APIs.
- One PiLab, WorkspaceStore and data root per process. Scoped APIs use `/api/test-seats/:seatId/...`; `/api/info` bootstraps the selector. Test mode rejects unscoped business routes. This is selectable test identity, not authentication.
- Public PiLab/workspace/resource/file methods accept the captured seat as an optional final argument. `createSession(workspaceId?, seatId?, workItemId?)` and `bindWorkItem(sessionId, workItemId, seatId?)` enforce the bound workspace. `WorkspaceStore.create(name, taskSpaceId?, seatId?)` preserves the legacy second argument.
- `GET /work-items`, `GET /work-items/:id`; `POST /work-items/prepare` takes strict `PageWorkPrepareInput` with `clientActionId`; `GET /work-actions?clientActionId=...` resolves uncertain preparation.
- `GET /work-actions/:id`; `POST /work-actions/:id/commit` takes `{confirm:true}`; `POST /work-actions/:id/cancel` abandons only a page preparation.
- `GET /handoff-files/:id?preview=1`, `POST /handoff-files/:id/import` takes `{workspaceId,path?}`; `POST /sessions/:id/work-item` takes `{workItemId}`. All are under the scoped prefix above.
- Parent Pi tools: `work_item_list({})`, `work_item_read({workItemId}|{operationId})`, `work_item_action({action})`, `handoff_import_file({fileId,path?})`. Background preprocessing and readonly children receive no handoff mutation tools. Legacy prepare/commit names remain readable in history but are not registered for new requests.

## 3. Contracts

`ActorContext` is an immutable `{seatId}` selected by the validated request path. Every native record retains its owning seat. Never mutate a global current seat or create duplicate in-memory stores for the same data directory. Startup validates all bindings by their actual owners. Browser input cannot add an authority field to a body.

Workspace identity remains taskSpaceId × seatId in index v2. Assignment ensures the recipient's workspace without copying the sender's instructions or chat. Session links only join an idle, owned session in the same task; opening work details does not claim it.

The model-visible workspace description states that sessions in the same task and seat share ordinary files, while different seats' `/workspace` paths resolve to independent directories. `assign.payload.goal` describes the work and deliverable; optional `inputPaths` selects current-workspace files frozen at preparation. Omission or `[]` remains a valid text-only assignment; paths mentioned in `goal` do not transfer files. Import file IDs may come from `inputFiles[].fileId` or `submissions[].file.fileId`. Keep these meanings in the relevant workspace/tool/field description rather than repeating bug-specific reminders.

`assigned → working → submitted → completed`, or `submitted → returned → submitted`. Only the assignee claims/submits; only the creator reviews the latest submission. Multiple input files, one output file per submission. Chat success does not complete a WorkItem.

`collaboration/collaboration.sqlite` (schema version 1) contains works, actions, files, submissions and session_links. Private fixed bytes live under `collaboration/files/<fileId>/content`. Marker/schema/integrity failures block opening; do not reconstruct a missing DB from files. Back up the whole stopped data directory, including SQLite and fixed files.

`workActionToolSchema` exposes the four existing business actions while omitting assign.taskSpaceId and assign/submit.payload.workspaceId. Reject extra model fields; build a separate service DTO from the captured workspace and actor. Keep page/stored `workPrepareSchema` unchanged. Absolute `/workspace/` paths are normalized only in this internal DTO, never in native tool arguments.

One `work_item_action` call uses the existing beforeToolCall hook to prepare fixed bytes, check the active prepared operation, display the existing confirmation and wait. The host binds operationId, exact parameters and approval grant to this toolCallId; execute consumes that binding and returns the actual commit receipt. The model never needs to pass an operationId into a second tool to open the card. An explicit recoverable preparation error becomes a native blocked tool result before any card; persistence, corrupt-state and uncertain file-service failures remain terminal. Do not classify every RequestError/4xx as recoverable. Waiting-time permission/version changes still fail the existing commit recheck.

Page commits accept only page-origin actions. Agent commits require an in-memory grant matching the active sessionId/requestId/toolCallId/interactionId and original preparation. Request end/cancel/restart expires uncommitted Agent preparations; restart expires all old uncommitted preparations. Browser refresh alone does not. No native history or ordinary text is interpreted as a fresh grant.

Native policy/interaction records retain real `work_item_action` arguments `{action}`; fixed operationId/files stay in handoff. Replay validates the new schema separately from old commit `{operationId}`, retaining actual call/policy/decision linkage. Old prepare/commit histories may be continued with only the new tool registered; attempted obsolete tools fail without an alias or replay. Older binaries unable to decode new records are not safe rollback targets. A separate business workflow prompt is deferred; this change only replaces the old tool-chain directions.

File copying happens before the short SQLite transaction; the transaction atomically validates revision, changes work/submission state and saves the receipt. Reusing a committed operationId returns its receipt; a distinct stale operation conflicts. Fixed byte/hash verification precedes publication/download. Source edits after preparation do not alter the approved copy. Unpublished or partial files remain private. This guarantee applies to the business transaction, not arbitrary Bash side effects.

Import checks both participant authority and target task/seat, never overwrites a differing file, and can reuse identical bytes. Its bounded link/unlink helper must settle before cancellation returns: killing it between link and unlink would strand a second hard link. Model failure/cancellation does not roll back committed files or business effects.

Per-request business context contains only the current work goal, state, revision, input references and latest review. It is not a copy of another chat and does not change Pi compaction or introduce synthetic tool results. After interruption query the business receipt; preserve native unknown-effect rendering.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Unknown seat, foreign session/workspace/work/file | Scoped rejection; no content disclosure |
| Extra body authority fields or malformed action | 400 strict schema |
| Recoverable model preparation error, including missing files or stale revision | Specific native tool error; no confirmation, model may correct inputs |
| Stale revision, wrong actor/state, old submission review | 409 `WORK_CONFLICT` |
| Page attempts Agent action, missing exact grant | 409; no effect |
| Fixed bytes missing/corrupt, unsafe path/type | Explicit error; no valid submission |
| Same operationId already committed | Original receipt, no second submission |
| Different existing import bytes | Conflict; caller chooses another path |
| Database lost/corrupt or ownership inconsistent | Startup fails; preserve existing files |

## 5. Good / Base / Bad Cases

Base: legacy single-seat mode opens unchanged native histories and ordinary files.

Good: A confirms two input copies, B claims and generates an output with Pi tools, A returns it, B submits a second copy, A accepts only that current copy. Both versions remain downloadable.

Bad: using the selected browser seat for a late callback, copying the sender's AGENTS.md, allowing a page endpoint to commit an Agent action, treating prepare as a visible confirmation or replaying a missing native result after restart.

## 6. Tests Required

Run typecheck, lint, unit/integration, browser tests and build. `tests/seat-api.test.ts` checks old native data and all scoped API ownership. `tests/collaboration/` checks state, bytes, deduplication, revision races, SQL rollback, corruption and actual SIGKILL during copy/before/after commit. `tests/pi/collaboration.test.ts` checks the real Pi loop with only the model deterministic, exact HITL, child restrictions and SIGKILL while waiting/around commit. `tests/e2e/handoff.spec.ts` exercises the actual service/UI with deterministic model responses.

`npm run probe:handoff` uses real configured model and Docker with a new temporary data root; it never opens production data or starts another production listener. Keep live-model, browser, fault and deployment evidence separate.

`npm run probe:handoff -- --attachments baseline|verify` captures actual provider messages/tools without request headers or credentials, native tool calls, fixed-file hashes and receiver-imported bytes. The baseline has one natural two-turn case; verification has three independent natural cases plus one-file, text-only and explicit-two-file controls, including submission import back to A. Retain every failure: deterministic provider tests or explicit-file success cannot substitute for natural multi-turn acceptance. Do not tighten optional parameters or add intent checks solely to make this probe pass.

Single-action tests also cover all four actions, original absolute-path arguments versus host scope, business-error correction without a card, infrastructure stop, cancellation during preparation/while waiting/immediately after approval, stale revision after approval, and old history continuation. Use synchronization barriers rather than timing sleeps. The probe matches one real action call to its card and committed receipt, then checks B's bytes and A's final acceptance.

## 7. Wrong vs Correct

Wrong: `currentSeat = request.body.seatId` followed by shared asynchronous work.

Correct: capture a validated actor at the route, enforce workspace ownership in every service, retain that scope throughout SSE and uploads.

Wrong: retry prepare/commit after an uncertain response, or append a successful Pi tool result based on a receipt.

Correct: query by the saved clientActionId/operationId, present authoritative business state, and leave native missing-result history unchanged.
