# Conversation Work Activity

## 1. Scope / trigger

Read when changing the collapsible work panel, conversation activity analysis, its ephemeral cache or evidence projection. This is a read projection: WorkItem/action/submission records remain business authority, Pi owns history, and `session_links` remains unchanged. The feature does not resolve WORK-SESSION-001 or inject inferred work into foreground context.

`src/pi/work-activity.ts` builds bounded input, extracts committed facts and validates semantic output. PiLab owns current scope, versions, captured model, deduplication and cancellation. `src/contracts/work-activity.ts` is the shared runtime-checked contract; browser code does not import Pi/server modules.

## 2. Signatures

- `GET /api/sessions/:id/work-activity-analysis`: read-only `WorkActivityView`, never a model request.
- `POST` at the same path accepts exactly `{sourceRequestId, finalMessageId, version}`. Request IDs are UUIDs; native message IDs are nonempty strings up to 160 characters; version is a SHA-256 hex string. Existing scoped test-seat prefixes and formal auth/Origin/CSRF/view checks apply.
- `WorkActivityView`: `{version, source:{sourceRequestId,finalMessageId}|null, canAnalyze, reason?, linkedWorkItemId?, facts, evidence}`.
- `WorkActivityResponse`: `{version, source, status:'ready'|'unavailable', items, coverage:'complete'|'partial', reason?}`.
- `WorkActivityItem`: `{id, workItemId:string|null, title, description, relation:'processing'|'reference'|'uncertain', recency:'current'|'earlier', origin:'receipt'|'analysis', state?, evidenceIds}`.
- Evidence carries `{id,messageId,requestId,kind:'user'|'assistant'|'receipt',text}`. Its identity must refer to supplied original evidence, not model-generated identifiers.

No database migration, new environment variable, persisted inferred relation, background job or native history event is introduced. The standalone `scripts/probe-work-activity.ts` accepts `--out`, optional `--case` and optional existing `--settings-dir`; loading a configured default is read-only and never saves settings or application records.

## 3. Contracts

### Authorization and sources

Resolve identity, workspace, task and readable participant work on the server. A browser cannot supply candidates, transcript, credentials or authority. Restrict semantic candidates to the current conversation task; personal scopes have no business candidates. Overview capability does not grant participant access. Recheck current identity, workspace/task access, expert admission and idle eligible successful source before model admission and return, including failed/invalid completion paths.

GET can expose verified operations even if the turn later failed or semantic analysis is disabled. Only an original approved successful native business call joined to its committed action receipt is an operation fact. Ordinary reads/listing, an old formal session link and assistant claims are not such facts. Keep work state/title authoritative. Do not convert a semantic phrase about completion into a submitted/completed state.

The version covers the effective conversation evidence/state, task state and current authorized candidate identities/revisions/content. Selected model is deliberately absent so completed browser results survive model changes. Pending generation separately captures and checks the selected model and profile version. Response source and version must match the request and current state. Same-actor/source/version/model in-flight requests may share computation, but each awaiting caller must recheck its own identity and source before receiving it.

### Independent analysis

Use one `ModelRuntime.completeSimple` call without tools, transport retries, main usage updates or history mutations. Deadline is 20 seconds including permit waiting. Output limit is `min(2048, profile.maxOutputTokens)`; model thinking/provider compatibility follows the captured configuration. No fallback model or hidden thinking override is selected.

Bound recent conversation evidence, candidate count, serialized characters and public Pi token estimate. Preserve current user evidence; rank explicit IDs/titles and true operation references before other candidates. Candidate goals and dialogue excerpts may be bounded, but incomplete coverage must be marked. Never equate an omitted candidate with proof of no match. Do not include reasoning blocks, raw file/Skill/shell bodies, arbitrary native tool arguments or hidden credentials.

Model output is strict `{items:[{workItemId,title,description,relation,evidenceIds}]}` with at most eight items. Reject extra fields, unknown work/evidence IDs, duplicate work IDs/evidence, control characters, truncated outputs, tool calls and unsupported shapes. Host assigns IDs, title/state for matched work and recency. A processing judgment needs user or receipt evidence; current recency cannot be based on an assistant statement alone.

Work identity and activity certainty are separate. An explicit personal/self-directed activity can be `workItemId:null, relation:'processing'`. Use `uncertain` for unresolved activity/target ambiguity; use `reference` for incidental reference. Two files do not imply two WorkItems. The model's semantic correctness still needs evaluation beyond schema/membership checks.

Admitted foreground starts preempt pending work analyses and pending input predictions across records before acquiring shared model permits. Completed browser caches are unaffected. Model selection/config changes, invalidated source, client disconnect and service close cancel applicable in-flight work. Sharing a computation is not a durable result cache or retry queue.

### Browser and presentation

The panel starts collapsed; opening it loads actual work and authorized conversation state. Render three simultaneous sections without tabs: pending acceptance, current-conversation processing, and remaining seat todo. Pending acceptance and seat todo use existing business reads. Deduplicate seat todo against current processing strictly by formal work ID, never by title; removed/ignored inference returns an otherwise eligible formal item to seat todo. Assigned/submitted/completed items must not appear as current processing; keep pending acceptance and submitted-awaiting-review in their business sections, with submitted work in a bottom disclosure. Empty sections use counts instead of repeated paragraphs. Personal spaces show conversation activity only. Formal work cards group by workItemId, retaining both operation facts and interpretation; ignoring this analysis version removes only its inferred contribution.

