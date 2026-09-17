# Harness Lab Backend Contract

## 1. Scope / Trigger

Read before changing `experiments/harness-lab` Pi integration, workspace/resource storage, API, configuration, migration or native history. The implementation includes W01-1 conversation behavior and W01-2/S2a workspaces, file instructions and fixed Skills, plus W01-3/S2b native automatic compaction and W01-4/S2c single readonly subagent delegation. It does not provide multi-user authorization, cross-session retrieval, database transactions, persistent Runs, business approvals or detached/recursive subagents.

The local user can access every workspace. Isolation means that each session's model inputs and tools use its fixed workspace; it is not an account authorization boundary. One service process owns a data directory. Do not run multiple processes against the same `LAB_DATA_DIR`.

## 2. Signatures

- `PiLab.create(config, runtime?)`: construct the concrete Pi integration; the optional runtime is for deterministic integration tests.
- `createSession(workspaceId?)`, `list(workspaceId?)`, `get(sessionId)`: default omitted workspace IDs to the default workspace. A session's workspace cannot change.
- `start(sessionId, text) -> {requestId, run(listener)}`: reserve the session synchronously before asynchronous preparation.
- `cancel(sessionId, requestId)`: reject stale IDs and retain the active marker until execution settles.
- `activity() -> ActivityOverview`: global workspace/session navigation metadata without messages or resource bodies.
- `getCompaction(sessionId, compactionId)`: readonly native summary detail scoped to its owning session.
- `getRequestResources(sessionId, requestId)`: return that session's historical resource record or explicit `unavailable`; never substitute current files.
- `ResourceService.snapshot(workspaceId, signal?)`, `readInstruction(workspaceId, fileId)`, `updateInstruction(workspaceId, fileId, content, expectedHash, signal?)`, `readSkill(workspaceId, skillId)`.

| HTTP endpoint | Input / result |
| --- | --- |
| `GET /api/info` | Model/configuration/limits; no global source catalog or secrets |
| `GET /api/workspaces` | `{defaultWorkspaceId, workspaces}` |
| `GET /api/activity` | `WorkspaceList & {sessions: SessionActivity[]}`; metadata across all local workspaces |
| `POST /api/workspaces` | `{name}` → 201 Workspace |
| `GET /api/sessions?workspaceId=…` | Summaries from that workspace; omission uses default |
| `POST /api/sessions` | Optional `{workspaceId}` → SessionSnapshot; omission uses default |
| `GET /api/sessions/:id/compactions/:compactionId` | Readonly summary, native retention boundary and available metadata |
| `GET /api/sessions/:id` | Authoritative messages, workspace, activity and last result |
| `POST /api/sessions/:id/messages` | `{text}` → POST SSE |
| `POST /api/sessions/:id/cancel` | `{requestId}` → snapshot while stopping |
| `GET /api/workspaces/:id/resources` | Current instruction/source/Skill metadata |
| `GET /api/workspaces/:id/instructions/:fileId` | Current `common` or `workspace` text/hash/editability |
| `PUT /api/workspaces/:id/instructions/:fileId` | `{content, expectedHash}`; only `workspace` is writable |
| `GET /api/workspaces/:id/skills/:skillId` | Fixed Skill text/version/hash |
| `GET /api/sessions/:id/requests/:requestId/resources` | Actual loaded instructions and read Skills, or `unavailable` |

Offline migration requires absolute, independent source and backup directories:

```sh
npm run migrate:workspace -- --data-dir /absolute/data --backup-dir /absolute/backup --dry-run
npm run migrate:workspace -- --data-dir /absolute/data --backup-dir /absolute/backup --apply --service-stopped
```

Stop the service before `--apply`. Never use a running service's changing files as a consistent backup.

## 3. Contracts

### Public data and dependency boundary

`src/contracts/index.ts` owns public messages, snapshots, resources, update results and SSE events. Responses are direct JSON; errors are `{error:{code,message}}`. Reject additional body/query authority fields instead of silently stripping them. Clients and models supply IDs, never filesystem paths, writable scopes or permissions.

`SessionSummary` and `SessionSnapshot` contain `workspaceId`. Each SSE event contains `sessionId` and `requestId`. Terminal events carry the authoritative snapshot. `resources.loaded` exposes metadata; `instructions.updated` exposes actual changes. Full texts are fetched through the request resource endpoint. `PublicMessage.requestId` is optional: native resource entries establish request boundaries; legacy messages do not receive invented IDs.

