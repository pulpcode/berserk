# Task Resource Queries

## 1. Scope / trigger

Read when changing resource discovery, task relationship interpretation, fixed resource results, resource-derived spatial analysis or native result authorization. This is batch 2 of the task-resource work, implemented inside the existing backend. It adds no result database, remote task service, Agent loop or automatic annotation write. Batch 3 Skill changes and batch 4 live-model evaluations are separate.

Data retrieval and relationship judgment are independent. A source need not understand platform task IDs. Read authorized records through existing exact references, area IDs, keywords and resource-type filters; determine task relationships from explicit evidence. A platform task reference establishes `related`, not `assigned`, `available` or completeness.

## 2. Signatures and ownership

- `src/contracts/resource-results.ts`: `ResourceRequest`, `ResourceResult`, shared validation and `projectResourceResult` / `extractResourceResult`.
- `TaskResourceService.query(request, scope, requestId, toolCallId)`: fixed read-only discovery and organization.
- `TaskResourceService.authorize(result, scope)`: owner, task/session, source grants and fixed-annotation checks.
- `TaskResourceService.summarize(request, parent, scope, requestId, toolCallId, spatial?)`: statistics from fixed authorized evidence.
- Foreground Pi tool `task_resource_query` has `query`, `read`, `summarize` operations. Background and child tool whitelists do not expand.
- `ContextService.queryTaskResources(scope, principal, signal?)` is an optional source-capability adapter. Ordinary `situation_query` remains independently usable.
- `resolveResourceResult` resolves native Pi evidence; `resolveResourceMessage` locates actual user messages. Neither creates secondary storage.

## 3. Contracts

### Query and retrieval

```ts
{ operation: 'query', purpose: 'data', sources: [{ systemId: 'source-a', areaIds: ['area-a'] }] }
{ operation: 'query', purpose: 'task' }
{ operation: 'read', resultRef, offset: 0, limit: 100 }
{ operation: 'summarize', resultRef, relation: 'assigned', availability: 'available' }
```

`purpose:data` requires explicit sources or fixed annotation selections. It retains resources whose task relationships are unknown. For `purpose:task`, omitted source/annotation selections use platform task business references and their structured resource links, current bound draft or baseline, task-adopted publication, and declared optional source task capabilities. Do not globally scan every authorized source when associations are absent.

`resourceCapability` is optional per source. The implemented task-ID mapping is explicit `identity`; identical-looking IDs alone are insufficient. Potential-support discovery requires the implemented `explicit-task-relation` rule. Missing mapping/rule disables only that optional discovery, not ordinary exact/area/type reads. See [Context Analysis](./context-analysis.md).

Current source responses may carry `resourceCoverage:{status:'complete'|'partial',reason?}`; partial requires a nonempty reason. Preserve it on the final page and empty sets. Missing this field retains legacy request-level semantics. Page completion does not supersede declared partial coverage. Snapshot checks include coverage consistency across pages and separate selections from one source.

### Results and meanings

Scene queries additionally support v4: a configured source supplies a trusted snapshotClock; statistics use businessNow, audit creation time stays real, and fixed summaries/spatial provenance preserve that clock. Ordinary queries remain v3. See [Scenario Director and Business Clock](./scenario-director.md) for strict trust/mixed-clock rejection, result compatibility and tests. The batch2 statements below describe the original v1–v3 behavior.

New query/summarize results use `schemaVersion:3`; readers also accept versions 1 and 2. Version 3 adds evidence explanations to the public projection and keeps the version 2 quantity algorithm. Results preserve original records separately from organized items, data `coverage` separately from `relationshipCoverage`, source/fixed-annotation dependencies, exclusions, and uncertainty. Query/summarize create `resource:<requestId>:<encodedToolCallId>`; read adds delivery identity without creating a new origin. Fixed reads never refresh source data.

