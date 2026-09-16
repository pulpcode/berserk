# Harness Lab Backend Contract

## 1. Scope / Trigger

Read before changing `experiments/harness-lab` Pi integration, workspace/resource storage, API, configuration, migration or native history. The implementation includes W01-1 conversation behavior and W01-2/S2a workspaces, file instructions and fixed Skills. It does not provide multi-user authorization, cross-session retrieval, database transactions, persistent Runs, business approvals, compaction or subagents.

The local user can access every workspace. Isolation means that each session's model inputs and tools use its fixed workspace; it is not an account authorization boundary. One service process owns a data directory. Do not run multiple processes against the same `LAB_DATA_DIR`.

## 2. Signatures

- `PiLab.create(config, runtime?)`: construct the concrete Pi integration; the optional runtime is for deterministic integration tests.
- `createSession(workspaceId?)`, `list(workspaceId?)`, `get(sessionId)`: default omitted workspace IDs to the default workspace. A session's workspace cannot change.
- `start(sessionId, text) -> {requestId, run(listener)}`: reserve the session synchronously before asynchronous preparation.
- `cancel(sessionId, requestId)`: reject stale IDs and retain the active marker until execution settles.
- `getRequestResources(sessionId, requestId)`: return that session's historical resource record or explicit `unavailable`; never substitute current files.
- `ResourceService.snapshot(workspaceId, signal?)`, `readInstruction(workspaceId, fileId)`, `updateInstruction(workspaceId, fileId, content, expectedHash, signal?)`, `readSkill(workspaceId, skillId)`.

| HTTP endpoint | Input / result |
| --- | --- |
| `GET /api/info` | Model/configuration/limits; no global source catalog or secrets |
| `GET /api/workspaces` | `{defaultWorkspaceId, workspaces}` |
| `POST /api/workspaces` | `{name}` → 201 Workspace |
| `GET /api/sessions?workspaceId=…` | Summaries from that workspace; omission uses default |
| `POST /api/sessions` | Optional `{workspaceId}` → SessionSnapshot; omission uses default |
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

### Workspace storage and migration

`workspace-index.json` contains `schemaVersion:1`, `defaultWorkspaceId`, workspace entries and `sessionBindings`. Workspace IDs are UUIDs; names are trimmed, nonempty and at most 60 characters. Paths derive from IDs. Every workspace has the two registered source IDs and `synthesis`/`review` Skill IDs. New workspaces receive empty `AGENTS.md` and source fixture copies.

Persist complete indexes through a single-process mutex and same-directory temporary file, fsync and rename. Revalidate the current index before replacing it. Reject duplicate JSON keys, invalid schemas, duplicate workspaces, unknown bindings and unexpected disk changes. `.workspace-initialized` distinguishes initialization from index loss; missing/damaged indexes or markers must not silently recreate ownership.

Create a native empty session file before committing its workspace binding; publish only after both succeed. These are separate file commits. Unbound files remain on disk and are not automatically assigned to the default workspace. Native session files remain the message authority. Persist Pi's native header for empty sessions and reopen through SessionManager; never replay user messages or tool commands to reconstruct history.

Existing native files without an index require explicit migration. Back up the whole stopped directory before changes. `migrations/workspace-v1.json` fixes the original inventory, backup location and default workspace ID. Its `prepared`, `indexed` and `completed` stages support retry with matching inventories/indexes; interrupted migration blocks normal startup. Preserve native IDs, filenames and contents, including unrecognized files. Completed imports are not rescanned into new bindings. Rollback uses a separate restored backup directory; never open the upgraded active directory with the old application.

### Request resources and tools

Reserve a request and its bound workspace before any asynchronous work. Snapshot instructions, source bodies and Skill bodies under the workspace resource mutex; preparation and lock waiting count toward the request deadline. Keep that snapshot fixed through every model/tool iteration. `source_read` and `skill_read` consume it; `instructions_read` deliberately reads current disk content for CAS, without changing the loaded system rules.

Create a new AgentSession per request using the existing SessionManager. Disable builtin tools, external context/Skill/extension/prompt discovery, retries and compaction. Use `agentsFilesOverride` to inject only controlled common/workspace instructions. Common methods precede workspace refinements; file text cannot increase executable permissions. Explicitly advertise the fixed Skill catalog and bridge it through `skill_read`; Pi's builtin Skill discovery does not supply this bridge when `read`/`bash` are disabled.

