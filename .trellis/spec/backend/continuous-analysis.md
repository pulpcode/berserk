# Continuous Background Analysis

## 1. Scope / Trigger

Read when changing continuous intake, task-revision triggers, published assessments, native continuation, source authorization, notifications or their desktop projections. `BackgroundService` still owns the queue; `ContinuousService`/`ContinuousStore` add stream metadata and publication, not another agent runtime. Existing per-event preprocessing and seat analysis retain their behavior.

## 2. Signatures

- `contracts/continuous.ts`: `ContinuousStreamInput`, immutable epoch snapshots, `ContinuousInput` (`event | task_revision`), bounded `ContinuousBatch`, `AnalysisUpdateInput`, `ContinuousRoundDetail`.
- `POST /api/continuous/streams`: stream input plus `clientActionId`. `PUT /api/continuous/streams/:id`: input plus optimistic `revision`; changes create a fresh epoch/session. `GET /streams?clientActionId=...` recovers the exact caller's creation receipt.
- `POST /api/continuous/streams/:id/control`: `{revision,action:'pause'|'resume',clientActionId}`. Epoch IDs support recovery of retired configurations; recovery must not restore retired subscriptions.
- `GET /api/continuous/access`, `/streams`, `/rounds?epochId&taskId&offset&limit`, `/rounds/:jobId`, `/rounds/:jobId/files/:fileId`; `GET /api/tasks/:taskId/continuous`.
- Fixed-round `/analysis-options` and `/analyses` reuse private conversation preparation and idempotent receipt lookup. Continuous mode permits `mode:'conversation'`, not another seat background job.
- `BackgroundExecutionInput.checkAnalysisCompletion(snapshot)` returns `ready | missing | stale`; the real continuous service supplies it through `PreprocessInput`. It checks the active request before final publication. `ContinuousStore.publicationIssue(job, update)` reuses the existing task-version, baseline and required-task checks without mutating state.
- Pi tools: `analysis_task_candidates({})` performs complete host task discovery; `analysis_current_read` reads authorized published references/original evidence; `information_record_analysis_update` records request-local metadata. `recorded` is not `published`. Optional readonly `spatial_analyze` is admitted by the selected profile; geometry writes remain unavailable.
- `AnalysisUpdate.taskCoverage` binds each assessed/unrelated/uncertain task to its observed revision/title. `discoveryToolCallId` and `discoveryDigest` bind the successful native candidate receipt. Older records without these fields remain readable. `TaskBusinessRef.role` optionally declares route/resource/location/work_area/reference; omitted roles remain explicit uncertainty.
- `BackgroundExecutor.read(job, profile?)` requires the captured continuous epoch profile for authorized discovery/spatial history. Never grant scope from model content.
- SQLite versions 11 (background) / 12 (background plus annotations) add `continuous_streams`, `continuous_inputs`, `continuous_batches`, `continuous_current`, `continuous_publications`, `continuous_actions`. A `continuous_analysis` job has `batchId/streamEpochId` and NULL event/source SQL columns; it must never borrow the first event's authorization.
- `npm run probe:continuous` runs the isolated real-provider scenario. It creates a fresh temporary data directory; it does not deploy a service or use production data.

## 3. Contracts

**Scope.** A configured stream fixes all sources, Profile, explicit context scope and common recipients. Its creation disables enabled legacy rules for those sources; one event follows one mode. Configured legacy sources remain per-event until explicitly changed. Same-stream work is serial and shares existing background/model permits. Quiet/max waits default to 5s/30s; batches hold at most 32 inputs and 128 KiB of admitted input metadata/text. Incoming inputs during execution wait for the next batch.

**Task truth.** Only active public task metadata (`goal/context`) and permitted source facts are shared inputs. Public task creation/revision and its admitted revision inputs commit in one SQLite transaction; no prior assessment is required. Only current enabled epochs are eligible. With no baseline, references wholly outside a stream source scope do not enqueue into that stream; unbound public tasks need first assessment. Previous baselines remain eligible for reassessing removed associations. Private/archived tasks and retired epochs receive no new task input. Required task revisions cannot be consumed by omitting their assessment. Complete task-list revisions are checked at discovery, record and publication; changes retain inputs for reevaluation. Older stored rounds keep their original coverage semantics.

**Discovery.** The no-argument host tool binds each input to its real source system and subject, reads matching reports and their object references or exact situation identities, and completely pages active public tasks. It never accepts model-selected changed objects. Unresolved source identity, unspecified task roles and missing geometry remain explicit gaps. Direct references plus verified geometry identify candidates; previous baselines and explicitly revised tasks are also reviewed. No object/area label or filtered empty text query proves disjointness. At most 100 tasks, 100 spatial pairs and 100 retained source query results; source enumeration is limited to 500 objects. Limits and inconsistent snapshots fail explicitly. Preserve repeated-object revision/geometry/properties/business-time and per-source snapshot consistency across calculations. The native candidate tool owns nested spatial results and source query snapshots; it does not forge spatial tool calls. `extractTaskDiscovery` validates the shared protocol and model/details agreement before display or reuse.

