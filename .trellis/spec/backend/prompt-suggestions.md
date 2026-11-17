# Next Input Suggestions

## Scope / trigger and ownership

`src/pi/prompt-suggestion.ts` performs a bounded, independent completion through the session's captured `ModelRuntime`. `PiLab.promptSuggestion` owns authorization, source freshness, deduplication and cancellation. This is input assistance, not an Agent run: no tools, native history entries, resource loading, workspace writes, business mutations or changes to the main request's activity/result/usage.

The shared request/response lives in `contracts/prompt-suggestions.ts`. Web uses its decoder and the existing authenticated API client. Pi types and token estimation remain inside `src/pi`.

## Signatures and contracts

`POST /api/sessions/:id/prompt-suggestion` accepts only `{sourceRequestId, finalMessageId, expectedModelId}` and returns those source identifiers, the selected `modelId` and `text: string | null`. The testing seat prefix is unchanged. Reject extra body/query authority, transcripts, endpoints and credentials. `expectedModelId` is a comparison, not a configuration override; native message IDs are not necessarily UUIDs.

`PiLab.promptSuggestion(id: string, input: PromptSuggestionRequest, seatId?: string, options?: {signal: AbortSignal; userId?: string; assertIdentity?: () => void}): Promise<PromptSuggestionResponse>` captures the effective model internally. Request fields are required strings; `sourceRequestId` is a UUID, `finalMessageId` is 1–160 characters, and `expectedModelId` follows the existing model selector schema. Responses repeat the source IDs and use `modelId`, not `expectedModelId`. No new environment keys, database fields or persisted events are introduced.

## Admission and cancellation

Use current workspace identity, seat/account ownership, task writability, expert availability and the existing Origin/CSRF/view guards. Independent administrators retain their own private scope. History readability alone does not authorize predictions for archived/ended tasks or revoked identities. The latest successful result must match the latest validated turn and its actual final message; legacy, failed, cancelled, interrupted, busy, reserved, recovering and pending-interaction/queue states cannot generate.

Capture profile/config/runtime/version and native leaf before awaiting. Recheck identity, scope, task/expert availability, current record, source, leaf, model/version and idle state after permit waiting and before returning text. Runtime profile updates, model selection, new sends, client disconnect and service close cancel pending predictions. They never cancel the formal Agent run. Listen for actual response closure/request abortion rather than the request body's normal close event.

Keep only one attempted source ID and optional in-flight controller/promise per session; do not cache generated text server-side. Concurrent tabs share this single-process attempt guard. Generation is best effort, without durable retry/recovery or a new job queue. When global model permits are enabled, predictions use them. Every admitted foreground start aborts pending auxiliary predictions/analyses across session records before acquiring permits, so another chat's auxiliary call cannot occupy the FIFO permit ahead of the user. Completed browser candidate caches remain intact. Predictions do not take task write leases, so archive/end may proceed and the final read check can reject the result.

## Model and context

The selected profile's effective thinking behavior, including unspecified legacy behavior, is retained. `providerPayload` shares only the pre-existing provider compatibility mapping with `controlledStream`; foreground host reminders and native compaction/retry behavior remain in their original paths.

Use one `completeSimple` call, no tools and no transport retry. Total budget is 20 seconds including permit waiting, output is at most `min(512, profile.maxOutputTokens)`, and a tighter configured provider timeout is respected. High-thinking models can exhaust this budget without final text; skip rather than silently changing models or thinking modes.

Build context from the authorized public projection: current real user message boundaries plus the evidenced final answer, at most six user/assistant text messages, and up to three short completed-tool facts. Omit thinking, tool arguments, diffs, raw logs, Skill/file bodies and additional business lookups. Bound serialized context to 6000 Unicode characters and the public Pi token estimate with output/system/safety allowance. Remove optional old text/tool excerpts before giving up; do not run another model to summarize. Mark omitted/truncated history explicitly.

Body-bearing native file/shell tools and capability authoring reads/methods/proposals contribute only name/status facts. Use actual registered names: `source_read`, `instructions_read` and `skill_read` use underscores. A dotted alias would fail to filter their bodies; cover registered names in tests.

Accept only successful nontruncated plain-text output, without tool calls, control characters or multiple lines, at most 256 Unicode characters. Empty text or `NONE` means no suggestion. Errors/timeouts/invalid output skip without changing the completed main result. Ordinary authorization errors retain their API meaning. No prompt, candidate, credential or whole provider response is logged.

## Browser lifecycle

`useChat` emits an ephemeral foreground-completion notification only from an authoritative successful SSE terminal frame. Opening/reloading history, polling, background completion, focus and keystrokes do not request suggestions. Generation also requires the selected visible chat, consistent snapshot/activity, an available model and no draft, attachment/reference, unresolved intake, interaction, recovery error or covering picker/dialog.

