# Simulation Command Integration

## Scope

Read when changing task commands, command identity grants, native confirmation, the external simulation receiver, or the task command UI. The approved first-round design is `.trellis/tasks/11-08-scenario-document-command/design.md`.

## Ownership and authority

`ContextConfig.commands={enabled,seatIds}` explicitly grants the integration. The service combines this configuration with the current enabled business account, task visibility, existing situation-source scope, and the task's confirmed scenario owner. A seat name grants nothing. `Identity.canIssueCommands` is a server projection. The director remains ineligible. Background analysis and readonly child agents receive no command tools.

Workflow convention is ordinary document submission, overall-seat review, then assignment of the fixed file to the control seat. Command admission does not inspect review or work state. An optional attachment must be an authorized, same-task immutable handoff file. Never disclose its bytes in a command log or forward the document to the external receiver.

## Interface and persistence

`GET /api/commands/availability?taskId` returns `canRead` and `canPrepare`, never a run ID. `GET /api/commands?taskId&clientActionId?` lists this control seat's authorized records. Preparation takes `{workspaceId,clientActionId,command}`. The host derives task/owner/actor and validates the source object types. Source reference queries are split into at most 20 references per request so a legal 24-vehicle command can be prepared. Page commit requires `{confirm:true}` and page-origin preparation; cancel only abandons a prepared page action. Reconcile only queries the original command ID.

Preparation records the actual account as internal `preparedByUserId`; the first confirmed send records internal `issuedByUserId`. Public and external projections expose seat identity while retaining account-level audit in the host.

The separate `commands/commands.sqlite` v1 database and its initialization marker hold stable send intents and actual receipts. Same action key/content reuses the preparation; changed content conflicts. Restart expires uncommitted preparations. Mark a send uncertain before HTTP, and never automatically resend an uncertain request. A persisted received record requires an exact receipt matching its command ID and content hash. Corrupt or missing initialized storage fails closed.

Use the fixed simulation endpoint and server token with the controlled HTTP client. `POST /control/commands` receives host-built metadata and execution content; `GET /control/commands/:id` retrieves a receipt. The external source checks that a new command belongs to its still-active run and that referenced objects exist. Same ID/content returns the same receipt; changed content conflicts. For legacy v4, receive and query do not modify the scene clock, source object revisions, positions or vehicle availability. V5 execution effects are specified below; queries remain readonly.

A receipt means received. Legacy v4 does not simulate movement, occupancy, execution outcome or vehicle feedback; v5 exposes those separately as specified below. Preserve received evidence even when the run closes during the HTTP response. Old preparations cannot send into a new run. Ordinary unsourced task ownership remains deferred under SIM-TASK-002.

## Native confirmation

`simulation_command_send` is a foreground control-seat tool. Preparation uses the existing Pi before-tool hook and confirmation interaction. An in-memory exact tool-call/parameter binding authorizes only that invocation. The page cannot commit an Agent preparation. Interaction history retains a command reference and validates it against the actual native tool receipt. Received, unknown and rejected outcomes project respectively as succeeded, unknown and failed execution; the command confirmation card labels reception separately from vehicle action. Rejection, cancellation, request end and restart do not authorize future sends. `simulation_command_read` can query only commands in the current task.

## Validation

Use real local HTTP, SQLite and the native Pi loop with a deterministic provider. Cover ungranted and director calls, no-document/no-review soft flow, fixed-file lineage, same-key conflicts, duplicate commit, lost response and lookup, explicit rejection, cancellation and revoked access while waiting, old-owner source rejection, restart and damaged receipts. The desktop flow must exercise actual overall→planning→overall→control file handoff and explicit page confirmation. A receiver acknowledgement does not prove model-generated instructions are correct.

## V5 deterministic execution integration

