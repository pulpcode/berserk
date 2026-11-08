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

Optional source resource metadata is defined in [Task Resource Semantics](./task-resources.md). Legacy resource quantities remain unchanged; the new adapter handoff types alone do not implement task-related/support queries or authorize a whole-task completeness claim.

`LAB_CONTEXT_CONFIG` names a controlled absolute JSON configuration. Credentials come from each system's `tokenEnv`. The configuration is static for one service process. Source `systemId` is host metadata frozen at admission; the sender cannot select identity or scope. Profile `contextScopeId` becomes `{scopeId,systemIds}` in the saved profile snapshot. Missing configuration never grants unrestricted access. Invalid new configuration disables related operations while legacy workflows and queue controls remain usable; an invalid profile is projected with `configurationError`. A query-capable profile with an omitted scope is invalid too, not a legacy unscoped profile.

A principal is either the authenticated seat or the internal service `{profileId,jobId,scope}`. Service task queries see only active public tasks; seat queries see their authorized metadata. Task matching unions reference, area and text candidates and returns match reasons; query is whole-string substring matching, not tokenized keyword search. Candidate membership is not a risk conclusion. `TaskBusinessRef.role?` is route/resource/location/work_area/reference, stored with existing context JSON and revision checks. Omitted roles are not silently inferred. Duplicate identities with conflicting roles are rejected. Project source query objectRefs to only systemId/objectType/objectId; task role and label are not source identity fields. Complete continuous discovery and initial task triggers are specified in [Continuous Background Analysis](continuous-analysis.md). Business references and focus filters are not authorization.

Successful tools return `{systemId,query,queriedAt,data,mapReferences?}` with actual HTTP/task data. The host derives optional map references from returned spatial objects or report object references, never from model prose. Pi records these normal tool results; do not build a second evidence database or reconstruct old facts from current sources. The information center and inbox expose successful queries from the originating request. A follow-up draft carries result and query references; preparing or viewing it does not call a model. Its selected task is a conversation/file save location, not the scope of discussion. Preserve the originating Inbox selection generation through all asynchronous preparation reads before navigating or writing its draft; see the frontend contract and [Situation Map](./situation-map.md).

Scope checks cover rule recipients, admission/execution, query, delivery and content reads (including lists, search, errors, downloads and imports). Source administration alone is insufficient to read combined scoped content. Such administrators retain minimum operational metadata. A seat's later private analysis remains private. Dynamic revocation/governance is outside this increment.

### Resource reads and optional task discovery

`situation_query` accepts optional `objectTypes` (`road`, `resource`, `area`), applied by the source before pagination for current and changes. Exact references must agree with the requested types. The decoder verifies returned rows satisfy the requested filter. Omitting it preserves legacy behavior.

A situation system may declare `resourceCapability`. Basic exact-object and type reads do not require task mappings. `ContextService.queryTaskResources` is the optional task discovery adapter, not an authorization substitute: current-only task/relation/category filtering requires declared capability; task mapping currently supports explicit `identity`, and potential support requires the implemented `explicit-task-relation` rule. Missing mapping/rule blocks only that discovery operation, not unrelated basic reads. Never infer a shared task identity from equal strings.

Current responses optionally carry `resourceCoverage:{status:'complete'|'partial',reason?}`. Partial requires a nonempty reason (at most 1000 characters); unknown keys/statuses and this field on changes responses are rejected. Preserve coverage on the final page and empty results. Legacy responses may omit it. The resource consumer checks its stability and retains declared gaps; having no next page does not override partial coverage.

Source query completion does not prove task membership or a complete task inventory. Platform task business references provide related-object evidence, not assignment. See [Task Resource Queries](./task-resource-query.md) for the business consumer; these source filters alone do not complete that feature.

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

## V6 scenario history projection and bounded pages

Paged scenario source lists apply both the requested row ceiling and a 200 KiB UTF-8 budget to the entire source response, including clock, unknown references, continuation metadata and coverage. The HTTP reader's 256 KiB limit remains unchanged. `limit` echoes the requested ceiling even when bytes cause fewer rows; `nextCursor` advances by the actual returned count. A nonterminal page must contain rows and have a usable cursor. A single item or response envelope that cannot fit returns explicit source `RESPONSE_TOO_LARGE` (HTTP 413), mapped to `CONTEXT_RESPONSE_TOO_LARGE`, without publishing partial body data or an empty looping page.

V6 changes responses declare `historyView:'state'`. Executing resource snapshots in those before/after rows omit the accumulated `executionTrack` and explicitly carry `executionTrackIncluded:false`. All remaining source facts, reference identity, revisions and business timestamps remain exact, including same-value state confirmations. The decoder accepts this omission only inside that declared history view; current objects must retain full tracks, and legacy full-history responses remain valid. Unknown view values, a current response pretending to omit its track, or a contradictory marker plus track are rejected. This is a read projection, not a rewrite or truncation of saved source history.

Cursor identity, snapshot revision checks, inclusive `from`/exclusive `to`, source filters and final-page-only `nextAfter` retain their existing semantics. Models must distinguish pagination completion from source-declared resource coverage, and query failure from zero changes. Follow pages when the used history range requires completion; a partial explanation is not evidence that every history row was read. Current and map reads continue to obtain complete trajectories from the existing object interface.