`openSession` also captures a transient `<host_request_instructions>` reminder containing the same common/workspace `{fileId, hash, content}` snapshot and explicit empty/missing-file semantics. Inside the OpenAI adapter's `onPayload`, copy the final wire-message array and insert one system reminder immediately before the latest user message, retaining the initial system message. Do not mutate Pi's context, native messages, or any user text. Each tool-loop call starts from the original context and inserts exactly one copy of the same captured reminder; a same-request write does not refresh it. The next request captures the updated or emptied file. This reinforces current rules over stale historical promises/tool results; real-model compliance still requires separate verification.

| Logical / wire tool | Parameters | Effect |
| --- | --- | --- |
| `source.list` / `source_list` | `{}` | Current request's source metadata/hash |
| `source.read` / `source_read` | `{id}` | Registered source body/hash from the snapshot |
| `instructions.read` / `instructions_read` | `{fileId}` | Current common/workspace file and hash |
| `instructions.update` / `instructions_update` | `{fileId, content, expectedHash}` | CAS update of this session's workspace file only |
| `skill.read` / `skill_read` | `{id}` | Registered Skill body/version/hash from the snapshot |

Tools use strict schemas, serial execution, cancellation checks and attempt counting; failed arguments/tools also consume budget. Natural language edit intent is understood by the model. Prompts require explicit user intent, but this is not a programmatic proof of intent or complete prompt-injection protection. Real source-induced write attempts must be tested.

`berserk.request-resources.v1`, `berserk.skill-read.v1`, `berserk.instructions-updated.v1` and `berserk.request-result.v1` are native custom entries, not model messages or a business operation ledger. Decode them in `src/pi/history-evidence.ts`. Validate known fields/versions, request/workspace ownership, text hashes and registered Skill versions; reject tool evidence attached after a request terminal result. Invalid evidence leaves native files untouched and prevents exposing/resuming that session. Legacy requests remain explicitly unavailable. Result entries can exist without resource entries for preparation failures or early cancellation.

### Controlled files and CAS

Check every controlled directory, reject symlinks/nonregular files, open leaves with `O_NOFOLLOW` and verify file identity. Decode valid UTF-8 without stripping BOM or normalizing line endings; SHA-256 is over actual UTF-8 bytes. Limits: common instructions 4 KiB, workspace instructions 16 KiB, each Skill 16 KiB, each source 32 KiB. Missing instruction leaves mean empty content with `hash:null`; unreadable/invalid/oversized files are errors, not empty fallbacks. An existing empty file has the SHA-256 of empty bytes.

In the workspace mutex: check cancellation and writable scope, read current bytes, return `unchanged` if content already matches, otherwise compare `expectedHash`, write/fsync a temporary file, check cancellation again, then rename. Permission checks precede the unchanged shortcut. A stale hash cannot overwrite different content. Return `{fileId:'workspace', status:'updated'|'unchanged', previousHash, hash, effectiveFrom:'next_request'}`.

Rename is the effect boundary. Cancellation observed before rename prevents the write; cancellation afterward does not undo it. Settle writes and inspect actual file state on ambiguous failures; never use a timeout `Promise.race` that leaves a write running. File effects and native evidence are separate commits. `instructionChanges` and `instructionOutcomeUncertain` must report saved effects or the need to read current content, including failed/cancelled requests. Do not automatically retry an uncertain write.

### Configuration and execution limits

`LLM_API_KEY` is server-only and comes from ignored `.env.local`. Defaults: provider `deepseek`, model `deepseek-flash`, HTTPS `LLM_BASE_URL`, thinking disabled, `LAB_DATA_DIR=.local`, `PORT=4310`. Reject endpoint credentials, query strings and fragments. Bind only to `127.0.0.1` and enforce the local Host/Origin allowlist.