Harbor v5 uses snapshot schema3 with mandatory execution state in the same scenario-instance transaction as clock, occupancy, object revisions, reports and notification actions. V4 remains receipt-only. Never retroactively execute legacy received commands. POST continues to return the immutable reception receipt; GET `/control/commands/:id/execution` returns a separately validated `CommandExecution`, with a stable dispatch root and operation-specific queried command ID. A refused amendment has its own result and does not replace the live root.

Commands may declare dispatch, reroute or cancel. Reroute/cancel require the original dispatch ID, exact current execution revision, same task/seat/run/destination and an eligible unfinished vehicle subset. A new dispatch is accepted or refused as one batch. Vehicle occupation remains through arrival and through cancellation after departure; only never-departed cancellation releases it. A mixed arrived/cancelled root is completed, preserving each vehicle fact; the UI may say all vehicles arrived only when every vehicle arrived. Source state includes internal departed provenance so reroute preparation cannot falsely release a vehicle.

The source routing graph consists of existing road geometry and explicit synthetic S01/S02/S03/L01 access corridors. Its data and speed/preparation settings are definition-hashed. Unsupported starts, destinations and disconnected road sequences are refused. Vehicle path lengths, 12m/s speed, 60s preparation and ceiling-to-seconds determine arrivals. No LLM runs in the source. Position/arrival nodes join the manual director timeline. Condition updates advance continuous movement up to the instant before change, then apply conditions and same-time movement, preserving vehicles that passed before closure. Reads and preview do not mutate state. Frozen history retains saved vehicle facts and applied execution nodes without generating future pending execution nodes.

Situation resource properties may include bounded executionTrack points with businessTime/sourceRevision, executionState and executionCommandId. Current geometry remains the actual vehicle Point. Fleet declaration refresh merges other facts while retaining execution-owned position and occupation. The source produces milestone reports through existing situation notifications and records them atomically before delivery. The host verifies provenance and retains old-owner late feedback as readonly.

## V6 execution feedback repair

Harbor v6 versions feedback facts and history read projections without changing road geometry, speed, preparation time or movement rules. Keep the exact v4/v5 definitions and hashes addressable. Source snapshot schema3 accepts both v5 and v6; existing reports, actions and receipts are immutable and are never regenerated on read. A new v6 run starts through the normal director lifecycle.

V6 milestone feedback derives destination from the original accepted dispatch, and each affected vehicle's current route, position, source revision, state and valid arrival estimate from the saved execution. A blocked vehicle has a validated internal `blockedRoadRef` belonging to that vehicle's route and this world's road objects; this is not inferred by parsing the human reason. Only the blocked state presents a current blocking cause. Reroute or cancellation must not retain a stale current-blockage claim. Feedback distinguishes a route blocked ahead from a vehicle physically located on that road.

Reports and notifications share the same committed facts, with authorized destination/vehicle/route/blocking-road references. They do not contain an Axon task-association answer. Partial reroutes retain per-vehicle routes; partial arrival reports name only the affected vehicles and may give the dispatch group's actual arrival count. Arrival retains task occupation and does not establish release, incident location confirmation or incident completion. A blocked estimate is not a usable arrival promise. Normal background preprocessing retains its original readonly tool grants and cannot query control-seat commands.

V6 history projection and byte pagination follow [Multi-source Context Queries](context-analysis.md). Current object queries and authorized command detail retain full tracks. This repair does not replace source storage with a new trajectory service.

Current v6 generated feedback `areaIds` uses the affected vehicles' source-declared area tags, not the union of destination and route-reference areas. A destination-area-only report search can therefore miss such feedback. Treat tag coverage as a known discovery limitation pending domain semantics; do not interpret source area tags as proof of current physical position.

## V7 source-controlled motion

V7 adds a durable `ScenarioInstance.advancing` anchor tied to one existing step operation. The source scheduler, independent of viewers, settles at a bounded 500ms real cadence, with a maximum four-second display interval. Ordinary position samples cease to be director steps in v7. Source/road/departure/arrival nodes retain their ordering, physics and authority. No-motion intervals commit immediately. Only the source completes arrival and produces feedback; HTTP reads remain readonly. Normal source storage failure stops the scheduler and fails reads explicitly until recovery; it never continues uncommitted movement.