**Coverage.** A successful current-request discovery is required before recording. Every discovered task has assessed/unrelated/uncertain coverage; assessed/uncertain entries require a task update. Only host-verified unrelated tasks without prior assessments may omit an update. If coverage is omitted, derive it from complete taskUpdates, never from absent entries. Incomplete coverage uses existing bounded Pi completion repair. Actual semantic impact and importance remain model judgments, not facts inferred by the coverage validator. Recording errors identify the exact invalid field/reference and current permitted input IDs, plus missing/unknown/conflicting task IDs, without choosing or correcting parameters for the model. Same-epoch consumed historical inputs remain admissible; a required task revision must reference its current batch revision input. Reuse `requiredTaskInputIssues` / `publicationIssue` before returning a successful record receipt and again at publication, so an invalid current-revision record cannot look like a successful draft. Preserve version-conflict handling and input/baseline state.

**Publication.** Final text comes from the exact native request/finalMessageId. Intermediate statements are separate. Validate the successful native metadata tool receipt before publication/read/delivery; a missing or mismatched log is not an empty successful result. Publish current pointers, consumed inputs and notifications in one transaction. Significant task changes OR significant unassigned changes create fixed-recipient notifications; quiet results remain independently readable. Delivery validation must discriminate continuous jobs instead of requiring a legacy rule snapshot.

**Completion repair.** In `pi/continuous-completion.ts`, an `agent_end` extension checks only a normal, nonempty assistant text ending without tool calls. If current-batch metadata or its exact successful native receipt is missing/incomplete, enqueue `pi.sendUserMessage(..., {deliverAs: 'followUp', expandPromptTemplates: false})`; Pi drains it before the same `session.prompt()` settles. At most two repair prompts per batch, sharing the active request/session, timeout, cancellation and model permits. No second host loop or new persistent repair store. Ready rounds incur no extra model attempt; stale versions use existing automatic reassessment. Cancellation, timeout, permission loss or damaged native history must not enter repair. Never synthesize the update or inject an expected answer. Original endings, feedback, tool calls and errors remain in native history; only the last valid final is published.

**Native history.** Healthy rounds reuse the native session, with Pi default compaction and no second summary store. Failed/cancelled/interrupted rounds, and incomplete-metadata rounds after the bounded repair opportunity, retain inputs and last published references, pause the epoch, and require one explicit recovery. Recovery starts a fresh native session and reads authorized published originals; it does not replay incomplete tools. A later interrupted tail must not invalidate an earlier exact successful request. Retain original failed executions. Original ingress text/time/identity/files and successful readonly tool evidence remain distinguishable from old assistant judgments; large evidence requires bounded exact reads, never an unrecoverable aggregate-size rejection.

**Readonly boundary.** Continuous tools exclude Bash, file writes, AskUser, instructions changes, map mutations, private annotation reads, handoffs and subagents. Source-only readonly spatial calculations and verified current-flow fixed results use the service principal, never an impersonated foreground seat. Fixed batch attachments use Pi public read/list/find definitions with guarded operations; only registered immutable paths, hash/size and no symlinks. UTF-8 text is limited to 1 MiB; unsupported binary/PDF/image/oversized input returns an explicit limitation. Read evidence carries fixed file provenance and original pagination parameters.

**Conclusion scope.** A real-provider trial correctly tracked partial constraints but still declared overall execution feasible while dispatch/capacity remained unknown. The initial request therefore requires identified material gaps to qualify the main conclusion and advice, not only a final uncertainty list. Removing one constraint does not establish all-task feasibility. Keep this domain-neutral: never add fixture facts, an expected answer, or an unconditional second model call. Completion repair checks execution integrity, not semantic correctness. Preserve failed semantic trials and distinguish a new instruction condition from retrying the same experiment.

**Authorization.** Every result entry, count, title, detail, original input, file and preparation rechecks current identity, context scope and either the full source-set grants or fixed recipient membership still allowed by every source. Task pages additionally check task visibility. Fixed recipients gain published results and their inputs, not arbitrary source browsing or unpublished job bodies. New epochs cannot inherit old native context into a new audience. Read operations must not start model execution.

**Desktop.** Current assessments appear under the task goal; each scope/epoch stays separate. History and discussion pin a job version. Polling/new-version banners preserve selection, focus and both task-page and private discussion drafts. Recipients can enter published records from Work Overview without source/overview management privileges, including quiet unassigned results. Important notifications keep independent explicit handling, including risk resolution. Reading, model completion and later rounds never complete an earlier notification.