`REQUEST_TIMEOUT_MS` defaults to 120000; `MAX_TOOL_CALLS` to 8; `MAX_OUTPUT_TOKENS` to 2048. Explicit valid environment overrides take precedence. Maximum model calls are `maxToolCalls + 1`; tools have a 5000 ms cancellation deadline. These bound one request, not total validation requests or monetary spend. Sanitize provider errors before Pi persists them or the browser receives them. Zero placeholder SDK costs are not evidence of free usage.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Unknown session / workspace / resource | 404 `SESSION_NOT_FOUND` / `WORKSPACE_NOT_FOUND` / `RESOURCE_NOT_FOUND` |
| Concurrent send / stale cancellation | 409 `SESSION_BUSY` / `STALE_REQUEST` |
| Incomplete restored protocol history | 409 `RECOVERY_REQUIRED`; never auto-resume |
| Missing key | 503 `MODEL_NOT_CONFIGURED`; no occupied request or model call |
| Invalid/extra/oversized request fields | 400/413 `INVALID_INPUT` |
| Untrusted Host/Origin | 403, before model work |
| Stale instruction hash / readonly write | 409 `INSTRUCTION_CONFLICT` / 403 `RESOURCE_READ_ONLY` |
| Invalid index/resource state or unsupported evidence | Reject with `RESOURCE_STATE_INVALID`, or retain unusable native file without loading it |
| Oversized / unreadable resource | 413 `RESOURCE_TOO_LARGE` / 503 `RESOURCE_LOAD_FAILED` |
| Unconfirmed instruction write | `INSTRUCTION_OUTCOME_UNCERTAIN`; read current state, no implicit resend |
| Preflight failure after SSE acceptance | `response.failed`; no model call and no invented persisted user message |
| Timeout / attempt limit / truncated output | Explicit failed result; release active state only after settlement |
| Client disconnect | Server work continues; GET observes state without replaying commands |

## 5. Good / Base / Bad Cases

Good: edit workspace A's instruction, continue an existing A session with new rules, preserve its original history, and leave another A session's messages and workspace B's resources isolated. Read a Skill/source and verify its actual result reaches the next model call.

Base: ordinary conversation needs no tool. A missing instruction file contributes no workspace rules. A legacy completed conversation can continue after backed-up migration without duplicate messages.

Bad: follow a caller path, discover developer-machine AGENTS/Skills, let an old tool result override current file rules, report cancelled writes as rolled back, invent old loaded text from current files, or rebuild a lost index by assigning every native file to the default workspace.

## 6. Tests Required

Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e` and `npm run build` as applicable. Lint enforces Pi/browser dependency boundaries.

Deterministic tests must use isolated data directories and real Pi sessions with the provider stream or HTTP transport replaced. Assert final provider input, not only loader return values: current rules, fixed intra-request snapshots, tool results, native history exactly once, same/cross-workspace isolation, restart resource/Skill evidence and actual instruction effects. Cover invalid tool parameters/attempt caps, abort races, preflight failures without model calls, malformed evidence and secret sanitization.

`tests/pi/provider-payload.test.ts` exercises the actual provider adapter with fake HTTP SSE. Assert that a tool write leaves both the system rules and transient reminder unchanged for the current request, a later request receives new/empty rules, the reminder occurs exactly once as a system message immediately before the current user, all user payloads remain original, and no reminder or extra user message appears in native history. Testing the loader alone cannot detect provider conversion or accidental persistence bugs.

Resource/migration tests cover BOM/UTF-8 byte hashes, missing vs empty, size limits, leaf/ancestor symlinks, readonly unchanged calls, simultaneous CAS, cancellation before/after rename, disk/readback failure, duplicate index keys, backup failure and interruption at prepared/indexed stages. Preserve old empty/completed/incomplete/corrupt files and reject unbound auto-import.

`probe:live` and `probe:workspace` are explicit real-model validation. Current prompt presence and deterministic green tests do not prove semantic compliance: test rule replacement/deletion, agent editing, malicious source content, Skill use and restarted continuation with the actual configured model. Never mark these passed based on a fake or a tool trace alone.

## 7. Wrong vs Correct

Wrong: mutate a cached session's rules midway through a request or replay native messages to create a new AgentSession.

Correct: reuse its SessionManager, construct a fresh request-scoped loader/tools/session and dispose after settlement; preserve the captured snapshot across all model calls.

Wrong: append the current-rule reminder through `session.prompt`, change native user messages or accumulate reminders on every model call.

Correct: derive a provider-only wire-message array and insert one request-scoped system reminder immediately before the current user message; leave persisted history intact.

Wrong: GET the latest instruction after a conflict, silently rebase the old draft and automatically retry PUT.

Correct: return the conflict without writing; require the UI's explicit manual merge and the viewed version hash.

Wrong: race a file write against cancellation and report that cancellation means no changes occurred.

Correct: observe cancellation before rename, settle any issued rename, retain actual saved effects and expose uncertainty for readback.