The original operation remains `advancing` until it becomes `completed` or `interrupted`. Exact retries/readback retain the operation ID. On service recovery, stop at committed business time, never catch up downtime. Pause, termination and incoming commands interrupt the active advance before subsequent changes. Old v4/v5/v6 behavior and hashes remain addressable.

V7 stores travelled path prefixes separately as `executionTrail` parts, preserving corners and pre-reroute geometry. These are derived geometry, not synthetic GPS messages; `executionTrack` retains source position records. History state projection omits both heavy geometries. V7 explicitly versions exterior S01 departure/access corridors and the paved warehouse arrival yard; L01 remains the building incident anchor. Synthetic access corridors do not establish legal public navigation.

## Task execution summary (P5)

### Scope / Trigger

Read when integrating task home progress. This is a source-fact projection, separate from private control-seat records; it does not grant command tools or mutations.

### Signatures

`GET /api/tasks/:taskId/execution-summary` accepts only a UUID task parameter and no query fields. It returns `TaskExecutionSummary` (`available`, `readOnly`, `queriedAt`, `complete`, optional `businessNow/counts`, `groups`). Each group carries root identity, authorized destination/vehicle references and labels, source time/revision, a current/saved/unavailable/unsupported/refused tag, and necessary execution causes. `commandId` is an optional detail-navigation affordance reserved for the still-authorized original issuing seat.

### Contracts

Derive run/task ownership from the existing task and received dispatch records. Exclude prepared/unknown/rejected transport intents and amendment duplicates. Read names through the caller's existing situation scope, and execution through the fixed simulation receiver; recheck enabled identity, task and source scope after awaits. Never persist a new result, reconcile a send intent, provision a workspace, advance simulation or call a model while projecting the summary. Unbound tasks/disabled integration return `available:false`, without creating a new ownership association.

The public projection excludes draft instructions, attachments, private goals/sessions, actor-account audit fields and run IDs. Names/ownership and current execution must agree on source business time. Historical or failed-source fallback is explicitly saved and has no current total. Missing objects, repeated/ambiguous vehicle ownership and mixed times yield `complete:false` without `counts`. Deduplicate amendments under the dispatch root; a later dispatch cannot double-count an earlier cancelled movement. Only complete, same-time, unique current vehicles may contribute totals; arrival does not release occupation or end the incident. Strip the detail affordance if control permission changes during reading.

### Validation / Error Matrix

| Condition | Behavior |
| --- | --- |
| Missing task or private task inaccessible | 404 |
| Source scope/account revoked, including during an await | 403; no saved-content fallback |
| Ordinary unbound task or absent command integration | Authorized read returns unavailable, not an invented empty execution |
| Source unavailable / legacy receipt-only record | Explicit unavailable/saved/unsupported state; no complete total |
| More than 100 dispatch roots or 500 referenced objects | Explicit `COMMAND_SUMMARY_LIMIT` 503; do not truncate as complete |
| Duplicate vehicle or different source times | `complete:false`, omit totals |

### Good / Base / Bad Cases

Base: an ordinary task hides execution when unavailable. Good: an overall seat sees seven authorized source vehicle facts while original command detail remains forbidden. Bad: fallback to private cached control records after a source403, or sum a dispatch and its reroute as two fleets.

### Tests Required

`tests/commands.test.ts` covers source/task/account denial before and after awaits, redaction, no source/host writes, unknown/prepared exclusion, same-world task separation, old/frozen records, refusal, cancel/redispatch, ambiguous ownership, time mismatch and bounds. Task-home browser tests must show real source 3-arrived/4-blocked and 7-arrived summaries without granting full control records.

### Wrong vs Correct

Wrong: expose `/api/commands` to every task reader or parse report prose to infer command ownership. Correct: use the established task/run and accepted root records to return a bounded, authorized source-fact projection.
