# Research: BUG-003 confirmation lifecycle and single-call handoff audit

- Query: Audit current schema → Pi beforeToolCall/HITL → collaboration service/store → UI; trace actual historical changes and map existing coverage to C01–C06/U01–U02; recommend only necessary tests.
- Scope: internal, P0–P1 only; no business edits, real model calls, production access, or test execution by this researcher.
- Date: 2026-10-15
- Task: `.trellis/tasks/09-22-handoff-attachment-integrity`
- Baseline: current shared working tree. Main session owns HEAD/diff verification and test execution. Historical patch files below were collected by the main session; this researcher did not run Git commands (research role prohibition).

## Findings

### 1. Current conclusion and evidence strength

**Confirmed from source and existing test assertions:** the original BUG-003 prepare/commit protocol has already been replaced by `work_item_action`. No `work_item_request` exists or is needed. The original request-local authorization boundary is retained, while preparation and confirmation now happen in the same actual Pi call. Known expired preparations are rejected before the card. All four actions use this path, and lifecycle/race/crash tests already exist. Reimplementing source-plan P2 would duplicate existing behavior.

**Confirmed historical cause:** initial handoff implementation created a card for `getAction(oldOperationId)` without rejecting its projected expired status; `authorizeAgent` then rejected the old request only after approval. The initial two-tool protocol also allowed a model to stop after prepare. These are actual code changes in the historical patches, not deductions from issue text alone.

**Not established in this audit:** natural-language reliability across models, all browser combinations, or current baseline test success. Existing assertions are coverage evidence, not a claim that tests were rerun today. Original confirmation task reports local checks plus one user end-to-end run; it explicitly does not establish broad live-model acceptance.

**Residual presentation question, already reproducible in an existing fault test:** after the business transaction commits but `commitAgent` return delivery throws, the persisted receipt survives, while native tool execution is marked `failed`. The UI renders “执行失败，请查看详情。” This correctly represents tool failure but can be misread as no business effect. The existing error includes the operationId and asks to query the original operation. Treat this as a narrowly scoped outcome-wording/design question, not evidence that the transaction is duplicated or rolled back.

### 2. Files found

All `src/` and `tests/` paths in the rest of this report are relative to `experiments/harness-lab/`.

| File | Role |
| --- | --- |
| `src/contracts/collaboration.ts` | Separate strict current Agent, historical Agent, page and stored schemas; receipt and card projection. |
| `src/pi/collaboration-tools.ts` | Model tool registration, host scope adapter, single-use approval consumption and real receipt output. |
| `src/pi/lab.ts` | Pi hooks, request lifecycle, exact interaction wait/response, grant bridge. |
| `src/pi/interactions.ts` | Strict native history parsing, actual call/policy/decision/result linkage, restart projection. |
| `src/collaboration/service.ts` | Concrete business store, request/grant maps, deduplication, liveness, fixed-file checks and SQLite transaction. |
| `src/server/collaboration-routes.ts`, `src/server/app.ts` | Page action endpoints versus interaction response endpoint. |
| `src/server/auth.ts`, `src/server/seat-scope.ts`, `src/access/store.ts` | Current login/seat authority and immutable task-visibility model. |
| `src/web/InteractionCard.tsx`, `src/web/ChatPresentation.tsx`, `src/web/useChat.ts` | Card decisions, execution display, stale-response merge prevention, GET-before-retry. |
| `src/web/WorkInbox.tsx` | Page-origin prepare/confirm/query flow and clientActionId recovery. |
| `tests/pi/collaboration.test.ts`, `tests/pi/interactions.test.ts` | Actual Pi loop with deterministic provider, lifecycle, replay, fault and SIGKILL tests. |
| `tests/collaboration/service.test.ts` | Direct service safety, page/Agent boundary, revision competition, rollback and idempotence. |
| `tests/e2e/handoff.spec.ts`, `tests/e2e/hitl.spec.ts` | Browser coverage: real local handoff API versus generic mocked HITL fixture. |
| `tests/seat-api.test.ts`, `tests/access.test.ts` | Endpoint/seat boundaries and formal login authority. |
| `.trellis/tasks/09-22-handoff-confirmation-flow/{design,verification}.md` | Original approved fix and historical validation limits. |

### 3. Historical evidence: actual code evolution

Main-session snapshots are in `.local/handoff-reliability-20261015/`. Patch line numbers refer to those snapshots, so they remain reproducible independently of Git availability.

