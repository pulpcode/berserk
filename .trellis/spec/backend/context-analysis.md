# Multi-source Context Queries (Capability Validation)

## 1. Scope / Trigger

This contract describes the implemented validation only. Mock roads, resources, reports, fixed scopes and recipients do not establish the final business model. Keep Pi's loop, compaction and native conversation history unchanged. Query tools are host-side read-only capabilities for the main Agent; existing delegated roles do not acquire them.

## 2. Signatures

- `ContextService.query(tool, input, principal, signal?)` handles `information_search`, `information_read`, `situation_query` through HTTP only.
- `TaskQueryService.search(params, principal, signal?)` and `.read(taskId, principal, signal?)` read Axon metadata without creating workspaces or reading chat/files.
- `GET /api/context/catalog` returns permitted system IDs, display names, capabilities and mock area choices, without URLs/tokens.
- Task create/update accepts optional `context`. Omission preserves, `null` clears on update, object replaces. Existing revision and management permissions apply; public managers and private owners retain their established rights.
- `npm run mock:context`, `mock:context:control`, `probe:context` are development/validation commands. They do not deploy or modify existing production data.

## 3. Contracts

`LAB_CONTEXT_CONFIG` names a controlled absolute JSON configuration. Credentials come from each system's `tokenEnv`. The configuration is static for one service process. Source `systemId` is host metadata frozen at admission; the sender cannot select identity or scope. Profile `contextScopeId` becomes `{scopeId,systemIds}` in the saved profile snapshot. Missing configuration never grants unrestricted access. Invalid new configuration disables related operations while legacy workflows and queue controls remain usable; an invalid profile is projected with `configurationError`. A query-capable profile with an omitted scope is invalid too, not a legacy unscoped profile.

A principal is either the authenticated seat or the internal service `{profileId,jobId,scope}`. Service task queries see only active public tasks; seat queries see their authorized metadata. Task matching unions reference, area and text candidates and returns match reasons; candidate membership is not a risk conclusion. Business references and focus filters are not authorization.

Successful tools return `{systemId,query,queriedAt,data}` with actual HTTP/task data. Pi records these normal tool results; do not build a second evidence database or reconstruct old facts from current sources. The information center and inbox expose successful queries from the originating request. A follow-up draft carries result and query references; preparing or viewing it does not call a model. Its selected task is a conversation/file save location, not the scope of discussion. Preserve the originating Inbox selection generation through all asynchronous preparation reads before navigating or writing its draft; see the frontend contract.

Scope checks cover rule recipients, admission/execution, query, delivery and content reads (including lists, search, errors, downloads and imports). Source administration alone is insufficient to read combined scoped content. Such administrators retain minimum operational metadata. A seat's later private analysis remains private. Dynamic revocation/governance is outside this increment.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| No context config | Existing workflows remain; empty query catalog |
| Invalid config / missing profile scope | Related capability unavailable; no scope fallback; unrelated controls work |
| Forbidden scope or guessed foreign task | Denied without foreign content or count leakage |
| Invalid/unsupported filters | Explicit query error, not empty-success data |
| Timeout / response over 256 KiB | Safe `CONTEXT_*` tool error; no partial body |
| User cancellation | Abort HTTP and stop the request; no subsequent model loop |
| Stale page / invalid change cursor | Distinct errors; no silent page mixing |
| Ordinary external failure | Tool error returned to Pi; a qualified partial answer can finish normally |

HTTP calls are limited to 15 seconds and 256 KiB; redirects are not followed. `cursor` is pagination, `after` is the source change position, and only a final changes page returns `nextAfter`. Query and ingress tokens are independent. Full mock wire details are in the task's integration contract.

## 5. Good / Base / Bad Cases

Base: an update triggers a fixed Profile, which queries sources/tasks and delivers a result. Good: swapping task requirements changes the model's conclusion; a person follows up using current authorized queries. Bad: fixtures containing task impact answers, a model-selected host URL/seat, or showing a successful job as proof its reasoning is accurate.

## 6. Tests Required

Run typecheck, lint/boundaries, Vitest, build and desktop Playwright. `context-http`/`context-cli` use real local HTTP; `task-context` uses real SQLite; `context-background` uses native Pi with a deterministic provider. Test optional fields/CAS, fixed snapshots, private task isolation, metadata redaction, old evidence after source changes, paging, cancellation and unavailable configuration. Do not run separate Playwright suites concurrently against the same artifact directory.

`probe:context` supplies real-model evidence separately. Retain actual queries and results, including wrong calls and reasoning issues. Execution success and delivery success do not prove semantic goal completion. Record limitations rather than rewriting prompts around a synthetic answer.

## 7. Wrong vs Correct

Wrong: list every system in every tool description, then rely on errors to teach the model which systems implement reports. Correct: derive supported IDs from actual adapter capabilities. Wrong: append mock answers to instructions. Correct: mock APIs supply facts; only the test driver knows task IDs and expected comparisons.