`useWorkActivity` lives above business/chat navigation. Store per-session views/results/attempts/ignored items in an identity-owned JS Map. Do not persist them to localStorage/sessionStorage or server storage. Only the preference boolean uses the existing login/seat-scoped sessionStorage convention. Refresh loses analysis and permits lazy reconstruction from an eligible historical source, unlike input suggestions which only generate after a fresh foreground completion.

Analyze when the panel is visible and a valid new source/version is available. Typing, selection and composer blur are irrelevant. Closed panels defer new analysis; a valid in-flight call may finish into its original session cache across same-identity navigation. Repeated poll/focus events do not retry an attempted failed version; explicit retry may. Turning inference off cancels pending calls and removes inferred results, retaining authorized operation facts.

Same-identity navigation and model changes preserve valid completed cache entries. User/seat/login changes clear all entries and invalidate callbacks. New turn/source changes cancel old work and prevent a previous result from claiming to describe the new turn. Returning requires a fresh successful authorized GET before displaying cached content. A late POST may cache but must not publish past this navigation validation gate; read failures clear the gate. Authorization denials discard affected content and prevent pending responses from reviving it.

Track the observed active/background run identity per entry. A new run invalidates the previous projection once; subsequent activity updates from the same run must retain freshly authorized `canAnalyze:false` receipt facts. A failed/cancelled turn may have `source:null` and real receipts, so source ID or `canAnalyze` alone cannot detect its transition into a new run. Background reservation ID/status also participates in the refresh trigger. Capture the activity key before GET and require it still matches before applying either success or failure; never stamp an older response with a newer run identity after awaiting.

The work panel floats at the top-right without resizing chat or obscuring its composer. Use the user-specified two hollow circles and two horizontal strokes icon, distinct from the inbox icon. Omit the redundant panel title; begin with 待接收工作 and 正在处理, with the close control aligned beside the first section heading. Each work row uses a leading outline work/conversation icon and a regular-weight truncated title, with a single neutral rounded hover/focus background. Do not show trailing navigation chevrons; formal work rows remain clickable and inference-only ignore controls remain separate. hover titles contain description and authoritative status. Do not render evidence controls, inline descriptions, routine recognition explanations or preference switches in the panel. The recognition preference lives only in Settings → personal preferences. Suppress routine no-source/wait-for-turn/never-analyzed explanations and ignored-result acknowledgements. A zero waiting count needs no duplicate empty paragraph. Reuse the compact accessible LoadingIndicator for actual pending requests; keep actionable errors/retry, disabled preference status and partial coverage visible. A successfully empty result displays a zero section count; do not use it for a request still waiting or unavailable. Previous activity and reference/uncertain results use collapsed groups, separate from current work. Keep original evidence in the validated read contract; this UI simplification does not weaken server validation. Updates do not move input focus or auto-scroll the conversation. Desktop narrow panes and window resizing are in scope; no new mobile UI is required.

## 4. Validation and error matrix

| Condition | Behavior |
| --- | --- |
| Extra browser authority/transcript fields or invalid request shape | 400, no model call |
| Expired identity, forbidden scope, invisible session/work | Existing 401/403/404, no content fallback |
| Source/version stale or current state not eligible | 409, reread required |
| Timeout/provider failure/invalid JSON or unsupported result | `unavailable`, main conversation/business records unchanged |
| Incomplete candidate/history context | Explicit partial coverage, never fabricated certainty |
| Ordinary GET failure during restore | No unvalidated cached content; explicit failure/retry |
| Model off, failed final turn or no valid source | Authorized facts still usable; semantic analysis skipped |
| No actual work activity | Ready empty result, distinct from unavailable/never analyzed |

## 5. Good / base / bad cases

Good: one conversation drafts two independently assigned deliverables, shows two evidenced interpretations, and opens their original detail pages. A receipt and interpretation for one work share one card.

Base: an explicit personal learning plan is shown without a formal work ID; small talk produces no work; an ambiguous “continue the previous work” stays unresolved.

Bad: a delayed result appears before return authorization, a title match creates a formal association, an assistant claim changes business state, or a model-disabled panel hides actual operation receipts.

## 6. Tests required

Run relevant Pi/API, browser/state tests, typecheck, lint, build and diff checks. Cover strict schemas, scope filtering, formal login/CSRF/personal ownership, receipt/native linkage, historical opening, no history/business writes, late identity/source/work changes, cancellation/config changes, concurrent callers, capacity-one foreground priority and coexistence with input predictions.

Browser coverage must include per-session retention and navigation read gates, delayed GET/POST races, authority denial, user/seat changes, cache non-persistence, opening/closing, typing, ignoring only semantic content, multiple work/grouped cards, real evidence navigation, failure versus empty state and desktop layout. Live synthetic model probes separately measure semantic judgments, token use and latency; deterministic provider tests cannot establish semantic accuracy. Retain failed attempts and provider/configuration failures separately.

## 7. Wrong vs correct

Wrong: `workItemId === null` means activity is unknown; default to an existing formal association or write it as a new relation.

Correct: preserve a clear unregistered activity with null ID; use verified evidence and leave formal association untouched.

Wrong: `if (currentSession === response.session) show(response)` after navigating back.

Correct: cache for the captured identity/session, then publish only after the current navigation's authorized read establishes the same source/version.