| Commit | Actual code evidence | Effect on BUG-003 |
| --- | --- | --- |
| `683331b1507ade5206a4c377a63cc0dc339dd58d` (2026-09-18) | `683331b.patch:264` introduces original-before/original-after composition, cloned parameters, native policy, wait and post-approval argument comparison. | Establishes existing HITL infrastructure; not a handoff-specific fix. |
| `2abb7822a1222648c0fc3ec6d15de1a9b1ae3ffc` (2026-09-20) | `2abb782.patch:645` adds prepare/commit tools; `:452` adds checkAgent; `:970` reads old action and creates handoff card; `:995` authorizes only after wait. | Introduces concrete request-local business authorization, and the original “old action card before rejection” ordering. `checkAgent` is not an accidental recent regression. |
| `047ab63e7b78d0767f667836ddc021e274b7a5a0` (2026-09-22) | `047ab63.patch:21,43,56,69` changes contract/tool wording, workspace context and attachment card rendering. Legacy two-tool protocol remains. | Description/UI repair did not remove the mechanical two-call dependency. Current legacy fixture explicitly identifies this baseline (`tests/pi/collaboration.test.ts:342`). |
| `c14ec42b8acadfc42f0a209ea654edda99503d0d` (2026-09-23) | `c14ec42.patch:198` registers action tool; `:201` consumes approval with deep parameter equality; `:306` prepares in beforeToolCall; `:313` rejects status other than prepared; `:343` saves operation/parameters/grant under actual call ID. `:502` onward adds corresponding Pi tests. | Implements the proposed single-call repair and pre-card expiry validation. Tests include all actions, cancellation, stale revision, internal failures and legacy continuation. |
| `e81f9d22b1145d5a399844aa6bbe38782e4e012c` (2026-10-10) | `e81f9d2.patch:34` makes new assignment inputPaths explicit; `:63,75` clarifies same-call wait and returns `committed:true` plus actual frozen files; historical schema kept separately. | Subsequent contract refinement; do not regress receipt semantics or interpret old optional inputPaths as current Agent schema. |

The original confirmation verification says deployment initially used `047ab63` plus uncommitted changes and only later code history recorded the repair. A source SHA alone does not establish what was running at that historical deployment.

### 4. Schema and host binding chain

1. **Model inputs:** `src/contracts/collaboration.ts:48–59` provides strict `{action}` with four kinds. Assign and submit omit task/workspace identity; new assign requires `inputPaths`. Historical records use `historicalWorkActionToolSchema` at `:40–47`; page/stored inputs remain `workPrepareSchema` at `:30–38` and `pageWorkPrepareSchema` at `:62`.
2. **Captured authority:** `src/pi/collaboration-tools.ts:27–37` injects the captured workspace task/workspace IDs, verifies existing work belongs to that task and normalizes paths only in the separate service DTO. Real native arguments are not overwritten. Browser scope is captured from authenticated identity or explicit test route at `src/server/seat-scope.ts:7–16`.
3. **Same actual call:** `src/pi/lab.ts:769–795` composes the original Pi hook, clones final `context.args`, calls prepare with current sessionId/requestId/toolCallId, checks stopped state, reads action and rejects non-prepared status. Recoverable business errors return a blocked tool error before any card; infrastructure errors reach terminal catch at `:824–826`.
4. **Card and native evidence:** `src/pi/lab.ts:798–814` writes policy with real args/call ID and creates a handoff card containing the concrete operationId/files. `interactionBase` at `:1212–1214` creates a fresh interactionId plus session/workspace/request/call identifiers. No fabricated second commit call is created.
5. **Approval:** `src/pi/lab.ts:815–821` rechecks stopped state and argument equality, rejects non-approved decisions, then grants `{sessionId,requestId,toolCallId,interactionId}` for the concrete operation. A request-local map stores `{operationId,parameters,grant}` keyed by toolCallId.
6. **Consumption:** `src/pi/lab.ts:748` takes and deletes the map entry. `src/pi/collaboration-tools.ts:68–83` requires that entry plus deep equality with execution parameters and calls commitAgent. Success returns the stored receipt with `committed:true` and the original frozen file manifest. A new action call means a new proposal; content similarity is not idempotency authority.