Pi packages and JSONL interpretation stay inside `src/pi` and corresponding integration tests. The server uses concrete `PiLab` methods; resource/workspace services do not import Pi; the browser imports contracts. Do not introduce a generic adapter until there is a tested need.

`SessionActivity` extends `SessionSummary` with `active`, `lastResult` restricted to `{requestId,status}`, optional `recoveryWarning` and `statusUpdatedAt`. `RequestState` adds optional `phase: preparing | generating | tool | compacting | subagent` and public `toolName`. Reserve starts preparing; actual model invocation sets generating; tool start/end sets tool/preparing. Stopping takes precedence over phase. Update status time on real transitions, not every token. After restart use persisted results/recovery warnings, never invent a running request. Activity uses a native-leaf-keyed metadata projection cache; repeated polling must not call `get()` and materialize every message. Return fresh DTOs without paths, full messages, tool arguments, instruction changes or resource contents. This is local-user navigation visibility, not cross-workspace model access or a full Run contract.

### Workspace storage and migration

`workspace-index.json` contains `schemaVersion:1`, `defaultWorkspaceId`, workspace entries and `sessionBindings`. Workspace IDs are UUIDs; names are trimmed, nonempty and at most 60 characters. Paths derive from IDs. Every workspace has the two registered source IDs and `synthesis`/`review` Skill IDs. New workspaces receive empty `AGENTS.md` and source fixture copies.

Persist complete indexes through a single-process mutex and same-directory temporary file, fsync and rename. Revalidate the current index before replacing it. Reject duplicate JSON keys, invalid schemas, duplicate workspaces, unknown bindings and unexpected disk changes. `.workspace-initialized` distinguishes initialization from index loss; missing/damaged indexes or markers must not silently recreate ownership.

Create a native empty session file before committing its workspace binding; publish only after both succeed. These are separate file commits. Unbound files remain on disk and are not automatically assigned to the default workspace. Native session files remain the message authority. Persist Pi's native header for empty sessions and reopen through SessionManager; never replay user messages or tool commands to reconstruct history.

Existing native files without an index require explicit migration. Back up the whole stopped directory before changes. `migrations/workspace-v1.json` fixes the original inventory, backup location and default workspace ID. Its `prepared`, `indexed` and `completed` stages support retry with matching inventories/indexes; interrupted migration blocks normal startup. Preserve native IDs, filenames and contents, including unrecognized files. Completed imports are not rescanned into new bindings. Rollback uses a separate restored backup directory; never open the upgraded active directory with the old application.

### Request resources and tools

Reserve a request and its bound workspace before any asynchronous work. Snapshot instructions, source bodies and Skill bodies under the workspace resource mutex; preparation and lock waiting count toward an explicitly configured whole-request deadline. Keep that snapshot fixed through every model/tool iteration. `source_read` and `skill_read` consume it; `instructions_read` deliberately reads current disk content for CAS, without changing the loaded system rules.

Create a new AgentSession per request using the existing SessionManager. Disable builtin tools and external context/Skill/extension/prompt discovery. Enable Pi default automatic compaction and native transient retry (at most 3 extra attempts; provider retries 0). Use `agentsFilesOverride` to inject only controlled common/workspace instructions. Common methods precede workspace refinements; file text cannot increase executable permissions. Explicitly advertise the fixed Skill catalog and bridge it through `skill_read`; Pi's builtin Skill discovery does not supply this bridge when `read`/`bash` are disabled.

`openSession` also captures a transient `<host_request_instructions>` reminder containing the same common/workspace `{fileId, hash, content}` snapshot and explicit empty/missing-file semantics. Inside the OpenAI adapter's `onPayload`, copy the final wire-message array and insert one system reminder immediately before the latest user message, retaining the initial system message. Do not mutate Pi's context, native messages, or any user text. Each tool-loop call starts from the original context and inserts exactly one copy of the same captured reminder; a same-request write does not refresh it. The next request captures the updated or emptied file. This reinforces current rules over stale historical promises/tool results; real-model compliance still requires separate verification.

