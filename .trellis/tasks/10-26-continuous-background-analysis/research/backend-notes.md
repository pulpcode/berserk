# Backend implementation evidence

Date: 2026-10-26. Worktree: continuous-background-analysis.

## Contract and ownership

- Added `src/contracts/continuous.ts`: immutable stream epochs, event/task-revision inputs, batches, explicit task/unassigned change records, current/history references, input evidence and bounded exact evidence slices.
- `BackgroundJob` and `BackgroundDelivery` now discriminate legacy event identity from `continuous_analysis` / stream epoch identity. Continuous jobs have no representative `eventId` or `sourceId`.
- Continuous execution remains in `BackgroundService.pump`, the existing concurrency slots and the Pi executor. No second queue or model loop was added. Eligibility filters paused epochs before SQL pagination; unavailable execution sandboxes block legacy execution only.
- Pi owns native execution; frontend owns configuration, current/history views and private continuation UI.

## Persistence and migration

- v11 = background + continuous, without annotation tables; v12 = integrated background + continuous + annotations. Authentication-only v9 remains v9 until background first initializes. Annotation initialization advances v11 to v12. All database owners accept these versions without downgrading.
- Legacy queue and notification IDs, review rows, explicit inbox handling and task relations survive the jobs/deliveries CHECK migration. Foreign-key checks run before commit. The migration uses SQLite's table rebuild pattern with foreign keys disabled only for the transactional rebuild, then restored.
- Continuous tables persist epochs, input membership, immutable batches, publication metadata/current pointers and configuration/control receipts. No report body is duplicated in SQLite.
- Reopen validates JSON/index identity, required indexes, stream/batch/input/job/publication relations, consumed-input membership, recipient/significance notification relations and task/current pointers. Missing current-version metadata is corruption.
- Public task edits and active subscribed-epoch revision inputs share one SQLite transaction. Failed input insertion rolls back the task edit. Archived tasks do not enqueue further revisions; already queued required revisions can be explicitly skipped by the host with `archivedTaskIds`.

## Runtime and publication

- Defaults: 5 s quiet window / 30 s maximum wait; configurable bounded values. One batch has at most 32 inputs / 128 KiB input text+metadata. A single over-limit source input is rejected. Fixed attachments remain separate verified file references.
- Incoming events are idempotent; continuous admission and its input commit atomically. Inputs remain unconsumed until publication. Running/paused input counts contribute to admission backlog capacity.
- Native successful metadata evidence must match the exact recorded tool call before the final native assistant message. Current views use that final body; prior public statements remain separate `processingText`.
- Publication, current pointers, consumed inputs and significant pending notifications share the existing database transaction. Significance is task OR unassigned. Quiet published results remain recipient-readable without a notification.
- Required task revisions cannot be consumed by omitted task updates. Observed revision races before recording or before publication preserve inputs and automatically create a fresh request; missing recording, cancellation, failure and interruption pause instead.
- A resumed epoch uses a fresh native session unless a never-started queued request already exists. Retired epochs remain retired after explicit recovery; they never acquire new source/revision subscriptions. Old failed/cancelled attempts and evidence are retained.
- Stream changes create fresh epoch/session snapshots. Old accepted inputs drain with their old audience; old paused epochs require explicit recovery.

## Access, history and discussion

- Routes: `/api/continuous/access`, `/streams`, `/streams/:id/control`, `/rounds`, `/rounds/:jobId`, `/rounds/:jobId/files/:fileId`, `/rounds/:jobId/analysis-options`, `/rounds/:jobId/analyses`, and `/api/tasks/:taskId/continuous`.
- Current source grants for every frozen source OR a still-eligible frozen recipient, plus frozen context-scope rights, authorize result content. Task routes additionally require task visibility. Configuration control requires every source's management grant. Stream API responses redact service instructions/resources.
- Configuration creation receipt reads return the original epoch even after later edits. Control accepts epoch IDs so retired paused inputs remain recoverable.
- Current task lookup resolves every authorized epoch's exact task pointer, rather than intersecting a recent-history page. An omitted task retains its older timestamp and reference.
- Historical model reads are restricted to the epoch's published index. Browser/model/file/discussion reads fail closed when the exact native final reference or metadata evidence is absent or altered.
- History exposes immutable ingress text/times/identity/files and successful context/source/file-read evidence. Large evidence is discoverable via `evidenceIndex` and exactly reconstructable via `evidenceId`, `textOffset`, `textLimit`, `nextOffset` (32,000 characters maximum slice; 256 KiB tool result limit). No evidence summary replaces raw facts.
- Important notifications reuse existing inbox handling and workbench projection (`kind: continuous`). Opening, quiet publication and later notifications never mark earlier human work completed.
- Explicit discussion prepares an ordinary private conversation draft with the exact job/request/final-message reference. Preparation persists a reusable action/session receipt and never starts the model. Continuous discussion supports conversation mode; the legacy background-analysis option is unchanged. Original batch files are separately downloadable through the authorized fixed-round route; continuous analysis creates no output files.

## Checks run by backend owner

- Typecheck passed after shared DTO integration and queue fixes.
- Scoped ESLint passed across backend/contracts/server/access/workbench and edited backend tests before the final narrow queue additions (root owns the final full gate).
- 108 focused tests passed across legacy background service/store, task links, recipient migration, seat migrations, annotations and the first six continuous tests.
- Expanded `tests/background/continuous.test.ts`: 15/15 passed. Real Pi tool loop and native storage with only the provider mocked; coverage includes quiet recipient access, multi-source rejection, immutable raw evidence, duplicate intake, R08 atomic rollback, required-task omission, task revision races both before recording and before publication, task/unassigned notification OR, native evidence corruption/missing files, exact large evidence slices, mode/epoch isolation, cancellation/resume, archived tasks, bounded batches, 201 paused epochs and sandbox-independent readonly execution.
- Root owns the actual SIGKILL continuous test, full suite/browser/build/lint and isolated live-provider verification. Pi owner owns native SDK compaction/recovery and readonly attachment-tool tests. No backend-owner network/provider calls or production writes occurred.
