# Conversation Map Annotations

## 1. Scope / Trigger

Read when changing annotation storage, geometry editing, publications, task-current selection, annotation tools or composer references. This extends the source situation map with independent conversation-owned annotations. Source situation remains separate and read-only. Publishing does not update sources, notify recipients, invoke background work, approve anything or automatically adopt a version.

## 2. Signatures

`src/contracts/annotations.ts` owns browser/server/Pi DTOs. `AnnotationService` is the common authorization and effect boundary; `AnnotationStore` owns host SQLite tables. The executing actor is `{userId,seatId}` captured by the host, never model authority.

- `AnnotationRef`: `{setId,revision}` or `{publicationId}`; never implicit latest.
- `AnnotationSelection`: reference plus optional `layerIds` or `objectIds` (mutually exclusive).
- `AnnotationDocument`: `schemaVersion:1`, title, layers with unique layerId, name, order, defaultVisible and features. Feature IDs are unique throughout a document.
- `GET /api/sessions/:id/annotation` returns binding and draft head; `PUT .../annotation/base` takes `{clientActionId,expectedBindingRevision,baseRef}`.
- `POST .../annotation/actions` accepts discriminated `create_draft`, `apply`, `publish`. Apply requires expectedRevision and controlled operations; each action has clientActionId.
- `GET /api/annotations/:setId/revisions/:revision` reads an authorized private snapshot; `GET /api/annotation-publications/:id` reads the stable public projection.
- `GET /api/tasks/:id/annotations`, `/current`, `/history`; `POST .../current` takes `{clientActionId,publicationId,expectedCurrentSequence}`; `/read` and `/compare` accept fixed references and bounded selectors/pagination.
- `GET /api/annotation-actions/:id` queries the original actor's authorized receipt without replay.
- Pi main-session tools: `annotation_list`, `annotation_read`, `annotation_action`, `annotation_from_source`. Read modes include `draft` for the owned editable basis, fixed content, compare and receipt. Children and background runs receive no annotation write capability.
- Model `annotation_from_source({items:[{mode:'add'|'refresh',sourceRef:{systemId,objectType,objectId},layerId,objectId}]})` accepts 1–20 items. `AnnotationService.fromSourcesFromHost` receives captured authority and observed CAS conditions; legacy explicit-CAS `fromSource` remains for service callers. No new HTTP action branch, table or environment key. Batch receipts contain bounded `fromSources` metadata; older single `fromSource` receipts remain readable.
- Model `annotation_action` omits apply `expectedRevision` and adoption `expectedCurrentSequence`; HTTP/service inputs retain both. Explicit `baseRef`, publish `revision` and adoption `publicationId` remain business choices. Host-only `hostReplay`, `actionFromHost` and `setCurrentFromHost` do not accept client-supplied authority or digest overrides.

Annotation tool receipt reads must also match the captured taskId. The authenticated user's global HTTP receipt endpoint does not imply that a model running in one task may inspect another task's receipts.

Routes follow the existing formal or explicit test-seat API scope. No new credentials or deployment variables are introduced.

## 3. Contracts

### Ownership and snapshots

A workspace is task × seat; a conversation owns at most one editable draft. Same-seat conversations may read fixed private revisions but cannot target another conversation's draft through a model tool. Task managers do not gain other seats' private content. Cross-seat reads require a same-task publication and all required source scopes.

Baseline selection freezes a reference. First editing derives an independent complete snapshot, preserving inherited logical object IDs; explicit copy_object creates a new ID and origin reference. Saved revisions are immutable. Compare IDs as identity only when they exist in the common fixed baseline snapshot. Shared set ancestry alone is insufficient: sibling drafts can independently create coincidentally equal short IDs after branching, and those must appear as removed/added objects. For different branch points in the same ancestor, use the earlier referenced revision. Within a set, an ID continues to express the same logical identity; callers should generate a new ID for a genuinely new object rather than recycle a deleted ID.

Full snapshots, head updates and action receipts commit atomically. Check expectedRevision before mutation, independent from task-current expectedCurrentSequence. Retry the same action ID and normalized input returns its prior receipt; changed input conflicts. Check current read access before returning old receipts. Task archival uses the existing admission guard and blocks new mutations while retaining readable authorized history.