Only reliable source entity identity or host-controlled imports can merge records. Same names, coordinates, ordinary copies or plain source references do not prove identity. Different source namespaces do not provide a global deduplication identity. Quantity groups retain category, unit, meaning, scope, time and source distinctions. Known quantities and unknown contributions are separate; record count is not entity count. Aggregate/member overlap without explicit coverage is not summed. Version 2 unions complete member sets only for compatible `entities` quantities: reliable source namespace, category, unit, meaning, scope, effective time and conditions must agree, and declared counts must match complete member lists. A complete list of all members does not identify the available subset. Unresolved overlap produces an unknown aggregate total; `knownValue` contains only independently provable contributions, never the sum of possibly overlapping declarations. Original per-record quantities remain available.

`summarize` can filter relationship and availability independently (`all`, `available`, `unavailable`, `unknown`, `conflict`). `statisticsScope` records the fixed query time and effective filters; derived summaries preserve that time instead of reinterpreting old evidence at the new call time. The shared pure quantity function in `contracts/resource-summary.ts` is reused by service and decoder, which verifies quantity values against the fixed records. Native summary resolution also checks its original parent and inherited statistics scope. New summaries from a v1/v2 parent use the current result version with v2 quantity rules and get a new result reference; reading the v1 parent never recomputes or rewrites its persisted bytes. Version 1 validation retains its old quantity algorithm, including previously accepted overlapping totals; these are historical evidence, not correct v2 totals. Old invalid A06 results remain invalid.

Query generation and validation share the statistics selection and incomplete-empty rule. Keep all retrieved records while counting only the requested selection. When that selection is empty but relationship coverage is partial for a task filter, `knownEntityCount` is 0 and `entityCount` is null. An explicit complete data query with no records can report 0.

Availability and relationship evidence are time/condition-sensitive. Actual resource positions can be used for spatial work; planned, estimated, site-only, conflicting and missing positions remain explicit omissions. A valid resource declaration alone does not establish an actual usable position.

User messages preserve verified native user text and selected resource references as `unverified_user_report`. Verifying the message ID does not certify a model's interpretation or turn prose into source-system facts. The native locator accepts the actual user entry associated with verified composer selection; assistant text, summaries and unrelated branches are not substitutes.

### Version 3 evidence presentation

`projectResourceResult` adds explanations derived from the fixed records for version 3 only. Version 1/2 projection bytes and the `resource.model-result.v1` outer envelope remain unchanged. Do not recalculate availability or relationships in presentation. Reasons retain their record references and explain the stored state at `statisticsScope.at`, not present-day availability.

Missing release confirmation means unconfirmed release, not a negative release fact. Effective explicit unavailable evidence supports unavailable; expired available evidence without other effective facts leaves availability unknown; effective opposing facts retain conflict and both bases. Multiple reasons may coexist. Platform references support relatedness, not assignment or availability; assignment/support require their own applicable evidence.

Keep source snapshot time, source query time, fixed annotation version time, result creation time and fact report/effective/expiry times distinct. Missing timestamps remain missing. Each quantity group retains its own category/unit/meaning/scope; different filtered sets can have the same unit. Complete aggregate member identity, unknown individual identity, overlapping members and missing actual positions are different issues. Explanations must reuse quantity compatibility rules rather than inventing another deduplication algorithm. Overlap explanations show at most 3 record examples and 5 member IDs per example, with exact known-overlap record/member counts and explicit completeness flags. These caps apply only to explanations: original member evidence remains in fixed records and is readable by pagination. Zero proven overlaps is not proof of disjointness. Avoid pairwise duplication of full member arrays.

### Spatial and native history

`spatial_analyze` accepts `{kind:'resource', resultRef, itemIds?}`. Resource-derived results use spatial `schemaVersion:3` and retain resource owner/dependencies/coverage, omitted-position reasons and candidate provenance. This is distinct from the older `spatial.model-result.v3` display envelope. Old spatial v1/v2 records and text remain unchanged.

