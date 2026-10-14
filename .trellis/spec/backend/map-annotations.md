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

`AnnotationRequestState` belongs only to the captured actor/task/session/request. Successful `annotation_read mode:draft` observes the owned set/revision/hash or explicit empty bindingRevision/baseRef. Fixed historical reads and automatic context metadata do not establish a writable basis. `annotation_list` observes current sequence; successful current `situation_query` records full source references and revisions, capped at 500 without silent eviction.

New observations are pending until the next ordinary model inference; a read and dependent pre-generated write in one assistant output cannot borrow that new read. Confirmed own writes immediately advance mechanical CAS through matching beforeRef/afterRef, enabling sequential ordinary writes in one output. Each call commits separately. Never absorb an external head. Old idempotent receipts return with `replayed:true` and neither advance nor rewind the basis. Mutation failure invalidates the basis and blocks subsequent writes until a fresh read is visible.

Cancellation, consumed native steer/follow-up input and completed compaction invalidate observations; new requests start empty. Preserve existing public Pi hooks/loop. Failed or altered map results cannot supply readable evidence. Unknown effects require original receipt inspection, not automatic replay. Empty creation checks the observed binding and absence of a draft again before commit. Browser editors retain their independently captured explicit start revision.

Host idempotency hashes normalized model intent plus captured task/session, excluding injected mechanical conditions. Effective draft before/after references and source revisions remain in the same transaction receipt. Same action ID with changed intent conflicts, including cross-session reuse; current access is checked before replay. Public HTTP digests retain their explicit-input behavior.

### Copying source geometry

`annotation_from_source` requires an existing conversation draft/layer. Query the exact authorized source object outside the database transaction, require its expected revision, then recheck captured identity, source access, cancellation and draft CAS before the existing atomic apply/receipt transaction. Save the geometry and this query's UTC `queriedAt` without model transcription. Validate every batch target before any network query; duplicate target IDs are invalid. Prepare every item before one snapshot/head/receipt transaction. Any missing geometry, changed source, permission failure, cancellation or capacity error leaves the entire batch unwritten. The result is a snapshot of those reads, not a distributed transaction with the external source.

Add takes the source name and an unused annotation ID. Refresh requires exactly one matching full source reference and a compatible geometry type; it preserves the annotation ID, name, style, notes, attributes and unrelated references. Only geometry and the matching source revision/query time change. Refresh explicitly replaces any manual geometry adjustment; it does not run automatically. Business properties require a separate query and ordinary edit. The receipt returns business time but no complete geometry or properties. Publication and adoption remain separate.

Idempotency hashes normalized original source input, not fetched geometry/time. Replaying an authorized prior action returns its original receipt without another source query, even if the source has changed. Changed input with that action ID conflicts. Ordinary sourceRefs remain editable references, not proof that every annotation was copied by the host.

Use `focus.areaIds` for regional discovery and returned complete refs for exact reads. Combining areaIds and objectRefs intersects filters; road/vehicle refs do not discover an area object. A region tag alone does not imply a boundary geometry. Keep no match, missing geometry and failed queries distinct. User-defined geometry continues through `annotation_action`.

### Model input and history

Automatic draft context only includes current set/revision, baseline and writability. It must not grow with the number of layers or objects. Explicit annotationRefs are validated references with bounded host-derived descriptive metadata; they do not automatically load geometry or all object properties. Old contextRefs keep their existing send-time external source semantics.

Use the native composer-input compatibility branch for new records. Preserve the exact v1 content generator and strict decoding. Native tool results record actual read fields; no synthetic tool success, second transcript, summary cache or memory system. Re-read a fixed revision after native compaction when exact data is needed.

Model tool JSON Schema uses object roots, standard `$defs`/`$ref` reuse and fixed-length numeric arrays for WGS84 positions. DeepSeek rejected draft-07 tuple `items: [schema, schema]` with HTTP 400 in the live acceptance trial; use one numeric `items` schema with `minItems=maxItems=2`. The shared service still enforces longitude ±180 and latitude ±90 before every write. Do not loosen business geometry validation, alter Pi internals, or change provider settings to mask a schema rejection.

The existing busy queue remains text-only. Rich annotation selections remain in the composer until idle. The accepted request retains its captured account and conversation, while its editing basis follows only explicit reads and its own confirmed commits; later browser navigation never changes its writer identity or target. An account disabled before execution cannot be replaced by a newly enabled account on the same seat.

### Map interaction