Published content removes private originFeatureRef pointers. Its content hash corresponds to that stable returned projection; private revision hashes correspond to full private snapshots. Deriving from a publication must use the same public projection, with the original required scopes inherited. Otherwise hidden private origins would reappear in the new owner's draft.

Source restrictions are monotonic across inherited data and introduced structured references, even when objects are subsequently deleted. This does not claim classification of free-form text. Only registered readable source systems are valid. Authority fields from clients/models are rejected. Validate merged object updates before iterating their source references; malformed runtime input must return INVALID_INPUT without committing a revision, rather than throwing a TypeError.

### Geometry and storage

WGS84 longitude first. Point, line, single-ring closed non-self-intersecting polygon and point-anchored text are supported. Reject unsupported geometry rather than removing holes or guessing coordinates. Styles are controlled data: color, fill, width, size, lineStyle, symbol and label; never arbitrary scripts, URLs or MapLibre expressions.

Authority lives in the host business database, outside /workspace and Bash mounts. Existing formal auth/background schemas migrate to annotation versions 9/10; all constructors must preserve the new terminal version. Explicit test mode retains its v1 identity-mode marker. Partial annotation tables are corruption, not a cue to recreate missing history. Old native transcripts are not rewritten.

### Request-local editing basis

`AnnotationRequestState` belongs only to the captured actor/task/session/request. Successful `annotation_read mode:draft` observes the owned set/revision/hash; an empty result records absence, not a prerequisite for creation. Fixed historical reads and automatic context metadata do not establish a writable basis. `annotation_list` observes current sequence; successful current `situation_query` records full source references and revisions, capped at 500 without silent eviction or erasing confirmed entries on overflow.

Creating a new draft requires explicit `baseRef:null` or a fixed reference, but no empty-draft pre-read. `actionFromHost` captures the binding and rechecks its revision/base, absence of a draft, permissions and cancellation before committing through the existing transaction. Never convert create into an edit or absorb a newly selected baseline. A successful create receipt establishes the initial draft basis; existing draft edits still require observed CAS.

New observations are keyed by native toolCallId and pending until the next ordinary model inference; a read and dependent pre-generated write in one assistant output cannot borrow that new read. Failed, replaced or in-place altered results discard only that call's pending observation. Original hooks remain chained; a hook exception stops the request. Confirmed own writes immediately advance mechanical CAS through matching beforeRef/afterRef, enabling sequential ordinary writes in one output. Each call commits separately. Never absorb an external head. Old idempotent receipts return with `replayed:true` and neither advance nor rewind the basis.

An ordinary error retains confirmed draft/source/current observations and pauses remaining map writes from the same assistant output (`ANNOTATION_BATCH_PAUSED`). The next ordinary inference releases that pause; missing/stale resources must still be read or re-evaluated. Service CAS continues rejecting a retained stale revision. Aggregate already-known missing draft/source issues without probing unauthorized resources. Do not clear unrelated source reads after a draft conflict, or draft/other source reads after a single source conflict.

Tool adapter errors serialize `code`, `message`, `outcome:'not_committed'|'unknown'`, and when applicable `resources:[{kind:'draft'|'binding'|'current'|'source',state:'missing'|'stale',itemIndex?,ref?}]` / `clientActionIds`. Source refs are full refs; preserve safe permission errors. Native Pi schema errors retain SDK text. Use typed errors, not Chinese string matching, for state transitions; error objects are not successful annotation receipts.

The service's host-only commit callback fires after SQLite COMMIT succeeds and before the admission guard is released. A committed write whose result cannot be delivered reliably, or a dispatched write with an unclassified exception, yields `ANNOTATION_RESULT_UNCERTAIN`. It remains blocked across inference, reread and compaction until the original receipt is successfully delivered. Receipt reconciliation clears the corresponding draft/current basis so a fresh read is required; a missing receipt is not proof that nothing happened. Do not automatically replay or retry under a new action ID.

Same-request consumed native steer/follow-up input retains observations and does not itself release a batch pause. Captured identity/task/session remains unchanged. Cancellation stops execution; new requests/restarts start empty. Completed compaction clears reading bases conservatively, while retaining unresolved action IDs during that request; failed/cancelled compaction follows the existing stop path. No cross-request cache or second transcript is introduced. Browser editors retain independently captured explicit start revisions.

