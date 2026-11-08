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

Use the fixed simulation endpoint and server token with the controlled HTTP client. `POST /control/commands` receives host-built metadata and execution content; `GET /control/commands/:id` retrieves a receipt. The external source checks that a new command belongs to its still-active run and that referenced objects exist. Same ID/content returns the same receipt; changed content conflicts. Receive and query do not modify the scene clock, source object revisions, positions or vehicle availability.

A receipt means received. Movement, occupancy, execution outcome and vehicle feedback belong to the next increment. Preserve received evidence even when the run closes during the HTTP response. Old preparations cannot send into a new run. Ordinary unsourced task ownership remains deferred under SIM-TASK-002.

## Native confirmation

`simulation_command_send` is a foreground control-seat tool. Preparation uses the existing Pi before-tool hook and confirmation interaction. An in-memory exact tool-call/parameter binding authorizes only that invocation. The page cannot commit an Agent preparation. Interaction history retains a command reference and validates it against the actual native tool receipt. Received, unknown and rejected outcomes project respectively as succeeded, unknown and failed execution; the command confirmation card labels reception separately from vehicle action. Rejection, cancellation, request end and restart do not authorize future sends. `simulation_command_read` can query only commands in the current task.

## Validation

Use real local HTTP, SQLite and the native Pi loop with a deterministic provider. Cover ungranted and director calls, no-document/no-review soft flow, fixed-file lineage, same-key conflicts, duplicate commit, lost response and lookup, explicit rejection, cancellation and revoked access while waiting, old-owner source rejection, restart and damaged receipts. The desktop flow must exercise actual overall→planning→overall→control file handoff and explicit page confirmation. A receiver acknowledgement does not prove model-generated instructions are correct.