**Important boundary nuance:** `src/collaboration/service.ts:261–263` checks matching origin session/request, liveness, nonempty grant.toolCallId and UUID interactionId. It does **not** compare grant.toolCallId to origin.toolCallId. `tests/collaboration/service.test.ts:100–106` intentionally uses old prepare-call versus commit-call IDs; exact equality is enforced between the installed grant and commit grant at `service.ts:270`. Current single-call equality is supplied by the trusted Pi hook/map, not independently by the storage method. No public endpoint accepts a caller-selected AgentCommitGrant. This is not a demonstrated untrusted bypass. Do not “fix” it without considering old service contract semantics; a focused current host-binding regression is preferable if coverage is expanded.

### 5. Liveness, cancellation, restart, repeats and conflicts

- `service.ts:34–37,116–118` binds preparations to a random hostId and active session→request map. A process restart changes hostId, so old uncommitted page and Agent actions expire. `getAction(:126–129)` projects expired status without rewriting the stored prepared row. A DB row reading `prepared` is not evidence of current authority.
- `service.ts:171–178` registers active requests and removes matching grants on end. `lab.ts:471–480` aborts immediately and ends the business request; request finalization repeats endRequest at `:1204`. No pending wait is reconstructed.
- `service.ts:210–234` clones inputs/origin before await, hashes exact input, serializes preparation, deduplicates by seat+origin, validates before and after copying, then checks active request again. A changed payload under the same dedup identity conflicts.
- `lab.ts:1217–1248` permits one wait per active request, records it before waiting, removes listeners and writes cancelled status on stop/timeout. Browser disconnect alone does not cancel.
- `lab.ts:1251–1271` scopes session/interaction, validates strict response, compares requestId, rejects interrupted old requests, and synchronously appends the first decision before resolving the promise. Identical completed decisions acknowledge; different decisions conflict. Repeats do not reexecute a tool.
- `service.ts:264–271` separates page and Agent origin. Agent commit requires an installed exact grant; grant is deleted after commit attempt. Consequently a completed Agent operation should be **read** through getAction/work_item_read, not retried with an expired grant. Page committed operation replay returns its original receipt.
- `service.ts:278–292` verifies frozen files before the short transaction, checks abort, rereads action/receipt and grant, then validates current work revision/role/state inside `BEGIN IMMEDIATE` (`:106–109`). Writes and receipt save are atomic at `:294–321`. Same operation repeats cannot add a second work; distinct old-revision actions cannot both win.
- `src/pi/interactions.ts:129–205` links real assistant calls, policy, exact parameters, interaction and tool result; successful action details.operationId must equal handoff.operationId (`:148`). New/old historical tool formats are deliberately separate. Replay verifies evidence; it never installs authority.

### 6. UI and uncertainty

- `src/web/ChatPresentation.tsx:49` only enables pending decisions for the active matching request, excluding stopping requests.
- `src/web/useChat.ts:215–256` rejects mismatched/terminal-regressing interactions, locks in-flight decisions, requires query after an uncertain response, checks session/workspace/request identity on query and session/request/kind on response. It never retries automatically.
- `src/web/InteractionCard.tsx:70–114` distinguishes approval from execution and renders pending/expired/cancelled/unknown/not_started. Actual handoff files are displayed. It does not infer success from assistant prose.
- `src/web/WorkInbox.tsx:108–151` recovers uncertain page preparation by saved clientActionId or operationId; it separately sends the existing one-click page commit, then displays real receipt. `src/server/collaboration-routes.ts:16–24` sends only page-origin calls to prepare/commit; `lab.respondInteraction` is a separate endpoint.
- Existing injected post-commit failure at `tests/pi/collaboration.test.ts:315–333` explicitly asserts both `execution:'failed'` and an existing receipt/one work in the `after` case. That becomes “执行失败，请查看详情。” through `InteractionCard.tsx:74`. Minimal future option: distinguish tool delivery failure from business outcome, or use neutral “工具处理未完成，请查询原交接结果” for uncertain action failure; retain queryable receipt and original native evidence. No automatic retry, synthetic success, new log or grant recovery is justified.

### 7. C01–C06 / U01–U02 coverage map

These are source-audited existing assertions. Current execution results belong in the main session's verification record.

