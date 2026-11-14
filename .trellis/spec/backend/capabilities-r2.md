# R2 Expert Management

## Scope and ownership

R2 extends the existing capability store with organization drafts, validation, isolated trials, atomic publication, ordinary lifecycle, seat use policy and personal/seat/task defaults. R3 skills, R3A conversational authoring, R4 connectors, R5 background migration, R6 teams and R7 emergency administration remain future work. Never expose banned administration through R2.

## Storage and mutation contracts

`capabilities/management.ts` owns R2 tables in capabilities.sqlite schema2; `capabilities/service.ts` still owns immutable schema1 expert content, cache, admission and creation intents. Keep original revisionId/digest and all R1 duplicate release labels. A draft CAS conflict preserves client input. Validation binds draftDigest, skills and selected tool policy metadata; changes invalidate prior evidence.

Organization experts start with empty use policy and no published pointer. Builtins are read-only; copy creates an independent organization ID. Startup cannot overwrite organization publications. Publish requires current successful trial plus a distinct administrator decision and individually acknowledged risk codes. The core writes durable blobs before an SQLite transaction commits revision/current pointer/publication/audit/action receipt. Same principal+action+input returns one result; changed input conflicts. Recheck authority after mutex acquisition and after awaited blob writes. New releases are1.0.0 then PATCH; unchanged content does not manufacture releases.

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