Business layers are distinct from MapLibre rendering layers. Source, own draft and read-only reference groups carry explicit labels and versions. Do not encode draft/publication/current status by replacing business colors, line styles or symbols. Reference groups are opt-in visible; overlapping objects require disambiguation.

Viewport visibility, isolate, selection and zoom are local view state. Explicitly saving default visibility/order changes document content. Looking at a reference never changes the edit target. Unfinished geometry remains a local buffer; conflicts and failed saves retain it. Identity/task/session changes invalidate late responses. Editor-only handles never enter a publication as lifecycle styling.

Capture the draft revision when a form or geometry edit begins. A background refresh may show a newer saved head but must not silently replace that edit's expectedRevision. Only an explicit conflict-review action may advance the edit base.

## 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Foreign private set/session or inaccessible publication scope | Safe not-found/denial without titles, counts or ancestry leakage |
| Nonmanager adopts public task current | Forbidden; private owner uses existing owner rule |
| Stale draft/current sequence or action ID reused with other input | Conflict; preserve user edits; no automatic overwrite |
| Invalid geometry, extra authority fields, ambiguous selector | Reject before effects |
| Oversized content/result | Explicit size failure; no silent geometry/selection truncation |
| Archived task | New mutation rejected; authorized fixed versions remain readable |
| Source permission revoked | Reads, copies, publications and receipt lookup recheck permissions |
| Lost mutation response | Query receipt before explicit retry; no implicit second write |
| Current publication unreadable | Explicit inaccessible state, not an empty successful map |
| Exact source missing / geometry missing | ANNOTATION_SOURCE_NOT_FOUND / ANNOTATION_SOURCE_GEOMETRY_MISSING; no estimate or write |
| Source revision changed / refresh source mismatch / incompatible type | Conflict; no silent latest retry or replacement of identity |
| Source query unavailable or malformed | Preserve explicit context error; no successful empty map or partial mutation |

## 5. Good / Base / Bad Cases

Base: two conversations derive from P1, independently edit, and retain their baselines after another publication is adopted. Good: a manager reads a published projection but is denied the author's private revision endpoint; deriving that publication also keeps private ancestors hidden. Bad: storing drafts as ordinary shared workspace files, adopting on publish, or replacing historical references with latest source state.

## 6. Tests Required

Verify validation/migration/service boundaries, formal HTTP auth and cross-task/seat isolation, native Pi input/tool/history compatibility, map editor read-only boundaries, and browser stale-response handling. `tests/annotations-acceptance.test.ts` covers multi-seat/session lifecycle, atomic invalid batches, immutable publications, CAS/idempotency, private owner adoption, archive and restart.

Use fixed local tile fixtures for automated browser tests; no public tile scans. Record real-model results separately from deterministic tests, including tool schemas, automatic metadata and query output size. Bytes are not tokens. A small automatic context does not eliminate tool-definition or accumulated-history cost. Retain failures and actual calls rather than retrying until the model appears compliant.

`annotation-from-source.test.ts` covers exact point/line/polygon copying, time preservation, refresh fields/identity, denied and revoked scope, changed source/head, cancellation, archival and idempotency. `pi/annotation-source-history.test.ts` executes the native tool loop and reopens history/receipts without requerying a changed source. `probe-source-annotations.ts` records three independent real-model map flows and four bounded custom/missing-geometry/offline/ambiguous cases; protocol completion is not semantic acceptance.

`pi/annotation-workflow.test.ts` verifies actual native-loop read visibility, sequential writes, external CAS conflicts, invalid calls, replay, cancellation, compaction and input consumption. `annotation-map-evidence.test.ts` and desktop annotations tests cover fixed receipt entries, request boundaries, malformed results and read-only opening. Real-model Skill/layer diagnostics are separately recorded by `probe-map-workflow.ts`; deterministic success does not establish model compliance.

## 7. Wrong vs Correct

Wrong: clone a publication's underlying private snapshot and only redact its ordinary GET response. Correct: apply the same stable public projection to cross-seat derivation while inheriting source restrictions.

Wrong: send the complete draft with every message so the model knows its target. Correct: send a fixed small binding and read the required fields of exact versions on demand.

Wrong: compare objects by short ID across unrelated sets. Correct: establish common lineage before treating inherited IDs as stable identity.

Wrong: infer a source polygon from a region name or replace `Z` with `+08:00` while retaining the same clock time. Correct: discover the actual object, copy through `annotation_from_source`, and preserve source timestamps or convert the instant correctly. A user-requested custom area can use ordinary editing without pretending to be an existing boundary.