| ID | Existing tests and observed assertions | Remaining gap / interpretation |
| --- | --- | --- |
| C01 | `tests/pi/collaboration.test.ts:78` checks no work before approval, duplicate approve, one work, actual bytes, successful receipt/files, restart; `:176` covers claim, submit, return, resubmit and accept. `tests/e2e/handoff.spec.ts:246` uses actual API/Pi/store, one browser response, no page prepare/commit requests. | Mechanism directly covered. Does not prove natural model selection. |
| C02 | `tests/pi/collaboration.test.ts:252` deliberately ends request after prepare before card and asserts no card/work plus WORK_CONFLICT with operationId. `:336` loads real old fixture, attempts old commit tool, verifies not-found tool error and only a fresh action can produce work. `tests/collaboration/service.test.ts:97` proves grant expires on request end. | Original protocol is no longer exposed; do not re-register old commit solely to reproduce it. Could strengthen direct service cross-request B assertion if needed, but not a missing production mechanism. |
| C03 | `tests/pi/collaboration.test.ts:124` reject/cancel → no committed flag/work, expired action; `:281` cancel during file prepare → no late card; `:296` cancel synchronously in approval callback → commit never called. `tests/pi/interactions.test.ts:111` whole-request timeout cancels pending AskUser. | Timeout shares wait implementation but current timeout test is a question, not business action; one direct action timeout case would close the combination. |
| C04 | `tests/pi/interactions.test.ts:98` rejects late/foreign responses after stop; `:231` restart pending/approved-without-result stays expired/unknown and old approval is rejected even after a later request. `tests/pi/collaboration.test.ts:422` real SIGKILL waiting/before/after commit preserves business truth and native unknown without replay. | Strong direct/shared coverage. Do not claim persisted approval restores execution. |
| C05 | `tests/pi/collaboration.test.ts:93–116` duplicate approve → one work; `:136` query receipt without resubmit; `:315` internal error before/after transaction keeps actual receipt; `service.test.ts:63` concurrent same-page operation gets same receipt; e2e handoff `:132` lost page commit response→query after reload, exactly one prepare/commit; generic e2e HITL `:246,277` uncertain/lost/conflicting response → GET-before-manual retry/no repost. | Browser lost `/response` plus actual business commit is not combined in the real handoff fixture. Good minimal browser protection addition; no new protocol needed. |
| C06 | `tests/collaboration/service.test.ts:74` two claims at old revision, second conflicts; `:163` concurrent submissions have one success, one visible submission and private losing copy. `tests/pi/collaboration.test.ts:265` competing page claim while card pending→approved action fails WORK_CONFLICT, operationId retained, revision exactly 2. | Direct coverage; no reason for another general concurrency framework. |
| U01 | e2e handoff `:246` actual pending refresh and completed receipt/card; `:147` separate seat drafts/late replies/uploads; Pi collaboration `:90–91` foreign seat cannot get or approve actual card; generic HITL `:289` stop/expired/unknown states. | Actual pending handoff + switch away/back + foreign attempt + lost response combination not directly asserted in one browser test. Existing 375px tests are historical only; no mobile work proposed. |
| U02 | service `:97` and seat API `:103` reject page commit of Agent action; service checkAgent rejects page source. Page e2e `:67` uses one page confirmation; Agent e2e `:246` asserts zero page prepare/commit and one response endpoint call. | Reverse page→Agent attempt has code guard but no explicit assertion found in this service test; can add a short test if a single boundary matrix is desired. |

### 8. Authority recheck investigation and counterevidence

Initially suspected: `storedAction/getAction` (`service.ts:112–129`) only enforce valid/owning seat, and committed receipt fast return (`:274`) precedes access.acquire. This is a real implementation detail, but it does not establish a current externally reachable access bug.

