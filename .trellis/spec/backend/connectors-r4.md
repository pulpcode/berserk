# R4 Connector and Remote MCP Contract

## 1. Scope / Trigger

Read before editing `experiments/harness-lab/src/connectors`, original business connection consumers, foreground Pi MCP assembly, connector authoring references or the connector UI. R4 normalizes existing information/situation/control/ingress without adding business instances and adds named remote MCP connections. R5 background MCP, OAuth, stdio, Apps, sampling/roots/elicitation continuation, subscriptions and new task/default routing are outside this contract. User acceptance is tracked separately in the active task.

## 2. Signatures

- `ConnectorService.open(dataDir,{createdNew?,env?,ingressEnv?,keyFile?,onPolicyChange?})` uses the original capabilities SQLite database. Existing roots need explicit stopped migration. `initializeLegacy(context?,background?)` is only for a new root; subsequent boots read the persisted projection, ignoring legacy file overrides.
- `legacyProjection()` returns frozen original config metadata plus current connection endpoints/environment references; `resolveLegacy({systemId}|{sourceId}|{control:true})` captures a current endpoint/token/revision together. Context, Command prepare/send/readback, Scenario, director/control routes and source authentication use this seam. Keep original scope, source IDs, paging, clocks, task links, queue/dedup/Profile and receipts. Sending a prepared command retains strict revision/credential matching. Readback of an old received/unknown command may use current organization credentials only at the same stable connector and normalized endpoint from its immutable original revision; metadata rename/rotation cannot permanently break readback, and endpoint changes never retarget it.
- `admit(connectorId,principal)` captures immutable revision/subject/credential version; `assertAdmission` rechecks current account, workspace policy, revision and credentials. Lifecycle and credential mutations recheck CAS inside BEGIN IMMEDIATE, after waiting for their service lock. Ordinary disable blocks new admission while accepted work drains. Rotation/revocation/policy change cancels only affected active requests.
- `GET /api/admin/connections`, `POST /api/admin/connections`, `GET|PUT /:connectorId`, `POST /:connectorId/{discover,lifecycle}` are admin-only. Config save is offline and disabled initially. Discovery, exposed actions/use scope and explicit restore are separate operations.
- `GET /api/capabilities/connectors?workspaceId=...` returns only safe authorized metadata. `GET|PUT|DELETE /api/connectors/:connectorId/credential` operates only on the current user. Management credential routes are `/api/admin/connections/:connectorId/credential`; ingress uses an exact `sourceId`. No API returns secret values.
- Message input adds safe `connectorIds?:string[]` (unique, maximum8). There is no task-connection API or account/task/seat default inheritance.
- `prepareIntent(principal,admission,{intentId,requestId,action,contractDigest,argumentsDigest})` returns `{intent,newlyCreated}`. Existing intent never authorizes a resend. `markSent` precedes actual tools/call dispatch; `completeIntent` records known completion/cancel/unknown. Prepared work becomes cancelled and sent work becomes unknown on restart; never replay.

The module tables are `r4_connections`, revisions, bindings, credentials, catalogs, actions, audit, intents, legacy and `r4_connector_meta` version1. The capabilities database user_version remains2. Fixed bindings have durable unique slots `information`, `situation`, `simulation-control`, `ingress`; disable/rename cannot release or reclassify a slot. Generic inbound channels with omitted optional systemId retain their exact sourceId without inventing a business mapping.

## 3. Contracts

### Identity, credentials and network

A principal has current `userId`, original `seatId`, explicit `workspaceKind:'personal'|'task'` at runtime and a reauthorization callback. Personal credentials can be used in the owner's personal space and public tasks that their original account/seat may access. They never become seat/shared/background credentials. Old results retain the original task×seat history visibility; revoking a token does not erase historical content. Administrator use remains personal-only with no business-task access.