| Logical / wire tool | Parameters | Effect |
| --- | --- | --- |
| `source.list` / `source_list` | `{}` | Current request's source metadata/hash |
| `source.read` / `source_read` | `{id}` | Registered source body/hash from the snapshot |
| `instructions.read` / `instructions_read` | `{fileId}` | Current common/workspace file and hash |
| `instructions.update` / `instructions_update` | `{fileId, content, expectedHash}` | CAS update of this session's workspace file only |
| `skill.read` / `skill_read` | `{id}` | Registered Skill body/version/hash from the snapshot |

Tools use strict schemas, serial execution, cancellation checks and observational attempt counting; there is no default cumulative tool/model attempt cap. Host tool definitions may declare timeoutMs. Wait for cancellation settlement before returning a timeout; unknown file effects stop the request and require inspection. Natural language edit intent is understood by the model. Prompts require explicit user intent, but this is not a programmatic proof of intent or complete prompt-injection protection. Real source-induced write attempts must be tested.

`berserk.request-resources.v1`, `berserk.skill-read.v1`, `berserk.instructions-updated.v1` and `berserk.request-result.v1` are native custom entries, not model messages or a business operation ledger. Decode them in `src/pi/history-evidence.ts`. Validate known fields/versions, request/workspace ownership, text hashes and registered Skill versions; reject tool evidence attached after a request terminal result. Invalid evidence leaves native files untouched and prevents exposing/resuming that session. Legacy requests remain explicitly unavailable. Result entries can exist without resource entries for preparation failures or early cancellation.

### Native compaction and persistence

Subscribe before prompt. A per-request synchronous compaction_start/end marker distinguishes native summary streams from replies, independent of browser visibility. Both use the controlled stream for cancellation, sanitized errors and usage; summary streams keep native prompts and maxTokens and receive no host AGENTS reminder. Reply streams keep the current fixed snapshot. Do not call prompt again for retry/overflow, manually append compaction, or inject a custom summary format.

Pi owns trigger/cut points, recent token retention and one overflow recovery. Its native summary may truncate each tool result to 2,000 characters; disk and public history stay complete. Multiple compactions in one request associate by new entry ID, never summary text. `RequestResult` optionally adds compactionIds/compactions/usageSummary; `SessionSnapshot` adds latestCompaction. Missing usage is unknown, not zero cost. Native estimates and actual provider usage remain distinct.

Default summaries must contain text and no tool calls; empty/truncated/final failed summaries cannot continue model/tool work. Latch admission closed before full `AgentSession.abort()`, not only agent.abort(); never await self-idle inside a callback. Temporary overflow errors are not terminal. Cancelled writes or summaries already committed remain. Guard native append methods: failed persistence poisons the manager and forbids finally from appending more; reload strict disk history before reuse. Validate every JSONL line and compaction retention ancestry before Pi can silently skip bad input. Incomplete requests still require recovery even if a summary exists.

`context.compaction_started/completed` are session/request-scoped SSE events. Completed carries the actual saved entry metadata. Error/cancel ends through the normal single terminal result. `getCompaction` rejects foreign IDs and does not invoke the model.

### Single readonly subagents

`subagent({agent, task})` is a normal serial parent tool. Reject additional authority fields and unknown roles. Each call creates an independent public Pi AgentSession/SessionManager; reuse the same session construction, controlled stream, native compaction/retry and cancellation implementation. Do not call public `start()` recursively, copy parent messages into the child, or modify Pi internals. Child input is the explicit task, selected role and fixed parent resource/AGENTS snapshot. Only the final child text/error is returned to the parent tool loop; child original messages and summaries are not parent context.

`src/pi/roles.ts` loads controlled `fixtures/agents/*.md` once per parent request using public Pi frontmatter parsing. Require unique safe name, nonempty description/body and explicit tools; allow only source_list/source_read/instructions_read/skill_read. Reject duplicate/unknown tools, fields including model, missing/empty directory, symlinks, invalid UTF-8 and files above 64 KiB. `tools: []` means no tools. Freeze role bodies/tool arrays; edits, additions and deletions take effect next request. Preset analyst has three resource/instruction tools; reviewer also has skill_read. Runtime registration enforces the selected allowlist; child instructions_read returns the fixed snapshot with editable=false, not current disk content. No writes, shell, external discovery or recursive subagent tool.

