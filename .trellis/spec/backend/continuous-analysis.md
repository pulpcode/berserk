# Continuous Background Analysis

## 1. Scope / Trigger

Read when changing continuous intake, task-revision triggers, published assessments, native continuation, source authorization, notifications or their desktop projections. `BackgroundService` still owns the queue; `ContinuousService`/`ContinuousStore` add stream metadata and publication, not another agent runtime. Existing per-event preprocessing and seat analysis retain their behavior.

## 2. Signatures

- `contracts/continuous.ts`: `ContinuousStreamInput`, immutable epoch snapshots, `ContinuousInput` (`event | task_revision`), bounded `ContinuousBatch`, `AnalysisUpdateInput`, `ContinuousRoundDetail`.
- `POST /api/continuous/streams`: stream input plus `clientActionId`. `PUT /api/continuous/streams/:id`: input plus optimistic `revision`; changes create a fresh epoch/session. `GET /streams?clientActionId=...` recovers the exact caller's creation receipt.
- `POST /api/continuous/streams/:id/control`: `{revision,action:'pause'|'resume',clientActionId}`. Epoch IDs support recovery of retired configurations; recovery must not restore retired subscriptions.
- `GET /api/continuous/access`, `/streams`, `/rounds?epochId&taskId&offset&limit`, `/rounds/:jobId`, `/rounds/:jobId/files/:fileId`; `GET /api/tasks/:taskId/continuous`.
- Fixed-round `/analysis-options` and `/analyses` reuse private conversation preparation and idempotent receipt lookup. Continuous mode permits `mode:'conversation'`, not another seat background job.
- Pi tools: `analysis_current_read` for authorized published references/original evidence and `information_record_analysis_update` for request-local metadata. `recorded` is not `published`.
- SQLite versions 11 (background) / 12 (background plus annotations) add `continuous_streams`, `continuous_inputs`, `continuous_batches`, `continuous_current`, `continuous_publications`, `continuous_actions`. A `continuous_analysis` job has `batchId/streamEpochId` and NULL event/source SQL columns; it must never borrow the first event's authorization.
- `npm run probe:continuous` runs the isolated real-provider scenario. It creates a fresh temporary data directory; it does not deploy a service or use production data.

## 3. Contracts

**Scope.** A configured stream fixes all sources, Profile, explicit context scope and common recipients. Its creation disables enabled legacy rules for those sources; one event follows one mode. Configured legacy sources remain per-event until explicitly changed. Same-stream work is serial and shares existing background/model permits. Quiet/max waits default to 5s/30s; batches hold at most 32 inputs and 128 KiB of admitted input metadata/text. Incoming inputs during execution wait for the next batch.

**Task truth.** Only active public task metadata (`goal/context`) and permitted source facts are shared inputs. Task edits and their revision inputs commit in the same SQLite transaction, only for current enabled epochs with prior published task assessments. Retired epochs drain already accepted inputs. Required task revisions cannot be consumed by omitting their assessment. Native query observations bind each recorded task revision; publication checks revisions again. Stale task results stay unpublished and automatically re-evaluate retained input. Unlisted tasks retain their own older baseline and timestamp.

**Publication.** Final text comes from the exact native request/finalMessageId. Intermediate statements are separate. Validate the successful native metadata tool receipt before publication/read/delivery; a missing or mismatched log is not an empty successful result. Publish current pointers, consumed inputs and notifications in one transaction. Significant task changes OR significant unassigned changes create fixed-recipient notifications; quiet results remain independently readable. Delivery validation must discriminate continuous jobs instead of requiring a legacy rule snapshot.

**Native history.** Healthy rounds reuse the native session, with Pi default compaction and no second summary store. Failed/cancelled/interrupted/incomplete-metadata rounds retain inputs and last published references, pause the epoch, and require one explicit recovery. Recovery starts a fresh native session and reads authorized published originals; it does not replay incomplete tools. A later interrupted tail must not invalidate an earlier exact successful request. Retain original failed executions. Original ingress text/time/identity/files and successful readonly tool evidence remain distinguishable from old assistant judgments; large evidence requires bounded exact reads, never an unrecoverable aggregate-size rejection.

**Readonly boundary.** Continuous tools exclude Bash, file writes, AskUser, instructions changes, maps, handoffs and subagents. Fixed batch attachments use Pi public read/list/find definitions with guarded operations; only registered immutable paths, hash/size and no symlinks. UTF-8 text is limited to 1 MiB; unsupported binary/PDF/image/oversized input returns an explicit limitation. Read evidence carries fixed file provenance and original pagination parameters.

**Conclusion scope.** A real-provider trial correctly tracked partial constraints but still declared overall execution feasible while dispatch/capacity remained unknown. The initial request therefore requires identified material gaps to qualify the main conclusion and advice, not only a final uncertainty list. Removing one constraint does not establish all-task feasibility. Keep this domain-neutral: never add fixture facts, an expected answer, or a forced second repair request. Preserve failed semantic trials and distinguish a new instruction condition from retrying the same experiment.

**Authorization.** Every result entry, count, title, detail, original input, file and preparation rechecks current identity, context scope and either the full source-set grants or fixed recipient membership still allowed by every source. Task pages additionally check task visibility. Fixed recipients gain published results and their inputs, not arbitrary source browsing or unpublished job bodies. New epochs cannot inherit old native context into a new audience. Read operations must not start model execution.

**Desktop.** Current assessments appear under the task goal; each scope/epoch stays separate. History and discussion pin a job version. Polling/new-version banners preserve selection, focus and both task-page and private discussion drafts. Recipients can enter published records from Work Overview without source/overview management privileges, including quiet unassigned results. Important notifications keep independent explicit handling, including risk resolution. Reading, model completion and later rounds never complete an earlier notification.

## 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Duplicate source message | Return original receipt; no second input/job |
| Single-source permission for mixed result | Deny result and filtered count/title |
| Quiet or unassigned publication | Readable by fixed recipient without creating a notification |
| Missing/forged metadata or missing required task | Preserve input/current result; explicit unpublished status and pause |
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

- `tests/background/continuous.test.ts`: actual native receipt, quiet/important OR, task CAS and required reassessment, epoch/recovery, input idempotence, mixed grants and original evidence.
- Existing storage/migration/annotation tests: preserve old rows/foreign keys and support all database owners. Reopen after an important continuous delivery, not only quiet rounds.
- `tests/pi/continuous-p0.test.ts`, `continuous-runner.test.ts`: actual native continuity, exact historical reads, default compaction, task observations, strict tools, fixed-file path/hash/provenance, missing metadata without extra repair requests.
- `tests/continuous-crash.test.ts`: actual child-process SIGKILL while native request active, prior publication and delivery survive, pending input and interruption persist, no replay before explicit idempotent fresh-session recovery.
- `tests/e2e/continuous.spec.ts`: fixed history and drafts under publication, actual v1 discussion provider payload, recipient-only quiet records, denied public-task-only access, explicit handling, config epoch controls, wide/narrow desktop layouts.
- `scripts/probe-continuous.ts`: real provider sequential source changes and task revision, frozen originals and original failures. Review semantic claims separately from protocol success and deterministic tests; report whether live compaction occurred.

## 7. Wrong vs Correct

Wrong: `permission(actor, batch.events[0].sourceId)` or `delivery => job.ruleSnapshot.rule.recipientSeatIds` for every kind.

Correct: discriminate `continuous_analysis`, bind the full epoch source/recipient/scope snapshot, validate its published native reference, and keep existing legacy validation intact. Test both a mixed-source denied reader and a successful important-round restart.