Use the existing textarea's placeholder and height behavior. Empty means exactly zero characters; spaces/newlines hide the candidate. Keep a login/seat-owned in-memory Map of session IDs to their latest candidate in the BusinessApp-level hook, which survives chat and business-view navigation. Entries carry source request/final IDs and text; model ID is not a cache key. Retain a valid candidate while typing and after accepting: deleting to empty restores it without a request. Input/composition during an in-flight request aborts it; clearing afterward never revives the late result or retries. Controller identity plus current source/scope checks prevent A→B→A and other late-response races.

Tab accepts the entire candidate only in the focused empty textarea outside IME/pickers, with the same freshness/empty-draft checks. It never sends. The composer has no extra accept button or visible Tab hint; the existing textarea title exposes full candidate text. Existing Enter, Shift+Enter, Shift+Tab, modifiers and arrows retain their behavior. Escape rejects the candidate permanently for that turn after picker handling. New sends/turns, explicit Escape and invalid business/rich-input facts delete the owning session entry. User/seat/login changes and disabling clear every entry and cancel pending requests; inactive test seats must clear their still-mounted stores too. Same-identity chat/business-view navigation and model changes preserve already generated entries; temporary composer unreadiness (including model saving) alone must not delete them. Composition temporarily hides an existing candidate and blocks acceptance. Temporary browser window/tab backgrounding also hides but retains an already received candidate; returning to the same valid source restores it without another request. Backgrounding cancels pending generation without retry or late-response revival. Do not call dismiss merely on visibilitychange; source/scope/authorization invalidation still applies while hidden.

On returning to a cached chat/view, hide its display projection until an authenticated existing GET session call confirms access and the same successful source reply. Reject changed turns and permission denials, cancel stale reads, and guard response identity/entry ownership before installing. Restoring cached text ignores the generation model; fresh generation still compares the selected model through the original contract. Restoration is a read, never an auxiliary completion. Candidates do not enter sessionStorage/localStorage or server storage; refreshing the page loses this Map. In-flight predictions retain their prior navigation/model/input cancellation policy and cannot populate a new identity.

The preference is enabled by default and stored only as a login/seat-scoped sessionStorage boolean with memory fallback. Candidates and attempt markers are not persisted. Normal seats, administrator personal chats and test mode have a switch; showing administrator general preferences does not expose business expert preferences or model management. Turning on waits for the next fresh turn.

## Validation and error matrix

| Condition | Result |
| --- | --- |
| Invalid schema, extra body/query authority | HTTP 400; no model call |
| Missing/revoked identity | HTTP 401; never return candidate text |
| Origin/CSRF or workspace permission failure | Existing HTTP 403 behavior |
| Foreign/invisible session | HTTP 404; no model call |
| Initially stale source/model, busy/recovering state, closed task or unavailable expert | HTTP 409; no model call |
| Same source already attempted | HTTP 200 with `text: null`; no retry |
| Timeout, abort, provider failure, invalid output or context overflow | HTTP 200 with `text: null`; completed main result unchanged |
| Source/leaf/model/task becomes stale while awaiting | Discard text; authorization errors 401/403/404 retain their meaning, other stale outcomes return null |

## Good / base / bad cases

- Good: the selected visible chat receives its own successful foreground final frame while the composer is empty; one independent completion produces an optional placeholder. Tab copies it to the ordinary draft without sending.
- Base: the provider returns `NONE`, or the user types during generation; the main answer stays complete, and clearing the draft does not regenerate.
- Bad: a historical assistant message, client-supplied transcript or delayed response from a previous scope is used to generate/restore a suggestion. Reject rather than guessing the source.

## Tests required

Use real public SDK serialization with fake HTTP for profile/thinking/limits/no-tools/reminder isolation. API tests cover source/owner/CSRF/revocation/archive guards, deduplication, cancellation, permit deadlines, settings changes and unchanged native history/files/activity/main usage. Browser tests cover the actual local PiLab/API with a deterministic provider, empty/hide/restore, acceptance/rejection, absence of redundant accept chrome, IME, picker priority, preferences, late responses, background/return restoration versus in-flight cancellation, per-session candidates across business views/models, access and newer-turn revalidation, user/seat reset, no browser storage, administrator scope and desktop layout.

These tests do not establish live prediction quality, provider latency, cache benefits or billing. Do not claim native OS IME/browser zoom was exercised when automation only dispatched composition events or used CSS scaling.

## Wrong vs correct

Never use `slice(-0)` for an exhausted history budget: it returns the whole array, breaking the six-message bound.

```ts
// Wrong: five current users plus final leave zero slots, but all old messages survive.
const older = history.slice(-(6 - essential.length));
// Correct: preserve real current-user boundaries; omit old messages when no slots remain.
const remaining = 6 - essential.length;
const older = remaining ? history.slice(-remaining) : [];
```