`LAB_CONNECTOR_KEY_FILE` names an absolute external owner-only regular file outside dataDir: `{activeKeyId,keys:{keyId:base64_32_bytes}}`. New secrets use AES-256-GCM with AAD binding connection/subject/version and keyed action-receipt digests. Keep old usable key versions for decryption/paired rollback. Missing key rejects secret operations with no plaintext fallback; existing env references stay references. Legacy ingress credential updates and paired environment files retain the original minimum24-character inbound token requirement. No secret belongs in DTOs, URLs, model tools/args, native history, logs, browser storage or sandbox. Ordinary user token forms remain memory-only; never pass their body through the existing JSON-derived sessionAction storage key.

Pin official `@modelcontextprotocol/client`/core2.4.0 and retain Pi0.85.1. Import Client and StreamableHTTPClientTransport from the client root. Supported revisions are2026-07-28 and2025-11-25; auto negotiation is bounded, `inputRequired.autoFulfill=false`, transport/probe/reconnect/step-up retries are disabled. No OAuth provider, separate SSE fallback or shared SDK response cache. Modern JSON/SSE and legacy JSON/SSE are handled by the SDK.

The fixed-target fetch pins validated DNS addresses at the actual Node socket lookup. Reject redirects, URL credentials/query/fragments, metadata/private addresses and unexpected method/target. Explicit operator-approved exact HTTP origin and IP exceptions apply only to that fixed connection. Bound request/response/stream events, idle and whole-operation deadlines. Schema admission rejects external refs and unsupported/oversized constructs; do not replace unsupported contracts with `{}`. Remote content stays inert data, with no linked downloads or HTML execution. Preserve a verified result across late cancellation or display truncation.

### Foreground Pi, selection and history

Use native sequential custom tools, original ask_user/operation confirmation/cancel and SessionManager history. Register no live MCP in authoring, child, trial or background sessions. General allowedTools:null retains original native meaning; separate current MCP admission is mandatory. Professional expert connector requirements intersect current exposed action contracts and use policy; old experts gain none automatically.

An explicit session selection fixes permitted targets without sending or changing drafts. A unique authorized candidate may resolve only for that request, with no persistent preference. Multiple implicit candidates with current usable subject catalogs require the exact host-owned target question through the original ask_user. If a subject catalog is missing or the expert excludes ask_user, preparation instead requires explicit selection through the existing composer, with zero network/model calls. Count all authorized configured candidates, including uncached personal ones, so cached A never becomes a false unique target while uncached B exists. Check expert requirement membership and exposed action contracts before any authenticated discovery. Only a same-request actual answer to that question fixes a target. An unanswered/skipped/forged choice permits no HTTP tool dispatch. Explicit multi-selection supports intentional cross-source work; per-call confirmation still fixes each target and no failure fallback/broadcast is allowed.

Before every external call, show connection/account/tool and final validated/hook-transformed parameters in the original confirmation. The one-use approval binds request/tool call/source/config/catalog/credential subject/version and final argument digest. Recheck immediately before dispatch. Target answer is never operation approval.

Keep original v1 record decoders/text unchanged. New records are `berserk.mcp-admission.v1`, `berserk.mcp-policy.v1` and interaction requested/resolved v2; the original execution manifest lists actual registered tools and is crosschecked against admission/user/source. MCP policy binds raw native-call argument digest and approved final parameters. Results carry strictly validated nonsecret source and actual sent/status/protocol evidence in the existing tool detail view. Sent/lost reply remains unknown even on cancellation; history reads perform no network.

New expert revisions use schemaVersion2 only when explicit connectorRequirements exist; schema1 bytes/digests remain untouched. Draft/reference shape is `{connectorId,actions:[{name,contractDigest}]}` with real catalog validation before proposal/save/publish and at runtime. R3A new expert proposals use schemaVersion2 and original confirmation interaction v3; old authoring interaction v1 is not broadened. Read/propose/save may preserve references, never gain connection/credential administration or live remote calls. Isolated trial remains optional and honestly marks connector integration unverified.

### Desktop UI