## 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Missing discovery or omitted task coverage | Reject recording; bounded native repair; if still incomplete preserve prior baseline/input and pause |
| Unresolved identity, missing geometry or unspecified role | Visible gap; cannot label host-unverified task unrelated |
| Task creation/edit without baseline | Atomically enqueue eligible current streams; never require a previous assessment |
| Cross-calculation source drift or capacity overflow | Explicit incomplete/error, never a partial successful empty set |
| Duplicate source message | Return original receipt; no second input/job |
| Single-source permission for mixed result | Deny result and filtered count/title |
| Quiet or unassigned publication | Readable by fixed recipient without creating a notification |
| Missing/incomplete current-request metadata on a normal ending | Up to two native follow-ups; publish only after the existing final checks pass |
| Still missing/forged metadata or required task after repair limit | Preserve input/current result; explicit unpublished status and pause |
| Permission loss or corrupt native history before repair | Stop without another model attempt; no publication |
| Task revision changes before commit | Supersede result, retain input, re-evaluate automatically |
| Configuration audience/scope changes | Fresh epoch and native session; preserve old immutable access boundary |
| Failure/cancel/SIGKILL | No automatic model replay; explicit recovery has new request/session |
| Old epoch fails while draining | Recover that epoch explicitly; no new subscriptions |
| Native history corruption or result mismatch | Fail closed; never substitute another request's final |
| Delivery exists on restart | Validate continuous audience/publication independently from legacy ruleSnapshot |
| New publication while v1 open | Keep v1 and drafts; show explicit newer-version action |

## 5. Good / Base / Bad Cases

Base: a single event yields one quiet published assessment. Good: road restrictions, reduced vehicles and later road recovery update one task continuously, retaining only the still-supported resource risk; a task-goal edit then triggers re-evaluation without an external event. Bad: treating an omitted task as resolved, using newest received notification instead of source version, publishing intermediate reasoning as final, or manufacturing an event ID for a multi-source batch.

## 6. Tests Required

- `tests/background/task-discovery.test.ts`: direct/spatial matches without text keywords, complete paging, unchanged source identities, gaps, cross-pair version/geometry/snapshot drift, public first-trigger transaction/rollback/private/retired boundaries and role persistence.
- `tests/pi/background-spatial.test.ts`: service source/result isolation, nested candidate result reuse, native ownership/tamper refusal and reopened fixed history.
- `tests/background/continuous.test.ts`: complete task coverage and candidate receipt binding, actual native receipt, quiet/important OR, task CAS and required reassessment, epoch/recovery, input idempotence, mixed grants and original evidence; omitted/failed tool repaired in one request, normal path with no extra call, two-attempt cap and rejection of old receipts, cancel/timeout during repair, task revision races, permission loss, preserved native history after reopening.
- Existing storage/migration/annotation tests: preserve old rows/foreign keys and support all database owners. Reopen after an important continuous delivery, not only quiet rounds.
- `tests/pi/continuous-p0.test.ts`, `continuous-runner.test.ts`: actual native continuity, exact historical reads, default compaction, task observations, strict tools, fixed-file path/hash/provenance, adapter-only missing metadata without an installed host completion check; host-integrated repair is covered by the service suite.
- `tests/continuous-crash.test.ts`: actual child-process SIGKILL while native request active, prior publication and delivery survive, pending input and interruption persist, no replay before explicit idempotent fresh-session recovery.
- `tests/e2e/continuous.spec.ts`: fixed history and drafts under publication, actual v1 discussion provider payload, recipient-only quiet records, denied public-task-only access, explicit handling, config epoch controls, wide/narrow desktop layouts.
- `scripts/probe-continuous.ts`: real provider sequential source changes and task revision, frozen originals and original failures. Review semantic claims separately from protocol success and deterministic tests; report whether live compaction occurred. `scripts/probe-continuous-multitask.ts` preserves the frozen three-task/twelve-update sequence and raw requests. A live run with zero omissions does not directly exercise repair; deterministic omission tests supply that evidence. Count quiet-round false alerts and distinguish a conditional resource reallocation from one that actually occurred.

- `scripts/probe-continuous-spatial.ts`: isolated real-provider plus authenticated source HTTP, fixed geometries, role-bound tasks, actual task-create/edit triggers and missing-boundary rounds. Freeze source/driver/input hashes and retain all attempts. Verify the oracle directly from coordinates before scoring; preserve an incorrect original oracle and publish a dated erratum if an error is found after execution. Never change model-visible inputs or silently rescore only favorable runs. Separate coverage, business conclusions, geometry explanations and significant flags: complete coverage does not prove the model used the evidence correctly. Explicit task facts must not become model-invented data gaps in later rounds.

## 7. Wrong vs Correct

Wrong: accept an empty filtered task search as complete coverage, or interpret missing geometry as no spatial impact. Correct: run host discovery, verify every task coverage, and retain explicit evidence gaps.

Wrong: `permission(actor, batch.events[0].sourceId)` or `delivery => job.ruleSnapshot.rule.recipientSeatIds` for every kind.

Correct: discriminate `continuous_analysis`, bind the full epoch source/recipient/scope snapshot, validate its published native reference, and keep existing legacy validation intact. Test both a mixed-source denied reader and a successful important-round restart.
