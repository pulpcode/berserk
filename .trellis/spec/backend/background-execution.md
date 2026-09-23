# Information Processing and Seat Delivery Contract

## 1. Scope / Trigger

Read for source intake, background execution, information grants/rules, seat inbox, or durable admission. This increment adds host metadata around the existing Pi runtime, not another Agent loop or another chat store. Ordinary foreground requests retain their current mechanism.

## 2. Signatures

- `loadBackgroundConfig(env)` reads the absolute `LAB_BACKGROUND_CONFIG` JSON file. No configuration leaves the feature absent; source tokens are resolved through environment variable references, never returned in public DTOs.
- `createApp(lab, serveWeb, {config,executor?,env?}?)` enables deterministic integration tests. `BackgroundService` uses `lab.access.db`; authenticated mode is required.
- `BackgroundStore` adds schema v3 event/job/delivery/rule/grant/action/control tables to the existing SQLite database. Do not reset account/task/handoff data. Native sessions remain content authority. Reopening v3 validates indexed columns against JSON and required indexes/relations; corruption must not be guessed away. If unfinished jobs or preparation exist, removing background configuration rejects startup so reservations cannot be bypassed.
- Source routes `/api/integrations/:sourceId/{uploads,events}` authenticate Bearer credentials. Only explicitly registered routes with `config.axonSource=true` bypass browser Cookie/CSRF; their async `onRequest` must authenticate before body processing.
- Browser routes `/api/information/{access,events,jobs,deliveries,rules,sources,queue}` and `/api/inbox/:id/analyses` retain login, CSRF and view checks. Information permissions are account-or-seat grants per source, `view` or `manage`.
- Jobs accept either `status` or comma-separated `statuses` (not both), plus source/search/offset/limit. `BackgroundStore.pageJobs` filters and counts the same authorized rows before pagination; combined stopped states retain one stable order. Summaries include authorized titles and preprocessing deliveries for that exact job. Detail adds preprocessing input, retry linkage and a request-scoped native snapshot, including decoded command policies; another seat's analysis returns only the minimal summary.
- `PiLab.startPreprocess`/`createBackgroundExecutor` reuse the existing native execution. `PiLab.start(..., seatId, {background:true,jobId,requestId})` handles seat analysis. `createSession(...,sessionId)` supports preallocated, idempotent preparation.

## 3. Contracts

Intake `{sourceMessageId,title,text,uploadIds?,subjectId?,occurredAt?}` requires text or files. `(sourceId,sourceMessageId)` uniquely identifies one input; hash semantic fields plus ordered attachment name/size/content hash, excluding temporary upload IDs and rule versions. Acknowledgment follows fixed input files and a committed event/initial job transaction. Source pause rejects new input; existing receipt lookup and identical retries remain available. Unmatched inputs consume backlog capacity and need explicit processing.

Source config bounds profiles and recipient seats. A rule cannot expand either. Freeze rule/profile/controlled Skills/Agents at admission; rule changes apply to future inputs. One enabled rule per source. Use revision CAS, and stable clientActionId for creation/reprocessing/import receipts. Initial queue/source controls use revision **0** before their first stored mutation.

Preprocessing has an independent `background/jobs/<jobId>` directory and native session, only its input and service resources. It has no registered seat, seat instructions or private history. Fixed input/output blobs live in `background/files/<fileId>/content`; event text lives under `background/events/<eventId>`. Import uses the existing anchored no-overwrite helper. File references passed to Pi must use `name === basename(path)`, including generated filename prefixes.

Seat analysis captures initiating account/seat/task/input, creates an ordinary seat session, and uses the existing task×seat workspace. Revalidate authority on claim; logout does not cancel accepted work. Preparation persists session/import destinations; queued/running jobs and unfinished preparation reserve relevant sessions/tasks. `backgroundJob` on snapshots/activity is a read projection, not a new native history record.

The two background modes do not register AskUser, instruction mutation or collaboration writes. Bash shares the foreground allow/ask/deny policy. An ask decision blocks that invocation and returns a normal Pi tool error with the reason; it does not set the host terminal flag, approve silently, or create a confirmation wait. Pi can choose an allowed next action. Parser/storage infrastructure faults still stop the request. Put mode-specific approval behavior in the public Bash description: Axon's custom system prompt does not automatically include the factory's promptGuidelines.