Each parent has at most one active child, with no cumulative delegation cap. The parent's optional deadline includes child work; abort must settle the child before parent terminal publication. onUpdate/tool_execution_update projects public child phases. Child failure, empty/truncated output and cancellation are explicit; afterToolCall maps failure to native isError. Do not retry the whole child task automatically. Child compaction/retry and usage are independent; RequestResult.usageSummary remains parent-only and subagentUsage aggregates child usage once, retaining unknown usage.

Save children under `LAB_DATA_DIR/subagents/<parentSessionId>/<subagentId>/`; never bind them as ordinary workspace sessions. Parent `berserk.subagent-start.v1` precedes child model work; child origin records the same role/configuration/resource ownership. Save child terminal evidence and parent `berserk.subagent-result.v1` before returning the tool result. Validate IDs, role/prompt hashes, effective tools, fixed readonly resources, terminal text/error, usage, and parent native tool result consistency. There is no cross-file transaction. Persistence failure blocks further parent work; incomplete records become interrupted without replay. Invalid parent records remain rejected. Missing/corrupt/inconsistent child files preserve a valid parent for reading, block continuation with recoveryWarning and project affected child cards as interrupted without an unverified result. Keep original files unchanged.

Public `SubagentSummary` and `subagent.updated` expose IDs, role/description/task, phase/status, final result/error and timestamps, never raw Pi entries, filesystem paths or role hashes. Snapshots merge persisted and active children by subagentId. Activity remains parent-only metadata; child completion is not parent completion. Integration tests in roles.test.ts, subagent-sdk.test.ts and subagent.test.ts cover loader/SDK/lifecycle/persistence boundaries; explicit probe:subagent uses isolated data for real-model validation.

### Controlled files and CAS

Check every controlled directory, reject symlinks/nonregular files, open leaves with `O_NOFOLLOW` and verify file identity. Decode valid UTF-8 without stripping BOM or normalizing line endings; SHA-256 is over actual UTF-8 bytes. Limits: common instructions 4 KiB, workspace instructions 16 KiB, each Skill 16 KiB, each source 32 KiB. Missing instruction leaves mean empty content with `hash:null`; unreadable/invalid/oversized files are errors, not empty fallbacks. An existing empty file has the SHA-256 of empty bytes.

In the workspace mutex: check cancellation and writable scope, read current bytes, return `unchanged` if content already matches, otherwise compare `expectedHash`, write/fsync a temporary file, check cancellation again, then rename. Permission checks precede the unchanged shortcut. A stale hash cannot overwrite different content. Return `{fileId:'workspace', status:'updated'|'unchanged', previousHash, hash, effectiveFrom:'next_request'}`.

Rename is the effect boundary. Cancellation observed before rename prevents the write; cancellation afterward does not undo it. Settle writes and inspect actual file state on ambiguous failures; never use a timeout `Promise.race` that leaves a write running. File effects and native evidence are separate commits. `instructionChanges` and `instructionOutcomeUncertain` must report saved effects or the need to read current content, including failed/cancelled requests. Do not automatically retry an uncertain write.

### Configuration and execution limits

`LLM_API_KEY` is server-only. Environment configuration comes from ignored `.env.local`; an optional controlled `LAB_DATA_DIR/model-settings.json` overrides model/provider/endpoint/key after a Web settings save. Defaults: provider `deepseek`, model `deepseek-flash`, HTTPS `LLM_BASE_URL`, thinking disabled, `LAB_DATA_DIR=.local`, `PORT=4310`. Reject endpoint credentials, query strings and fragments. Bind only to `127.0.0.1` and enforce the local Host/Origin allowlist.

`LLM_HTTP_IDLE_TIMEOUT_MS` defaults to 300000 (0 disables); host HTTP response bytes reset this timer through the public fetch option, including SSE heartbeats; fake runtime tests may use synthetic events. High-level text deltas alone are not transport progress. `LLM_REQUEST_TIMEOUT_MS` is optional and maps to provider timeoutMs. `AGENT_RUN_TIMEOUT_MS` defaults to 0 (no total deadline), with a positive value covering every phase from synchronous acceptance. Validate timer values as safe integers ≤2147483647. Old REQUEST_TIMEOUT_MS/MAX_TOOL_CALLS/MAX_OUTPUT_TOKENS only warn by key name and are ignored; do not rewrite environment files. There is no default tool/model count cap. Public limits use null for absent total/request limits, never misleading zero-call labels. Sanitize provider errors before Pi persists them or the browser receives them. Zero placeholder SDK costs are not evidence of free usage.