Host idempotency hashes normalized model intent plus captured task/session, excluding injected mechanical conditions. Effective draft before/after references and source revisions remain in the same transaction receipt. Same action ID with changed intent conflicts, including cross-session reuse; current access is checked before replay. Public HTTP digests retain their explicit-input behavior.

### Copying source geometry

`annotation_from_source` requires an existing conversation draft/layer. Query the exact authorized source object outside the database transaction, require its expected revision, then recheck captured identity, source access, cancellation and draft CAS before the existing atomic apply/receipt transaction. Save the geometry and this query's UTC `queriedAt` without model transcription. Validate every batch target before any network query; duplicate target IDs are invalid. Prepare every item before one snapshot/head/receipt transaction. Any missing geometry, changed source, permission failure, cancellation or capacity error leaves the entire batch unwritten. The result is a snapshot of those reads, not a distributed transaction with the external source.

Add takes the source name and an unused annotation ID. Refresh requires exactly one matching full source reference and a compatible geometry type; it preserves the annotation ID, name, style, notes, attributes and unrelated references. Only geometry and the matching source revision/query time change. Refresh explicitly replaces any manual geometry adjustment; it does not run automatically. Business properties require a separate query and ordinary edit. The receipt returns business time but no complete geometry or properties. Publication and adoption remain separate.

Idempotency hashes normalized original source input, not fetched geometry/time. Replaying an authorized prior action returns its original receipt without another source query, even if the source has changed. Changed input with that action ID conflicts. Ordinary sourceRefs remain editable references, not proof that every annotation was copied by the host.

Use `focus.areaIds` for regional discovery and returned complete refs for exact reads. Combining areaIds and objectRefs intersects filters; road/vehicle refs do not discover an area object. A region tag alone does not imply a boundary geometry. Keep no match, missing geometry and failed queries distinct. User-defined geometry continues through `annotation_action`.

### Exact object-name reads

`AnnotationReadInput.objectNames?: string[]` and Pi draft/read accept 1–32 distinct nonblank exact names, each at most 120 characters. Object names and object IDs are mutually exclusive; either intersects the selected layer range. Names are not trimmed, case-folded, fuzzily matched or resolved in a newer version. Unlike layerNames (which must resolve uniquely), object-name reads return zero, one or many matches normally with existing paging and extra-field selection. `objects.total` counts all matches across requested names and does not imply every name matched. A zero count means no match only in the queried snapshot/range. Preserve all candidates, never select the first or widen the range automatically. Composer references remain ID-only. Old request/result/history behavior remains intact; echo objectNames only when provided.

### Model input and history

Automatic draft context only includes current set/revision, baseline and writability. It must not grow with the number of layers or objects. Explicit annotationRefs are validated references with bounded host-derived descriptive metadata; they do not automatically load geometry or all object properties. Old contextRefs keep their existing send-time external source semantics.

New inputs containing `context`, `annotationContext` or `annotationRefs` use `berserk.composer-input.v5`; method/role-only inputs remain v1. Preserve exact v1/v2/v3/v4 content generators and strict decoding: persisted text is compared byte-for-byte. V5 preserves v4 baseline/current explanations and uses the same bounded data fields and UI map-entry guidance. It explains next to automatic metadata that `baseRef` is the fixed derivation baseline (or the selected baseline before draft creation; null means none), not evidence of past or current adoption; `draft.revision` is the owned draft revision; `writable` grants draft editing only, not adoption authority. The automatic block does not provide task-current state; it does not deny separately obtained current-query evidence. Adopting a publication does not change a conversation baseline or draft. Both history readers recognize v5 and reject unknown versions; request ownership, ordering, Skill snapshots and readonly child restrictions remain enforced. A rollback must retain v5 readers for already-saved records. Native tool results record actual read fields; no synthetic tool success, second transcript, summary cache or memory system. Re-read a fixed revision after native compaction when exact data is needed.

Tool descriptions follow the same `canSetCurrent` decision as the action schema. Essential baseline/current semantics live in automatic input and tool descriptions, not only in the optionally loaded Skill. A successful edit receipt proves that action's effect; ordinary save/publish reports need not summarize task-current state. Absent `current` is neither `current.publication:null` nor evidence that the baseline is adopted. Task-current claims use this request's actual query or actual successful adoption result, limited to read/commit time; historical assistant text, old receipts and `replayed:true` cannot substitute. Successful adoption does not require a redundant readback merely to report its result. Actor fields do not establish an unreturned operation session. The map Skill distinguishes source facts, discussion and saved fields, with targeted reading only when evidence is insufficient. These are reporting instructions, not automatic prose verification; service receipts and existing UI entry behavior remain unchanged.