- `src/server/auth.ts:45–58` authenticates every API request against enabled identity/session before the work-action route. `seat-scope.ts:12` supplies that identity's seat; foreign actions fail storedAction's seat check. Disabling an account invalidates sessions (`src/access/store.ts:99–102`).
- Current task visibility and owner are immutable; `AccessStore.update` at `:150` accepts only title/goal/state/context. There is no supported “remove A from a previously public task” capability. Archived history is intentionally readable (`get` at `:118–124`). Active requests/live preparations/unfinished works block archive (`:156`, collaboration's blocking logic).
- `.trellis/spec/backend/task-access.md` explicitly says accepted work continues under captured seat when login is invalidated; SSE disconnect is not business cancellation. Do not reinterpret session expiry as mandatory cancellation of a previously authorized request.
- Therefore a test directly rewriting task visibility/owner in SQLite would invent an unsupported product operation; it would not demonstrate a current regression. No production fix recommended from this hypothesis.
- Small useful protection test, using `tests/access.test.ts:17–35` setup/login: create and commit a page action, disable the owner account, then call GET `/api/work-actions/:id`, GET `/api/work-actions?clientActionId=...`, and POST `.../commit` using stale credentials; all should return 401 with no new work. Existing `:232` checks expired/disabled login at `/api/info`, not those receipt routes. For current enabled foreign-seat access, assert 404 and no receipt disclosure. These are expected-green boundary tests.

### 9. Smallest justified next tests / design

Priority is execute existing relevant suites, then add only missing combinations selected by the main session:

**P1 minimum recommendation (main-session convergence): add only the business-action timeout test and disabled-identity receipt-route protection test below.** Both should protect existing correct behavior. The browser combinations and reverse-origin assertion are optional subsequent coverage, not a reason to block this research phase or expand the business implementation. The main session reports baseline lint/typecheck passed and is running 14 relevant test files; consult its verification artifact for the final results.

1. **Business timeout** in `tests/pi/collaboration.test.ts`: set an explicit bounded request timeout with fake provider action, await real pending card and expiry, assert no commit/work, action expired, late approve conflicts, subsequent fresh request can use a new card. Reuse wait/barrier helpers; no real model, no default production deadline change.
2. **Real card seat switch + lost approval response** in `tests/e2e/handoff.spec.ts`: extend existing actual API fixture (`:11–36`) with `loseResponse`; inject the real request first, abort only browser delivery, assert one commit effect, query/refresh reconciles, never posts twice. Switch to B while A's card is pending and assert B sees no actionable A card; direct foreign scoped request rejects. Separate tests are preferable if a combined one becomes flaky.
3. **Receipt route authentication** as above. No speculative task-membership mutation.
4. **Optional reverse-origin assertion** alongside `service.test.ts:97`: try authorizeAgent/commitAgent on a page action and assert WORK_CONFLICT/no effect. Keep the trusted legacy prepare-call/commit-call distinction documented.
5. **Only if the presentation question is approved:** extend the existing post-commit fault fixture into a desktop card assertion comparing actual receipt with displayed wording. Preserve unknown native evidence; never change “failed” into “succeeded” by querying business state and rewriting JSONL.

Recommended focused existing commands (not executed by this researcher): from `experiments/harness-lab`, `npm test -- tests/pi/collaboration.test.ts tests/pi/interactions.test.ts tests/collaboration/service.test.ts tests/collaboration/crash.test.ts tests/seat-api.test.ts tests/access.test.ts`; `npm run test:e2e -- tests/e2e/handoff.spec.ts tests/e2e/hitl.spec.ts`. Main session should run in its authorized baseline environment and keep every failure. Research-only write scope prevents this agent adding tests/code.

### 10. Related specs and references

- Read: root user-provided AGENTS.md, `.trellis/workflow.md`, `.trellis/spec/backend/index.md`, `.trellis/spec/frontend/index.md`, `.trellis/spec/backend/{hitl,task-handoff,task-access}.md`.
- Original fix: `.trellis/tasks/09-22-handoff-confirmation-flow/design.md` and `verification.md`; current task `bugs.md` and `reliability-2026-10-15/source-plan.md`.
- Source package pins `@earendil-works/pi-coding-agent` and `@earendil-works/pi-ai` to `0.85.1` (`experiments/harness-lab/package.json`). This audit concerns the checked-in host integration, not inferred behavior of a newer SDK. No external browsing was needed or performed.
- Parent-provided history evidence: `.local/handoff-reliability-20261015/relevant-history.txt`, `main-last-60.txt`, and `683331b.patch`, `2abb782.patch`, `047ab63.patch`, `c14ec42.patch`, `e81f9d2.patch`.

## Caveats / Not Found

- No `work_item_request` implementation was found; current named tool is `work_item_action`. Source-plan name is a candidate, not a missing implementation requirement.
- No new business code or test files were written, no unit/browser/live test was executed, and no production data was accessed. This file is the only researcher-owned output.
- No current confirmed mechanism defect requires rebuilding P2. Findings distinguish code-backed protection from unexecuted coverage and UI semantic ambiguity.
- `checkAgent` origin/grant toolCallId inequality is intentional in the legacy service contract and still backed by a trusted host binding for new action calls; do not overstate independent service enforcement.
- Post-commit fault test demonstrates that tool execution failure and committed business truth can coexist. This is not exactly-once protection for Bash/external systems, and read-only receipt lookup is not permission to replay Agent writes.
- Formal task permissions presently have immutable public/private ownership. Future membership/visibility changes would require revisiting receipt authority; that future capability is outside this P0–P1 scope.