### Persistent model settings

GET `/api/settings/model` projects identity/configured/version/source, `contextWindow`, `maxOutputTokens`, `compactionReserveTokens`, `compactionKeepRecentTokens`, `contextSource`, `outputSource`, and `contextReady`; never return the key or a key-derived hash. PUT accepts `{provider, model, baseUrl, expectedVersion, apiKey?, contextWindow?, maxOutputTokens?, compactionReserveTokens?, compactionKeepRecentTokens?}` with strict integer fields; no null values. Read v1, save v2. Same-identity omitted values remain; identity changes recalculate rather than inherit. Persisted v2 wins; environment C/M can fill v1 only for the exact matching identity. Unknown C/M remains null and blocks start before reservation/history writes. Require 8192≤C≤2000000, positive M/R/K, M≤C and R+K<C (not M≤R). Verified deepseek/deepseek-flash at official root or /v1 endpoint receives C=1000000, M=393216; other identities have no assumed preset. Normalize HTTPS endpoints and reject URL credentials/query/fragment. Empty key retains the existing secret only for the same provider and normalized endpoint; changed destinations require an explicit new key.

`ModelSettingsStore` reads controlled regular files, rejects symlinks/invalid persisted state, and writes mode-0600 temporary files followed by atomic rename. Persist a random version independent of the key. Preserve environment files. Build the candidate runtime before saving; only publish config/runtime after successful persistence, with no await between commit and publication. Never mutate caller-owned injected configuration.

A synchronous PiLab guard excludes configuration updates while any session is active and excludes request starts/concurrent saves during a settings write. Busy returns `MODEL_SETTINGS_BUSY`; stale versions return `MODEL_SETTINGS_CONFLICT`; absent/new-destination keys return `MODEL_API_KEY_REQUIRED`. Failed saves retain the active configuration. New requests and restarts use saved settings; in-flight requests are never retargeted. This remains a single-process, single-active-provider service using the current compatible protocol.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Unknown session / workspace / resource | 404 `SESSION_NOT_FOUND` / `WORKSPACE_NOT_FOUND` / `RESOURCE_NOT_FOUND` |
| Concurrent send / stale cancellation | 409 `SESSION_BUSY` / `STALE_REQUEST` |
| Incomplete restored protocol history | 409 `RECOVERY_REQUIRED`; never auto-resume |
| Settings save during active work / request start during save | 409 `MODEL_SETTINGS_BUSY`, no partial runtime change |
| Stale settings version / new destination without new key | 409 `MODEL_SETTINGS_CONFLICT` / 400 `MODEL_API_KEY_REQUIRED` |
| Invalid settings file / persistence failure | 503 `MODEL_SETTINGS_INVALID` / `MODEL_SETTINGS_SAVE_FAILED`; never silently fall back or expose secrets |
| Unknown model capacity/output | 400 `MODEL_CONTEXT_REQUIRED`; no occupied request or persisted input |
| Foreign/missing compaction ID | 404 `COMPACTION_NOT_FOUND`; no model call |
| Missing key | 503 `MODEL_NOT_CONFIGURED`; no occupied request or model call |
| Invalid/extra/oversized request fields | 400/413 `INVALID_INPUT` |
| Untrusted Host/Origin | 403, before model work |
| Stale instruction hash / readonly write | 409 `INSTRUCTION_CONFLICT` / 403 `RESOURCE_READ_ONLY` |
| Invalid index/resource state or unsupported evidence | Reject with `RESOURCE_STATE_INVALID`, or retain unusable native file without loading it |
| Oversized / unreadable resource | 413 `RESOURCE_TOO_LARGE` / 503 `RESOURCE_LOAD_FAILED` |
| Unconfirmed instruction write | `INSTRUCTION_OUTCOME_UNCERTAIN`; read current state, no implicit resend |
| Preflight failure after SSE acceptance | `response.failed`; no model call and no invented persisted user message |
| Explicit timeout / truncated output / final compaction failure | Explicit failed result; release active state only after settlement |
| Client disconnect | Server work continues; GET observes state without replaying commands |
| Global activity after restart | No invented active worker; persisted terminal/recovery state remains visible |

## 5. Good / Base / Bad Cases

Good: edit workspace A's instruction, continue an existing A session with new rules, preserve its original history, and leave another A session's messages and workspace B's resources isolated. Read a Skill/source and verify its actual result reaches the next model call.