Annotation tool successes use `{format:'annotation.model-result.v1',data}` in Pi `content`. `projectAnnotationResult` removes only known annotation metadata hashes (root, draft/binding.draft, publication/current.publication, draft/publication list items), preserving business attributes, refs, timestamps and recovery data. Native `details.annotationResult` carries `{schemaVersion:1,origin:'write'|'replay'|'receipt_read',receipt}` only for successful action receipts. Ordinary reads do not duplicate map documents into details. Service/HTTP DTOs and RequestState retain original hashes. Errors retain the existing unwrapped error contract.

Read/draft results with objects add `query`, echoing only provided `objectIds/objectNames/layerIds/layerNames/fields`; empty filters produce `{}`, explicit `fields:[]` stays explicit. Existing `objects.total` is filtered, pre-pagination count; `hasMore` concerns later pages of that range only. Unrequested fields are not evidence of empty values. Compare counts concern changes; list pages concern visible drafts/publications. These meanings are in tool descriptions, not dependent on Skill loading. No automatic full-map query or prose verifier is added.

Read selectors differ from composer references: `AnnotationReadInput` permits both `layerIds` and `objectIds`, intersects them, and rejects requested objects absent from the selected layers. `AnnotationSelection` still rejects both selectors together. Keep their tool/schema descriptions separate; do not add a new service rejection to match a mistaken reference analogy. Basic read summaries always contain `objectId/name/kind/layerId`; `fields` selects only extra fields, and omitted or empty fields return the summary. List metadata and publication `note` do not expose object notes. Compare `counts` can include title/layer/object changes and retains its name. Default model results do not add `query.scope`; any isolated experiment is not a deployed contract.

The retained 10-17 layer-name candidate adds `AnnotationReadInput.layerNames?: string[]` and the same optional selector to Pi `annotation_read` draft/read. It accepts 1–32 distinct nonblank names of at most 120 characters, mutually exclusive with `layerIds`. `AnnotationService.read` authorizes and loads the fixed snapshot before exact name resolution; no trimming, case folding, fuzzy match, latest-version lookup or whole-map fallback. Each requested name must resolve uniquely before any object result is returned. `objectIds` still intersects, document order and pagination remain unchanged, and result `layers` contains the resolved IDs. Composer references keep their ID-only contract. This candidate passed a small native experiment; its presence in the branch does not imply production deployment or reliable natural-language interpretation.

The reporting rule must preserve useful analysis and complete the user's request, grounding facts in the actual selection and fixed version while distinguishing inference and advice. Do not reduce factual errors by omitting requested counts or refusing information that can reasonably be queried. Do not require a new read when existing fixed evidence suffices. When adding schema descriptions, use TypeBox constructors rather than object-spreading an optional schema: its non-enumerable optional marker can be lost. Verify the actual provider schema still leaves selectors optional.

V5 model text omits explicit annotation selection metadata hash while native custom details retain the validated original selections. Fixed v1–v4 text remains byte-exact. Reference summaries describe the selected range and do not claim full-version inventory or loaded business fields.

Both live completion and history snapshots use the shared `extractAnnotationResult` contract. Validate origin/tool/action/ref compatibility and agreement with projected model content. `null` explicitly rejects damaged metadata; absence supports legacy-only fallback. Hook boundaries snapshot raw content **and details**, including hashes, before original hooks; any altered/error delivery rejects pending read evidence and clears successful UI metadata. Never restore a rejected receipt from legacy-looking replacement text. Existing uncertain-write reconciliation remains unchanged.

Model tool JSON Schema uses object roots, standard `$defs`/`$ref` reuse and fixed-length numeric arrays for WGS84 positions. DeepSeek rejected draft-07 tuple `items: [schema, schema]` with HTTP 400 in the live acceptance trial; use one numeric `items` schema with `minItems=maxItems=2`. The shared service still enforces longitude ±180 and latitude ±90 before every write. Do not loosen business geometry validation, alter Pi internals, or change provider settings to mask a schema rejection.

