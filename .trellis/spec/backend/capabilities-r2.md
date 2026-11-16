# R2 Expert Management

## Scope and ownership

R2 extends the existing capability store with organization drafts, validation, isolated trials, atomic publication, ordinary lifecycle, seat use policy and personal/seat/task defaults. R3 skills extend this through [R3 Skill Packages](capabilities-r3.md); [R3A conversational authoring](authoring-r3a.md) adds confirmed draft management only; R4 connectors, R5 background migration, R6 teams and R7 emergency administration remain future work. Never expose banned administration through R2.

## Storage and mutation contracts

`capabilities/management.ts` owns R2 tables in capabilities.sqlite schema2; `capabilities/service.ts` still owns immutable schema1 expert content, cache, admission and creation intents. Keep original revisionId/digest and all R1 duplicate release labels. A draft CAS conflict preserves client input. Validation binds draftDigest, skills and selected tool policy metadata; changes invalidate prior evidence.

Organization experts start with empty use policy and no published pointer. Builtins are read-only; copy creates an independent organization ID. Startup cannot overwrite organization publications. Publish requires valid current configuration, explicit use scope, release notes, human publication intent and individually acknowledged risk codes. Isolated trials and their separate administrator result confirmation are optional; no trial status or file-environment trial evidence is a publication gate. The core writes durable blobs before an SQLite transaction commits revision/current pointer/publication/audit/action receipt. Same principal+action+input returns one result; changed input conflicts. Recheck authority after mutex acquisition and after awaited blob writes. New releases are1.0.0 then PATCH; unchanged content does not manufacture releases.

Ordinary disable and archive block future work while accepted work drains; archive hides catalog entries but retains history. Restore only clears disabled, never bans or account denial. Policy withdrawal remains an immediate guard and cancellation source. Lifecycle requires current publication ID plus stateRevision CAS; initial stateRevision is0.

## Identity, defaults and API

Server routes reject extra authority fields; formal identity comes from current login. `server/capability-authorization.ts` separates system administrator, personal preferences, seat management and task metadata authority. An independent administrator has no business seat and gains no public business-task, foreign workspace or model-setting authority. `accountIdentityOf` supplies management actors; `Identity` and `identityOf` remain business-only. Private task/workspace/chat routes alone use `workspaceIdentityOf` with the server-derived account storage scope; no scope is persisted in `seats`. Register management routes outside the business seat hook. All accounts share the Axon application chrome and capability-center UI. Seatless administrators default to `/capabilities` and may create private personal spaces/conversations through the existing application, while business task-space navigation/hooks/APIs remain disabled; `/admin` remains a legacy link only. The expert page exposes an explicit create action and selected-expert editing only to current administrators. The shared library endpoint exposes controlled skill metadata without workspace or management data. The overall business seat receives no implicit administrator grant. See [Task and Seat Access](task-access.md) for exact private ownership, current workspace eligibility versus business collaboration, native runtime tool isolation, system roles, offline nullable-account migration and provisioning. Seat default choices and checks use the target real business seat; runtime account denial still wins. Business participation remains separately required for business use.

Defaults resolve explicit > task > personal > seat > general. Inherit alone falls through; explicit general stops traversal. A selected unavailable default raises409 with its source. Resolve only inside the original creation reservation after looking up an existing receipt. Host-preallocated background paths retain R1 behavior. Optional creation-intent source projects into SessionSnapshot.expertDefaultSource; native ExpertBinding schema1 stays unchanged. History is not retroactively relabeled.

## Trial execution boundary

`pi/capability-trials.ts` reuses PiLab and native Pi execution in independent directories/indexes. Internal requestGuard is checked at start, model admission and every tool including after confirmation. Internal executionMode=trial permits fixed unselectable draft binding, records trial manifests and disables Pi automatic retry. No HTTP caller controls these internal options. Trial model credentials stay in memory; no production auth/context/background/agent paths are copied. Inputs are explicit synthetic/de-identified files.

A closed set of synthetic read adapters can be injected only into an authless trial host. Business writes are excluded, never faked as real effects; unsupported real integrations/schema compatibility remain explicitly unverified. Declared file tools require actual controlled execution availability. FakeDocker tests are not realDocker evidence. Trial downloads use administrator/owner-bound routes, never production workspace paths.

