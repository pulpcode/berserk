# Scenario Director and Business Clock

## 1. Scope / Trigger

Read when changing the M1 harbor-fire demo, director authentication, scene-source HTTP, resource clock semantics or replay recovery. This is an isolated synthetic source demo; it does not add physical dispatch, plan approval, vehicle motion, a workflow platform or a Pi loop. The ordinary task/map/source features remain independent.

## 2. Signatures

- `MOCK_CONTEXT_SCENARIOS_ENABLED=true` enables `scripts/mock-context/scenarios` in the existing mock process; default off. It requires separate query/control tokens. Example context/background/notification files live in `experiments/harness-lab/fixtures/scenario-demo`.
- `ContextSystemConfig.scenarioClock?: boolean` explicitly trusts a scene clock. `simulation.directorSeatId?: string` binds the independent `Identity.controlScenarios` capability to the configured director seat. It cannot name any of the four business seats.
- `/api/simulation/scenarios`, `/instances`, `/instances/:id`, `/instances/:id/preview|steps/:stepId|control|activate` and `/operations/:clientActionId` are director-only. Instance lists are paged. `/instances/:id/initialize` GET reads task mapping, POST initializes three predefined public tasks using the existing task-management capability.
- Public action reads/sends retain `/api/simulation/actions/:id[/send]`; authorized scene calls proxy to `/control/scenario-actions/:id[/send]`. Legacy `/control/actions` and `/control/state` never expose new scene actions or state.
- `ScenarioTasks` stores only task creation IDs and activation receipts in `LAB_DATA_DIR/scenario-runs`. `ScenarioStore` stores versioned JSON in `scenario_instances` and `scenario_active`; the legacy snapshot table is untouched.

## 3. Contracts

Without both enabled simulation and an explicit director-seat configuration, the host registers no new scene routes and creates no scene-run directory. Legacy simulation routes remain available under their existing grants.

The director uses the existing login and Cookie session, with a dedicated page `/scenario-director`; register its HTML fallback in the built static server as well as the client router, so direct visits and reloads work outside Vite. Business accounts have no entry and direct access is denied. A name, guessed URL, source `manage`, task/model privileges or old `simulationEnabled` never grants scene authority. The host re-reads the current identity on operations, validates the configured seat and independent capability, and injects actor IDs; browser-supplied actors are rejected. Reads of definitions, future steps and director records require the same authority as writes. Source viewing and public task management remain separate grants.

Director/business isolation (user decision, 2026-11-04): the director only controls the scene, prepares native task metadata and starts new runs. `Identity.canCollaborate` is computed by the server; the configured director seat and any seat granted `controlScenarios` are excluded from business participation even if they retain public-task management. A configured director remains excluded after its scene-control grant is revoked. Login choices retain the director, while business recipient choices and the Agent assignment directory exclude it. Public task/map/source-receipt verification remains read-only. No work assignment, reception, claim, submission, review, business conversation execution or handoff import is authorized by scene or task-metadata privileges. UI hiding is supplementary: the actual services check the current actor and recipient, including commit-time eligibility changes. Retain historical seat IDs and native bytes for startup/history validation; do not treat old director participation as corrupt state or replay it as current authority.

One browser profile shares its login across tabs. Parallel director/business demonstrations use separate profiles/sessions. Existing CSRF and identity-view guards remain active. The director does not gain business approval authority or control tools for its Agent.

The scene clock is `{instanceId,businessNow,revision}`. `businessNow` advances only when a predefined step is applied. Clock, facts, notices and operation receipt commit together. Pause/resume does not tick time; restart does not catch up real elapsed time. New runs use fresh IDs and freeze old ones. Facts preserve observed/effective/expiry times, including delayed old observations.

Scene source responses carry `snapshotClock` and `asOf=businessNow`; `queriedAt`, result `createdAt` and ingress `receivedAt` remain real audit timestamps. A configured scene source without a valid clock fails; an unconfigured source cannot appoint its own clock. Resource query fixes one clock across sources/pages and rejects mixed instances, revisions, real-time records or unclocked annotations. Task-linked reports/areas/stations use the same fatal clock-validation rules as direct resource selections: an invalid declared scene snapshot must not become an ordinary partial-source failure just because a later resource read has a valid clock. Shared `resourceFactActive(fact,at)` never reads the wall clock.

Scene resource results use v4 with `timeBasis:'scenario'`, `snapshotClock` and `statisticsScope.at=businessNow`. The actual availability/quantity/location evidence checks use this time. Expired unavailable evidence does not certify repair: absent other effective evidence the state is unknown. Query remains read-only; source business owners maintain repair/occupancy/execution facts. Fixed reads/summaries and resource-derived spatial provenance retain the old scene time. Legacy v1–v3 result bytes/semantics remain readable; normal queries still create v3.

Saving a step never implies notification delivery or analysis. Frozen message IDs/content are reused; send uncertainty queries ingress receipts before resending. New instance creation has an operation-ID readback even when the client never received its generated instance ID. Host task creation persists stable IDs before side effects. Activation validates the new run's prepared status, revision and current definition hash, plus old-run readiness, before writing a pending receipt or archiving tasks; pending cross-system activation blocks new mutations until its receipt is reconciled. It is not a distributed transaction or automatic rollback of earlier effects. If activation fails after its exact request has acquired a pending receipt, return `SCENARIO_ACTIVATION_PENDING` (409) to retain the browser request; do not translate 401/403 or disclose the operation ID after authorization loss. Recheck current director authorization before reporting a pending operation. A known rejection before any pending receipt keeps its original error. The operation GET still returns 404 when the source has not committed, allowing explicit retry of the same immutable request.