The existing busy queue remains text-only. Rich annotation selections remain in the composer until idle. The accepted request retains its captured account and conversation, while its editing basis follows only explicit reads and its own confirmed commits; later browser navigation never changes its writer identity or target. An account disabled before execution cannot be replaced by a newly enabled account on the same seat.

### Map interaction

Business layers are distinct from MapLibre rendering layers. Source, own draft and read-only reference groups carry explicit labels and versions. Do not encode draft/publication/current status by replacing business colors, line styles or symbols. Reference groups are opt-in visible; overlapping objects require disambiguation.

Solid annotation strokes omit `line-dasharray`; the degenerate `[1,0]` dash disappeared after a road-to-hybrid switch despite unchanged sources and rendered-feature queries. Verify visible pixels as well as retained data when changing basemap rendering.

Viewport visibility, isolate, selection and zoom are local view state. Explicitly saving default visibility/order changes document content. Looking at a reference never changes the edit target. Unfinished geometry remains a local buffer; conflicts and failed saves retain it. Basemap view/config/retry changes retain the same MapLibre and TerraDraw instances. Runtime readiness uses the permanent `business:anchor`, never a provider layer name. Basemap resource changes must not restore/restart the editor or rewrite annotation IDs, coordinates or revisions. Identity/task/session changes invalidate late responses. Editor-only handles never enter a publication as lifecycle styling.

Capture the draft revision when a form or geometry edit begins. A background refresh may show a newer saved head but must not silently replace that edit's expectedRevision. Only an explicit conflict-review action may advance the edit base.

## 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Foreign private set/session or inaccessible publication scope | Safe not-found/denial without titles, counts or ancestry leakage |
| Nonmanager adopts public task current | Forbidden; private owner uses existing owner rule |
| Stale draft/current sequence or action ID reused with other input | Conflict; preserve user edits; no automatic overwrite |
| Invalid geometry, extra authority fields, ambiguous selector | Reject before effects |
| Authorized fixed snapshot lacks an exact requested layer name | ANNOTATION_LAYER_NAME_NOT_FOUND; no partial result or whole-map fallback |
| Authorized fixed snapshot has duplicate requested layer names | ANNOTATION_LAYER_NAME_AMBIGUOUS with only that snapshot's candidate IDs in the existing error message; caller must disambiguate |
| Both layerIds and layerNames, duplicate/blank/oversized names | INVALID_INPUT (native schema may reject first); no successful read basis |
| Oversized content/result | Explicit size failure; no silent geometry/selection truncation |
| Unknown composer version, altered persisted text or request ownership | Reject history; never rewrite old records or relax validation to load them |
| Archived task | New mutation rejected; authorized fixed versions remain readable |
| Source permission revoked | Reads, copies, publications and receipt lookup recheck permissions |
| Lost mutation response / altered committed result | Block writes until original receipt is delivered, then read affected state; absent receipt does not authorize retry |
| Ordinary parameter error or stale resource | Retain confirmed records; pause same-output writes; next inference corrects input or rereads only affected resources |
| Create without prior empty read | Allowed if explicit baseline, permissions, binding and no-draft transaction checks pass |
| Current publication unreadable | Explicit inaccessible state, not an empty successful map |
| Exact source missing / geometry missing | ANNOTATION_SOURCE_NOT_FOUND / ANNOTATION_SOURCE_GEOMETRY_MISSING; no estimate or write |
| Source revision changed / refresh source mismatch / incompatible type | Conflict; no silent latest retry or replacement of identity |
| Source query unavailable or malformed | Preserve explicit context error; no successful empty map or partial mutation |

## 5. Good / Base / Bad Cases

Base: two conversations derive from P1, independently edit, and retain their baselines after another publication is adopted. Good: a manager reads a published projection but is denied the author's private revision endpoint; deriving that publication also keeps private ancestors hidden. Bad: storing drafts as ordinary shared workspace files, adopting on publish, or replacing historical references with latest source state.

Layer-name base: `{mode:'draft',layerNames:['河岸巡查'],offset:1,limit:2}` reads that exact layer in saved order. Good: a historical ref resolves its old name after a later rename. Bad: choosing the first duplicate or answering a similarly named layer when the requested name is missing.

## 6. Tests Required

