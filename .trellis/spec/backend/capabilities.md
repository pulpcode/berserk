# R1 Expert Capabilities

## 1. Scope / Trigger

Read before changing capability registration, expert session creation, execution assembly, account administration or capability migrations. R1 uses controlled definitions only. Web publishing, dynamic imports, default preferences, MCP and background-profile migration remain outside this increment. Desktop capability-center behavior shares these DTOs.

## 2. Signatures

- `CapabilityService.open(dataDir)` owns `capabilities/capabilities.sqlite` and digest-addressed `blobs/`. `registerExpert`, `registerBuiltins({skills,roles})` and `registerRoles` persist immutable definitions before publishing metadata. Roles are captured per parent request; their returned revisions must travel with that request.
- `resolve(ExpertRef,expectedDigest)` validates metadata on every request and content on a cold load. Its bounded shared cache contains immutable content only, never user histories, workspace rules or authority. `sessionExpert` projects current availability and update hints.
- `acceptRequest({requestId,ref,principalId,skills,cancel})`, `attachRequestSkills` and `assertCall` coordinate admission, current status and cancellation synchronously in the single process. `setState` and `setAccess` commit denial before propagating cancellation.
- `PiLab.createSession(workspaceId?,seatId?,workItemId?,sessionId?,modelId?,selection?)` accepts `{expertRef?,expectedDigest?,clientActionId?,userId?}`. The last identity field is internal; HTTP obtains it from authentication. Host background callers may preallocate a session ID; the browser cannot.
- Scoped API: `GET /capabilities/experts`, `GET /capabilities/experts/:expertId`, `GET /capabilities/access`; `GET /admin/capabilities/summary` is account-administrator-only. Session POST gains expert selection and UUID action ID; session GET gains `expert: SessionExpert`.
- Offline commands: `npm run capabilities:admin -- grant|revoke|list|sync --data-dir ABS --service-stopped`; grant/revoke require `--username`. `npm run migrate:capabilities -- --data-dir ABS --backup-dir ABS --dry-run` or `--apply --service-stopped`.

## 3. Contracts

`expertId` is stable; `revisionId` plus `digest` identifies immutable content. `releaseVersion` is a visible release label and is never an addressing key. Canonical JSON sorts object keys and preserves array ordering; expert definitions normalize tool/mode/skill sets before SHA-256. Different content with the same release label produces a new revision. Referenced blobs cannot be silently reconstructed from fixtures when missing.

User catalogs include only selectable professional experts; `axon-general` and `role-*` are technical assets. Ordinary new-session creation keeps the general assistant. Selecting an expert creates an empty conversation; no model call, draft submission or background work occurs. Tools are the intersection of the existing host registration and the fixed expert allowlist; `null` preserves the host set and never grants more authority. Background execution keeps its existing identity and rules.

Conversation identity appears as a compact icon and name beside the attachment control inside the composer toolbar. Do not reserve a separate header row or expose release/revision IDs in that everyday label. Fixed bindings remain unchanged; unavailable and update notices stay near the composer, including while an interaction card is open.

Pi-only adapter `capability-history.ts` owns `berserk.expert-binding.v1` and `berserk.execution-manifest.v1`. Bindings are session-level, have no requestId, and precede new-session work. Manifests belong after request-resources and before model-visible messages; they record actual tools, fixed dependencies, model identity and runtime. Child manifests must match the parent-captured role definition; they cannot resolve the latest role pointer at delegation time. A child has its own accepted capability request and also checks its parent's guard.

Expert-declared SkillFile bodies replace current source-file reads for those IDs, including on-demand `skill_read`. Optional explicit selection cannot override a locked dependency. Autonomous skill reads attach the actual snapshot revision immediately before tool execution. Workspace rules and other resources still load every request. Existing strict workspace-index Skill IDs and native composer formats retain their meaning.

Creation intents persist principal+action ID, normalized input digest, original expert reference and preallocated session ID. Check an existing intent before resolving current defaults. Same input retries return the original session after current workspace authentication and work-link reconciliation; different input conflicts. Recover only provably empty preparation under the original ID. Uncertain/corrupt/completed-but-missing outcomes block instead of recreating or replaying work.

Ordinary disable rejects new requests and appended inputs, but accepted requests may finish in their snapshot. Emergency ban or revocation cancels affected work and prevents later calls. Check after awaited confirmation as well as before calling a tool; approvals do not survive denial. Already issued external effects are not rolled back. Captured formal account and current seat/task access remain mandatory.

`capability_account_roles` is an independent denied-by-default table in the existing auth database; it does not renumber optional business schemas or alter their grants. The offline command explicitly grants administrator to an existing enabled account. No seat name or model-setting permission implies administrator.

Explicit stopped-data migration records a verified full backup, prepared/completed stages and a fixed legacy-session allowlist. Reading legacy history never binds it. Only explicit future work appends `legacy:true`, and loaders verify that flag against the allowlist. New missing bindings never use legacy fallback. A prepared migration blocks startup. Rollback uses the matching old program and a complete pre-upgrade backup, preserving new data separately.

## 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Stale chosen current expert/digest | `EXPERT_CHANGED` 409; refresh selection |
| Same action, changed input | `SESSION_CREATION_CONFLICT` 409 |
| Unprovable interrupted/completed creation | `SESSION_CREATION_RECOVERY_REQUIRED` 409; preserve evidence |
| Disabled, banned or revoked new work | `EXPERT_UNAVAILABLE` 409 |
| Explicit Skill conflicts with expert lock | `SKILL_REVISION_CONFLICT` 409 |
| Missing revision/blob or incorrect digest | `CAPABILITY_STATE_INVALID` / strict history rejection; never fallback |
| Old data without explicit migration | `CAPABILITY_MIGRATION_REQUIRED` 409 |
| Prepared migration | `CAPABILITY_MIGRATION_INCOMPLETE` / migration-required rejection |
| Ordinary account requests management | `FORBIDDEN` 403 |

## 5. Good / Base / Bad Cases

Base: New conversation binds the hidden general assistant and retains existing tool permissions. Good: a professional conversation retains the old method body after source updates and restart; a newly created conversation uses the current revision. Bad: treating a role-selection chip as a main expert switch, or completing an intent before reconciling its original work-item association.

## 6. Tests Required

Run capability service/admin/migration tests, `tests/pi/capability-{lab,history,guards}.test.ts`, existing composer/history/subagent/HITL/collaboration tests and `tests/e2e/capabilities.spec.ts`. Assert actual provider input and registered tool names, original Skill bodies, fixed role manifests, database metadata tampering, no model calls during creation, concurrent and restarted creation retries, ordinary in-flight completion, ban after approval and future-only legacy binding. Preserve old handoff fixtures by reconstructing old data and explicitly migrating them, not by weakening new missing-binding rejection.

Run typecheck, lint/boundaries and build. Browser fixtures use the real API/Pi with only provider transport replaced. `probe:capabilities` is separate live-provider evidence; quota failure and unavailable Docker do not count as successful acceptance. Timing reports identify sample count and cold/hot load, assembly, first text chunk and tool duration; a text chunk is not a measured first token.

## 7. Wrong vs Correct

Wrong: use `capabilities.current(roleName)` when a child starts, reuse only the parent's admission, or keep the session's cached expert forever without resolving its fixed digest on the next request.

Correct: capture role revisions with the parent snapshot, admit the child against that exact revision and check both guards. At the next foreground request, resolve the stored binding again; retain that validated snapshot throughout its tool loop.