Before changing source definitions, reconcile pending activations. If a definition changed during a pending activation and the source operation is absent, preserve both data stores/receipts, restore a compatible source build publishing the original definition hash, and reconcile/continue the same operation before upgrading and creating a new run. Never delete pending state or assume archived tasks roll back. See [the M1 activation recovery procedure](../../tasks/11-04-scenario-demo-m1/research/activation-recovery.md) for prerequisites, API steps and the fault-injection evidence. This is controlled continuation, not automatic cross-version recovery.

The director sees the scheduled time, event title, notification count and the “投放下一步” action together. The compact list uses a viewport-bounded popover after 250ms hover. Leaving the row and popover dismisses it after 180ms. Clicking or pressing Enter pins event details. Task and receipt links are available in the details. Browsing any row keeps the delivery target tied to the run’s current step. Escape restores the trigger’s focus. The popover follows scroll and resize.

One explicit click previews and checks the indicated instance, step and revision, applies its facts with a recoverable operation ID, then sends that step’s frozen notifications in order. The event is fully delivered once its notifications have been accepted. A partial delivery remains the primary item until its outstanding messages are resolved. An uncertain apply requires operation reconciliation. An uncertain notification requires receipt verification before an explicit retry of the same message. Reload, hover and receipt reconciliation alone never send a notification. Keep preparation, activation and old-run termination explicit. The header “记录” opens the shared native `Resources.Panel` dialog with “操作记录” and “数据概况”; remove the permanent footer records card. Keep scene time distinct from real time, format real timestamps in browser local time with the zone shown and original ISO in titles, disclose technical instance identifiers on demand, and identify the latest-20-operation limit when reached.

Step/task annotations are director author metadata, not source-declared task impact or Agent analysis. `detail.steps[].taskCodes` and `detail.taskDefinitions` are optional, read-only control projections; never persist them into the scene world, change the definition hash, send them as notification fields or expose them through ordinary query/tool responses. Older responses without these annotations remain usable and do not trigger guessed associations. Main-story views show the first five steps and the decision stop; source replay retains all steps. Frozen runs, denied identities, error messages and pending receipts retain their existing boundaries.

## 4. Validation & Error Matrix

| Condition | Behavior |
| --- | --- |
| Not authenticated | Existing login; API 401 |
| Business seat, absent independent grant, wrong configured seat | 403, no scene definitions/future records |
| Director attempts business participation, or another seat targets the director | Deny at the business service and HTTP/Agent boundary before side effects; preserve scene/task-preparation access |
| Missing task-management capability at initialize/archive | 403; scene authority never fabricates this grant |
| Stale scene revision, paused/frozen run, unreconciled activation | 409; retain original operation ID and recovery path |
| Missing/untrusted/mixed clock | `CONTEXT_TIME_BASIS_CONFLICT` or `RESOURCE_TIME_BASIS_CONFLICT`; no wall-clock fallback or successful total |
| Scene cursor stale / cross-run selector | Explicit source conflict; no silently combined pages |
| Lost create/apply/activate response | Read original operation; retry original immutable request if absent |
| Exact activation has a persisted pending receipt and then fails | `SCENARIO_ACTIVATION_PENDING` (409), preserve original request; no automatic rollback; authentication/authorization 401/403 remain unchanged |
| Legacy endpoint with new scene IDs | Not found/rejected; no implicit scene routing for business managers |

## 5. Good / Base / Bad Cases

Base: director creates a run, initializes T01–T03, activates, previews/applies E01, then separately sends its saved notice.

Good: at scene09:20, V12 remains unavailable even when real date changes; at09:41 expired inspection evidence becomes unknown without repair confirmation. A fixed09:20 result still describes that old time. E09's old09:11 road report never reopens the09:23 closure.

Bad: treat a successful Agent run as vehicle arrival, grant overall seat director access through old source management, or archive old tasks before checking the new prepared run's revision.

## 6. Tests Required

Run `mock-scenarios`, `scenario-resource-clock`, `scenario-director-api`, `director-access`, affected access/schema/background tests, resource query/native result/spatial regressions, typecheck, lint/boundaries and build. The real local HTTP tests must cover53 objects/24 vehicles,12 steps/13 notices, durable atomic failure, replay, clock conflicts, independent seat denial, task/activation recovery and legacy bypass rejection.

Director isolation regressions must cover current eligibility, filtered page/model directories, direct service/HTTP rejection, actor/recipient changes after preparation, old work/native history reopening, business-seat normal flow, and preserved task initialization/activation/replay. Desktop `scenario-director.spec.ts` checks explicit controls, no writes/model calls on load, forbidden business users and lost-result recovery. Source-map tests check typed layers and last-known positions without inventing real data. These deterministic checks do not prove live-model reasoning, real routing or production readiness.

## 7. Wrong vs Correct

Wrong: add a time tool or a page clock while resource calculations continue using `Date.now()`; copy scene answers into task instructions; return all future fixture data through ordinary source reads.

Correct: scene modules share one persisted snapshot, host queries use its explicit time, model-visible text labels both time meanings, and ordinary source APIs expose only committed facts. Keep source truth, director operations, task metadata and Pi native evidence in their existing separate ownership boundaries.

Director visual refinement (2026-11-05): label author task annotations “场景任务”. The header records/map/refresh actions share outlined secondary-control sizing, typography and icons while the map remains a native new-tab link. Record sections use understated underline selection, retaining pressed state and keyboard focus. Keep focus styling local to director controls; do not change global controls or business behavior.