Verify validation/migration/service boundaries, formal HTTP auth and cross-task/seat isolation, native Pi input/tool/history compatibility, map editor read-only boundaries, and browser stale-response handling. `tests/annotations-acceptance.test.ts` covers multi-seat/session lifecycle, atomic invalid batches, immutable publications, CAS/idempotency, private owner adoption, archive and restart.

Layer-name assertions in `annotations.test.ts`, `annotations-acceptance.test.ts`, `annotation-results.test.ts`, and `pi/annotations.test.ts` cover exact names, duplicates/missing/blank names, selector exclusivity/intersection, empty layers, preserved order, historical renames, formal HTTP and denied/revoked scopes, projected query and native history. `pi/annotation-hook-boundaries.test.ts` also verifies name reads cannot establish an edit basis when hooks alter the delivered result. Normal ambiguity/missing-name errors are separate from malformed-call errors in live evaluation; expected clarification is not unconditional task failure.

Use fixed local tile fixtures for automated browser tests; no public tile scans. Record real-model results separately from deterministic tests, including tool schemas, automatic metadata and query output size. Bytes are not tokens. A small automatic context does not eliminate tool-definition or accumulated-history cost. Retain failures and actual calls rather than retrying until the model appears compliant.

`annotation-from-source.test.ts` covers exact point/line/polygon copying, time preservation, refresh fields/identity, denied and revoked scope, changed source/head, cancellation, archival and idempotency. `pi/annotation-source-history.test.ts` executes the native tool loop and reopens history/receipts without requerying a changed source. `probe-source-annotations.ts` records three independent real-model map flows and four bounded custom/missing-geometry/offline/ambiguous cases; protocol completion is not semantic acceptance.

`pi/annotation-workflow.test.ts` verifies actual native-loop read visibility, sequential writes, external CAS conflicts, invalid calls, replay, cancellation, compaction and input consumption. `annotation-map-evidence.test.ts` and desktop annotations tests cover fixed receipt entries, request boundaries, malformed results and read-only opening. Real-model Skill/layer diagnostics are separately recorded by `probe-map-workflow.ts`; `--recovery` runs three isolated empty-draft source→publish→refresh flows, preserving the original main-3 prompt and all failures. Deterministic success does not establish model compliance. Recovery tests cover retained records, aggregated missing resources, create races, hook mutations, post-commit RequestError and missing-receipt blocking.

`pi/composer-input.test.ts` checks fixed pre-change v1/v2/v3/v4 samples, v3/v4/v5 strict decoding and mixed evidence. `pi/annotations.test.ts` reopens and continues mixed v1/v2/v3/v4/v5 native histories, cancels v5 preparation, checks bounded context and delivery of essential semantics without Skill loading, and matches formal task permissions to descriptions/schema. Keep fixed historical expected text independent of the new generator.

## 7. Wrong vs Correct

Wrong: clone a publication's underlying private snapshot and only redact its ordinary GET response. Correct: apply the same stable public projection to cross-seat derivation while inheriting source restrictions.

Wrong: send the complete draft with every message so the model knows its target. Correct: send a fixed small binding and read the required fields of exact versions on demand.

Wrong: compare objects by short ID across unrelated sets. Correct: establish common lineage before treating inherited IDs as stable identity.

Wrong: infer a source polygon from a region name or replace `Z` with `+08:00` while retaining the same clock time. Correct: discover the actual object, copy through `annotation_from_source`, and preserve source timestamps or convert the instant correctly. A user-requested custom area can use ordinary editing without pretending to be an existing boundary.

Wrong: erase all observations on any tool error and require alternating draft/source rereads. Correct: retain confirmed observations, pause the current output, and identify only missing/stale resources. Unknown commit outcomes require original receipt reconciliation rather than treating every exception as no effect.

Wrong: equate a working map button or a successful save with an accurate explanation of task-current state. Correct: evaluate saved effects and visible narrative against their respective evidence, including pre-confirmation prose.

`annotation-results.test.ts` covers deterministic metadata projection and damaged/legacy evidence. `pi/provider-payload.test.ts` verifies actual provider JSON excludes receipt details/annotation hashes while preserving business hash attributes, native history and restart. Annotation native tests cover exact entries after real compaction; browser tests exercise legacy, structured and native streamed entries.