Reuse capability-center search/cards/Panel and normal composer/reference controls. Distinguish fixed business connections from named MCP; show explicit discovery, unavailable contracts, exposed actions, use scope and enabled state. User directory offers only approved targets and own credentials. Connection IDs persist only in identity-scoped draft/session selection, not messages' per-turn consumed Skills or account/task defaults. A retained connection alone must not disable ordinary input queueing. Freeze target changes until the active request settles. Render confirmation arguments as escaped inert text and show actual source/status in existing tool processes. Target desktop1060/1440 only.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Existing root lacks R4 module, prepared migration or mismatched pairing | Explicit migration error; no empty initialization |
| First initialization has invalid legacy configuration or ambiguous duplicate business source | Stop/report conflict before freezing authority; never persist a fabricated empty projection |
| Missing legacy query env credential | Original query-unavailable response; unrelated valid inbound processing remains usable |
| Missing external encryption key | CONNECTOR_KEY_UNAVAILABLE, never plaintext fallback |
| Wrong account/seat/workspace, disabled new admission | Auth/current-scope rejection or CONNECTOR_NOT_FOUND |
| Stale revision/state/credential/action input | CONNECTOR_CONFLICT, original input preserved |
| Changed remote schema or missing approved exposure | CONNECTOR_CATALOG_CHANGED, no business args sent |
| Ambiguous/skipped target or missing operation approval | No dispatch; AskUser cannot substitute for approval |
| Sent request without verified response | unknown; no automatic retry/replay |
| Unsupported protocol/schema/continuation | Explicit unavailable/unsupported outcome, no fallback or resubmission |
| Corrupt/cross-user/history source or parameter evidence | Strict state error, no fabricated successful projection |

## 5. Good / Base / Bad Cases

- Good: an admin saves a disabled named connection, explicitly discovers, selects exact action digests/use scope, then enables. A user selects that service, reviews final args and gets a result labeled with its source.
- Base: ordinary chat with no usable MCP continues with the original tool set. Original business reads use fixed source mappings without an extra chooser. No encryption key is needed for auth-none MCP or untouched env references.
- Bad: selecting A fails and the host retries B or another user's credential; treating readOnlyHint, a Skill declaration, a target answer or an old approval as permission; reopening old config files to overwrite migrated authority.

## 6. Tests Required

Run full package typecheck/lint/boundaries/unit/build plus desktop connector and original capability/reference/authoring regressions. Assertions include fixed-slot SQL uniqueness, transaction CAS/action replay, real wire protocol eras, per-subject catalogs/cache/credentials, actual DNS dial restrictions, bounded schemas/SSE, same-family endpoints/same URL distinct credentials, target question versus operation approval, final args/strict native restart history, unknown/no replay/cancel isolation and old-expert/R3A compatibility.

Use stopped full-root and external-config/key/credential backup inventories for dry-run/apply/crash re-entry/pairing tamper/rollback tests. Completed reapply also validates pairing and every backup component; do not require the active R4 root to remain identical to the initial migration snapshot. Real Ark model, controlled HTTP fixtures, real public third-party MCP and user acceptance are separate evidence. The user explicitly excluded Microsoft Learn from R4. Its earlier2025-06-18 counteroffer remains historical failed evidence, not a pending request to extend protocol support. Do not add Microsoft Learn registration or probes. Cloudflare's public documentation MCP is a verified modern target; temporary local proxy exceptions used in probes never become product defaults. Record directory/context bytes, cold/warm assembly, first-call/cancel samples without latency promises.

## 7. Wrong vs Correct

Wrong: `if (expert.allowedTools===null) registerEveryMcp(); fetch(modelUrl,{Authorization:otherSeatToken});` or silently resend after a lost reply.

Correct: derive current principal and existing workspace access, resolve an explicit/unique/answered target, intersect frozen expert/action contracts, validate final args, obtain original one-use confirmation, persist intent, dispatch once with pinned request-owned transport and preserve actual source/outcome.

## Existing multi-source ingress compatibility
A single ingress slot may retain multiple distinct sourceIds for the same systemId. Preserve the complete original background configuration, per-source organization credential references, profiles, recipients, rules and histories. Deduplicate only binding systemIds. Each simulation mapping must match its exact sourceId and systemId when background config exists; missing or cross-system source mappings still conflict. Information and situation query slots remain separate and reject duplicate systems. Regression fixtures tests/fixtures/r4-online preserve the 4316 source topology with normalized endpoints and no credential values.