Resource statistics with `spatialResultRef` must refer to the matching resource candidate collection, not merely a spatial result that mentioned the resource collection as a target. Carry target dependencies into derived statistics. Later filtering, reading, saving or derived operations must not erase original coverage or authorization restrictions.

Derived resource statistics retain `spatialCoverage` with the classified/total candidate counts and unclassified IDs/reasons. When position coverage is partial, `entityCount` is unknown even if known hits are empty; `knownEntityCount` still describes the known subset. Subsequent statistics preserve this coverage. Native resolution compares spatial evidence and the selected parent items, not just matching reference strings.

Results stay in the native Pi branch across restart and compaction. Validate original successful tool call, arguments, ownership, details and model text; read delivery cannot impersonate an origin. Recheck dependencies on reads, statistics, spatial use, saves, historical projection and before every provider/compaction send, including tool continuations within one request. Hook-modified success fails closed; ordinary recoverable tool errors remain recoverable.

No new environment key or SQL migration is required. Existing source adapters must actually implement declared filters; merely adding capability configuration does not implement a remote API.

## 4. Validation and error matrix

| Condition | Required behavior |
| --- | --- |
| Explicit data query without scope | `RESOURCE_SCOPE_REQUIRED` |
| Source has no task interface | Basic reads work; relationship discovery is unsupported/unknown |
| Platform reference only | `related`; never upgrade to assigned/available |
| No task associations | No global scan; unknown task total, not confirmed zero |
| Pagination snapshot changes, missing exact object, repeated cursor | Preserve unavailable/partial evidence; do not keep inconsistent source rows as a complete count |
| More than 500 raw records, 50 pages, or 1 MiB result | Explicit limit error; no successful truncated whole set |
| Cancellation | Abort propagation; no committed write or successful partial result |
| Owner/grant/fixed evidence no longer authorized | Reject access; hide structured historical result and prevent sending it to the model |
| Another query's spatial result, or resource used only as target | Reject statistics linkage |
| Missing/ambiguous user-message evidence | Reject invalid locator or retain unverified meaning; do not upgrade source facts |

## 5. Good / base / bad cases

- Good: read R1/R2 from an explicit source area even though neither has a task field; classify both actual positions; report their task relationships as unknown.
- Base: a platform task references R1. Read R1 by exact reference without task parameters; classify it as related while assignment remains unproven.
- Bad: no platform references exist, so scan all authorized resources and call every nearby vehicle available for this task.

## 6. Required tests

Run `context-resource-query`, `task-resource-query`, `task-resource-spatial`, `pi/task-resource` and `pi/task-resource-results`, plus affected existing context, annotation, spatial and Pi tests. Verify real local HTTP filtering before pagination, D15's five no-interface/optional-interface cases, independent expected identities/counts, fixed snapshots, permissions, raw message evidence, actual deterministic Pi tool loop, restart and compaction. Do not replace these with mocks returning expected business conclusions.

For quantity repairs, use independent expected sets/counts, frozen v1 bytes (including the old accepted overlap=4), and T01–T14 regressions. Cover real source decoding → HTTP → Pi tool → native history → read/spatial reuse for empty task selections, complete intersecting aggregates and missing membership. Complete members can still lack actual positions; assert truthful partial/unclassified results, never invented geometry. Any recurrence of empty-selection self-validation abort, duplicate counting under valid dedup prerequisites, or unsupported exact totals fails the tool repair gate independently of model accuracy.

Run package typecheck, lint/boundaries, build and relevant desktop annotation/history/save regressions. Deterministic providers and these offline checks establish implementation behavior, not model accuracy or Skill-loading effectiveness. See the task's acceptance trace for D01–D24 evidence and explicit limits.

## 7. Wrong vs correct

Wrong: `items.length === 0`, therefore the task has no assigned resources.

Correct: report the fixed known records and relationship coverage. With absent/incomplete association evidence, an empty known assignment list has an unknown actual total. Likewise, a tool success is not evidence that a model's final explanation is correct.
