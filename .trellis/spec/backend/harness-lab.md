# Harness Lab Backend Contract

## 1. Scope / Trigger

W01-1 lives in `experiments/harness-lab`. This spec covers the first local, single-subject web conversation increment, not the later persistent Run or migration system. Read before editing Pi integration, API, configuration or history.

## 2. Signatures

- `PiLab.create(config, runtime?)`: the runtime argument is for deterministic Pi integration tests.
- `createSession()` / `list()` / `get(id)`: native session creation and public projection.
- `start(id, text) -> {requestId, run(listener)}`: reserves the session synchronously before async initialization.
- `cancel(id, requestId)`: rejects stale requests and keeps the active marker until execution settles.
- HTTP: `GET /api/info`, `GET/POST /api/sessions`, `GET /api/sessions/:id`, `POST /api/sessions/:id/messages`, `POST /api/sessions/:id/cancel`.

## 3. Contracts

`src/contracts/index.ts` owns public messages, snapshots and SSE events. Messages submit `{text}`; cancellation submits `{requestId}`. Each SSE event carries both sessionId and requestId; terminal events include an authoritative snapshot. API errors use `{error:{code,message}}`.

Pi packages and JSONL interpretation stay inside `src/pi` and corresponding integration tests. The server imports the concrete Pi module through its public methods; the browser only imports contracts. Do not add a generic adapter until there is a tested need in S4.

Native history lives in `.local/sessions/`, with IDs mapped server-side to controlled files. Never accept a filesystem path from the client. Empty sessions persist Pi's native header then reopen using SessionManager. Completed sessions reload without replaying commands. Incomplete protocol histories must not auto-resume.

`LLM_API_KEY` is server-only, read from ignored `.env.local`. Current default: DeepSeek `deepseek-flash`, explicit thinking disabled, HTTPS endpoint. Disable default tools, extension/skill/prompt/context discovery, compaction and retries. The sole logical tool `source.read` uses wire name `source_read` because the provider disallows periods. Fixture IDs map to fixed files in `src/tools/sources.ts`; tool data access itself has no Pi dependency.

Defaults: total request timeout 90000ms, max 4 tool executions and 5 model calls, max 2048 output tokens per model call. These are per-request execution boundaries, not a total live-probe quota or a monetary accounting system.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Unknown session | 404 SESSION_NOT_FOUND |
| Concurrent send or stale cancellation | 409 SESSION_BUSY / STALE_REQUEST |
| Unfinished restored history | 409 RECOVERY_REQUIRED |
| Missing key | 503 MODEL_NOT_CONFIGURED, no model call |
| Invalid or oversized body | 400/413 INVALID_INPUT |
| Untrusted Origin or Host | 403; bind listener only to 127.0.0.1 |
| Provider failure | Sanitize stream creation and consumption before Pi persists messages; never forward raw credential-bearing exception |
| Timeout / tool limit / output truncation | Explicit failed result; release active marker after settlement |
| Client disconnect | Server work continues; GET retrieves history/status; never implicitly resend |

## 5. Good / Base / Bad Cases

Good: read a fixture, consume the real tool result, then answer a followup from the same native history.
Base: answer an ordinary question with no tool use.
Bad: interpret arbitrary file paths, expose default bash, share messages between sessions, mark an unfinished response successful, or clear busy before abort settles.

## 6. Tests Required

`npm test` exercises real Pi sessions with only the provider stream replaced. Assert actual tool result reaches the next model call, isolated input contexts, native restart reload, cancel races, caps, malformed/incomplete files, and sanitized failures. Server tests cover schemas, origin, SSE and missing credentials. `npm run lint` enforces the dependency boundary. `probe:live` is explicit and must never be replaced by a fake while reporting real-model acceptance.

## 7. Wrong vs Correct

Wrong: create a second request while `abort()` is pending, or let the page parse JSONL.

Correct: reserve the request before async work; send cancellation to the current exact request; retain the marker until Pi settles; project public history only through `PiLab.get`.