Runtime execution evidence and management confirmation have separate ownership; route views compose both. Trusted failed/cancelled/interrupted terminal updates converge even if the administrator has been revoked. Restart marks running trials interrupted and reconciles metadata without reconstructing execution. An authorized retry of the same trial never replays work.

## Migration and rollback

Only a newly created capability database auto-initializes R2. Every existing R1 database, including zero-session stores, requires stopped explicit `migrate:capabilities:r2` with independent full verified backup. Prepared markers block startup before builtin registration, even after schema2 committed. Dry-run lists actual builtin sources, duplicate labels, denials and unfinished intents. Rollback pairs the R1 binary with a restored copy of the original full backup, never the R2 active root; preserve R2 data and backup originals.

## Verification

Run management/core/security/API/trial/synchronization tests and existing capability/migration/handoff regression. Browser tests use real auth/API/Pi and fake only provider transport. Typecheck, lint/boundaries and build are required. Keep first-run failures and exact rerun coverage; real Ark/Docker, synthetic adapters, storage timings and user acceptance are separate evidence categories.

## Optional expert trials

### 1. Scope / Trigger

Publication now treats expert trials as optional effect verification, matching Skills. This changes management request/record contracts only, not Pi execution, admission, sandboxing or trial isolation.

### 2. Signatures

`POST /api/admin/capabilities/experts/:expertId/publish` accepts `PublishExpertInput` with optional `trialId?: string`; all other required fields remain required. `ExpertPublication.trialId?: string` stores an actual qualified reference only. Both remain in their original JSON records/tables; no schema version or migration is added.

### 3. Contracts

Omitting trialId allows publication regardless of whether trials are absent, running, failed, cancelled, interrupted or awaiting confirmation. Never invent a passing trial or change an existing result. Explicit trialId retains UUID validation, private owner/expert checks, matching draftDigest and validationId, succeeded status, real success evidence and administrator confirmation; recheck its confirmation at the original async commit boundary. Existing requests with qualified references and their action receipts remain compatible. File-environment trial success is no longer a publication gate even for file tools; current tool risk acknowledgement and execution-time environment/permission checks remain effective. The administrator expert-detail GET projects only the current actor's trial records so automatic UI association cannot select another owner's otherwise matching success; shared publication metadata stays readable. Trial execution and optional result confirmation retain their existing authorization/isolation contracts.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| No trialId; other publication conditions satisfied | Publish without a trial reference or model call |
| Explicit malformed trialId | HTTP 400 schema validation |
| Other owner or nonexistent explicit trial | Existing not-found response; no private evidence exposure |
| Explicit cross-expert, stale-draft/validation, unsuccessful or unconfirmed trial | Existing capability conflict; no publication |
| Missing current validation, dependency invalidation, unacknowledged risks or closed use scope | Existing publication rejection remains |
| File tools without successful file-environment trial evidence | No trial gate; tool risk acknowledgement remains required |
| Authority/CAS or explicitly referenced trial confirmation changes before commit | Reject atomically, retaining original transaction and action-retry semantics |

### 5. Good / Base / Bad Cases

Base: publish a validated expert with no trialId and no model invocation. Good: optionally associate a genuine same-draft/same-validation confirmed success, including an old-format client request. Bad: attach an old validation's success automatically, or translate missing references into a claimed successful result. Existing sessions keep their immutable binding; subsequent sessions select the new revision.

### 6. Tests Required

Service/API/browser tests cover no-trial publication, non-gating trial statuses, file-tool risk acknowledgement without environment trial, explicit invalid references, old qualified trial requests, action retry, authorization/CAS guards, and old/new publication reads after restart. Desktop1060/1440 browser checks assert optional copy, explicit publication checkbox, no model call during publication and preserved optional trial/confirmation UI. Keep Skill publication and runtime history/admission regressions separate from real-provider or real-Docker acceptance.

### 7. Wrong vs Correct

Wrong: enable the browser button while the route still requires trialId; or suppress an explicit bad reference and claim it was verified. Correct: optional shared DTO and route required list, branch the original service checks only on supplied trialId, preserve true optional evidence, and omit unmatched UI references without altering trial records.