Base: ordinary conversation needs no tool. A missing instruction file contributes no workspace rules. A legacy completed conversation can continue after backed-up migration without duplicate messages.

Bad: follow a caller path, discover developer-machine AGENTS/Skills, let an old tool result override current file rules, report cancelled writes as rolled back, invent old loaded text from current files, or rebuild a lost index by assigning every native file to the default workspace.

## 6. Tests Required

Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e` and `npm run build` as applicable. Lint enforces Pi/browser dependency boundaries.

Deterministic tests must use isolated data directories and real Pi sessions with the provider stream or HTTP transport replaced. Assert final provider input, not only loader return values: current rules, fixed intra-request snapshots, tool results, native history exactly once, same/cross-workspace isolation, restart resource/Skill evidence and actual instruction effects. Cover invalid tool parameters, sustained execution beyond old experimental caps, abort races, preflight failures without model calls, malformed evidence and secret sanitization.

`tests/pi/provider-payload.test.ts` exercises the actual provider adapter with fake HTTP SSE. Assert that a tool write leaves both the system rules and transient reminder unchanged for the current request, a later request receives new/empty rules, the reminder occurs exactly once as a system message immediately before the current user, all user payloads remain original, and no reminder or extra user message appears in native history. Testing the loader alone cannot detect provider conversion or accidental persistence bugs.

Resource/migration tests cover BOM/UTF-8 byte hashes, missing vs empty, size limits, leaf/ancestor symlinks, readonly unchanged calls, simultaneous CAS, cancellation before/after rename, disk/readback failure, duplicate index keys, backup failure and interruption at prepared/indexed stages. Preserve old empty/completed/incomplete/corrupt files and reject unbound auto-import.

Model-settings tests assert actual adapter endpoint/model/Authorization before and after a save and restart, native-history continuity without secrets, environment-object immutability, redacted GET/PUT, normalized endpoint key retention, active/save mutual exclusion, strict JSON types (disable AJV coercion), 0600 permissions, file corruption/symlinks, and unchanged runtime after failed persistence.

Activity tests cover multiple workspaces, real model/tool phases, stopping, success/failure/cancellation, restart/recovery, explicit field projection and caching. Assert that repeated unchanged polls do not traverse native histories and that GET does not invoke the provider.

`probe:subagent`, `probe:compaction`, `probe:live` and `probe:workspace` are explicit real-model validation. Current prompt presence and deterministic green tests do not prove semantic compliance: test rule replacement/deletion, agent editing, malicious source content, Skill use and restarted continuation with the actual configured model. Never mark these passed based on a fake or a tool trace alone.

Native-compaction tests cover trigger locations, retained boundaries, split summaries, complete raw history, current/deleted AGENTS, once-only overflow recovery, retry classification, full abort, poisoned writes and restart. Assert >8 tools, >32 model attempts and >120 seconds can complete by default, progressing versus stalled streams differ, and native summary output >2048 is preserved.

## 7. Wrong vs Correct

Wrong: mutate a cached session's rules midway through a request or replay native messages to create a new AgentSession.

Correct: reuse its SessionManager, construct a fresh request-scoped loader/tools/session and dispose after settlement; preserve the captured snapshot across all model calls.

Wrong: append the current-rule reminder through `session.prompt`, change native user messages or accumulate reminders on every model call.

Correct: derive a provider-only wire-message array and insert one request-scoped system reminder immediately before the current user message; leave persisted history intact.

Wrong: GET the latest instruction after a conflict, silently rebase the old draft and automatically retry PUT.

Correct: return the conflict without writing; require the UI's explicit manual merge and the viewed version hash.

Wrong: race a file write against cancellation and report that cancellation means no changes occurred.

Correct: observe cancellation before rename, settle any issued rename, retain actual saved effects and expose uncertainty for readback.

Wrong: keep using an old API key after the browser changes the destination, or switch the runtime before persistence succeeds.

Correct: require a new key for changed provider/endpoint, reserve the update against starts, then atomically publish runtime after the file commit.

Wrong: treat every stream as a normal reply, overwrite summary maxTokens, or inject AGENTS into default summary input.

Correct: distinguish purpose using native compaction lifecycle; preserve default summary prompts/limits and add the fixed reminder only to reply payloads.