Queue states describe a single execution. Cancel is durable before Abort. Shutdown is interrupted unless a user cancellation was already recorded. Queued work survives restart; interrupted work never replays automatically. Success requires rereading native result evidence and verifying fixed output bytes; missing child history or recovery warnings are not success. SQLite and file/native writes are not a distributed transaction.

Preprocess success creates per-seat pending deliveries in the same SQLite transaction. Delivery validates current seat/source rights, fixed input hash, native result references and fixed file bytes, and rechecks rights after asynchronous verification before marking delivered. Retrying delivery does not invoke Pi. Delivered is visibility, not reading, acceptance or analysis. Inbox DTOs remove service rule/profile snapshots. Center view of another seat's analysis contains only seat/mode/state/time; no private task, goal, session link, files or error detail.

Background job concurrency and model-call concurrency are separate. Actual foreground/background/summary/retry/child calls share FIFO permits; waiting consumes neither an attempt nor a streaming idle timeout. Release permits before tool/child/HITL waits. The worker waits while model settings are being saved. Parent/child usage is added once. Do not add arbitrary total step caps.

`succeeded` means a normal, verified execution end, not semantic goal achievement. A final explanation of partial work or inability can still be delivered. Do not infer failure from words in the reply or any earlier blocked tool. Display completion, actual reply and delivery separately, keyed by `jobId`; preserve old `HUMAN_ACTION_REQUIRED` failures without migration or replay. Reprocessing creates a new job using the original input/rule snapshot, not current edited rules, and grants no additional permissions.

## 4. Validation & Error Matrix

| Condition | Outcome |
| --- | --- |
| Missing/wrong source Bearer | 401 SOURCE_UNAUTHORIZED; no browser-auth bypass elsewhere |
| Existing message key, different semantic content | 409; original input/job retained |
| Source paused / queue backlog full | 503 / 429 before acknowledgment; old receipt readable |
| Foreign source information or another seat's inbox | 404 without content |
| View-only mutation / non-owned seat analysis cancel | 403 / 404 |
| Stale rule/control/job revision | 409, preserve user draft |
| Busy queued/preparing/active session or task archive | Conflict; no second request |
| Background command needs confirmation | Invocation not executed; Pi receives error and may continue; preserve evidence |
| Restarted running job / missing native completion | Interrupted or explicit failure; no replay |
| Partial delivery failure | Other seats remain delivered; explicit delivery-only retry |

## 5. Good / Base / Bad Cases

Base: fixed source rule → Pi preprocessing → two inbox records → a person prepares an unsent chat.
Good: one seat submits background Python analysis, logs out, then continues the same saved conversation after completion.
Bad: treating source text as authority, copying service instructions into an inbox response, automatically analyzing merely because a recipient opened a page, or claiming a model response proves committed success.

## 6. Tests Required

Run full typecheck, lint/boundary checks, Vitest, build and desktop Playwright. Use explicit reached/release barriers in cancellation-boundary tests rather than short sleeps. `tests/background/crash.test.ts` SIGKILLs actual child processes at intake commit, claim, native completion and pending-delivery boundaries; the provider is deterministic, not the SQLite/native stores. `tests/background` exercises real SQLite, uploads/imports and native Pi with only the provider mocked. `tests/pi/background-runner.test.ts` covers isolation, cancellation, default compaction/overflow and disk evidence. `tests/pi/model-permits.test.ts` covers FIFO, queued cancellation and child progress at one permit. `tests/e2e/information.spec.ts` uses actual application routes and native Pi with deterministic model responses.

`probe:background` requires actual provider credentials and Linux Docker, uses independent temporary data, writes `validation.json`, and never deploys production. Keep failed safety-gate evidence distinct from successful normal-path evidence.

Cover independent column totals beyond one page, combined-state pagination, source grants, old successful delivery followed by a failed reprocess, and later seat conversation messages excluded from the earlier job detail. Background ask tests must inspect the actual model-visible tool error and continued allowed tool call, not only a final sentence. The live `--feedback` probe verifies the blocked synthetic file remains, then reads it through the real sandbox; the default probe includes controlled synthetic A→B handoff and return.

## 7. Wrong vs Correct

Wrong: add a synchronous Fastify hook without `done`, causing valid intake to hang; validate native history only in memory; display queued ordinary sessions as sendable; reserve an action before rejecting an invalid Skill or oversized draft.
Correct: use async source auth, reread authoritative native evidence, project durable reservations, and finish deterministic input validation before starting a recoverable preparation.
