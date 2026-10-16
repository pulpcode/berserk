# Foreground Spatial Analysis

## 1. Scope / Trigger

Read when changing spatial calculations, Pi tools/native history, analysis map evidence or exact-result annotation saves. This is a module inside the existing Node backend, not a separate service, Python runtime, result database or Agent loop. Only the foreground main Agent receives the tools; background and child whitelists do not expand. Routing, imagery interpretation and operational dispatch decisions remain outside this increment.

## 2. Signatures and ownership

- `src/contracts/spatial.ts` owns inputs/results, model projection and strict shared extraction. Browser code imports this contract, never Pi or calculation modules.
- `SpatialAnalysisService.analyze(request, scope, requestId, toolCallId)` resolves authorized data through existing Context/Annotation services and runs bounded computation.
- `spatial_analyze` exposes measure, relate, buffer, filter, nearest, summarize and fixed-result read. Each call performs one operation; Pi's ordinary loop composes them.
- `annotation_from_analysis({resultRef,itemId?,layerId,objectId,name})` resolves actual native history and saves exact geometry through `AnnotationService.fromAnalysisFromHost`. No new HTTP mutation branch or storage table is introduced.
- The controlled `spatial-analysis` Skill uses existing explicit selection and `skill_read`. Advice about methods never grants authority or replaces executable validation.

## 3. Data and calculation contracts

Inputs select a source scope, fixed annotation revision/publication, or verified prior result. Do not accept model-supplied geometry or executable expressions. Source references retain complete `{systemId,objectType,objectId}` identity and existing ContextRef text syntax. Match existing query limits: 20 exact references and 10 area IDs per selector. Omitting both explicitly selects that source's authorized current objects, independently of viewport, task focus, visibility or basemap coverage. Reject duplicate revision conditions using identity tuples, regardless of JSON key order.

Collect required source pages and check snapshot/change cursors, repeated object revision/geometry/properties/business time, and requested-ref coverage. Failures, missing geometry/required fields, stale revisions, incomplete pages and capacity limits are errors, not zero matches or successful partial counts. Complete empty sets may yield complete empty results. Preserve queriedAt, asOf, revision, effectiveAt and nullable-ended validTime; do not invent a common instant across sources. Fixed annotation inputs retain their hash/time/reference. Prior results reuse stored snapshots, not refreshed sources.

Use WGS84 longitude/latitude GeoJSON Point, LineString, Polygon and supported MultiPolygon. Turf modules are pinned to 7.2.0. Distances/length use sphere R=6,371,008.8 m; areas use square metres. Topology uses longitude/latitude line segments. Buffer uses AEQD and 32-step arc approximation; do not equate its boundary with an exact distance threshold.

- Measure supports point/point distance, point/line shortest distance, line length and polygon/multipolygon area.
- Contains is closed-region coverage including boundary, with a polygon/multipolygon first geometry. Intersects includes contact; disjoint means no intersection. Filter's target is the containing region or distance reference, while input is the candidate set.
- Distance filtering compares candidate points against a point/line with `<= distanceM`, without implicit tolerance. Attribute predicates are AND conditions on actual top-level scalar fields; missing required fields fail even if another predicate excludes the object.
- Nearest accepts candidate points and one reference point. Filter before top N; sort by exact computed distance then full identity, without expanding N for ties. This never proves travel time, connectivity or suitability.
- Summarize counts unique complete identities by a present scalar field; null is a distinct category. `items` remain the reusable result set. Optional `referenceItems` preserve target geometry for verification/display without changing result counts or downstream candidates.

Reject latitude absolute value >=80 degrees, single geometries spanning >10 degrees, and combined topology inputs spanning >10 degrees (including date-line pairs). Buffer radius is positive and <=50,000 m. Do not silently repair coordinates, drop holes or replace shapes with bounds. Validate nonzero rings, self/inter-ring intersections, hole containment/nonoverlap and MultiPolygon interior nonoverlap; Turf booleanValid alone is insufficient. An island inside another part's hole remains valid. Retain explicit invalid/unsupported errors.

Limits: 500 total input objects, 10,000 vertices, 2,000 vertices per geometry and 1 MiB serialized result. Expensive validation/calculation runs in one source-runtime Node worker per operation: at most four concurrent workers, 128 MiB old generation each, and a 3-second deadline including startup. Cancellation/timeout waits for termination. A Promise timeout must not leave synchronous Turf work running. The worker allocation limit does not claim whole-process RSS is 128 MiB; do not add a persistent task queue.

## 4. Native evidence, authorization and saves

Model content uses `spatial.model-result.v1`, retaining conditions, identities, counts, units, scope, time and limitations while omitting coordinates. Native details.spatialResult retains full geometry/evidence. resultRef locates an original request/tool call and never grants authorization. Resolve only actual successful original spatial_analyze calls in the authorized branch, matching operation, parameters, scope and model/details projection. Duplicated, copied, altered or foreign refs cannot authorize saves. Read preserves the origin/snapshot and adds separate delivery request/tool-call ownership for current UI evidence.

Recheck captured identity, task/session and all source/fixed-annotation dependencies on read, after computation and before save. Historical projection hides inaccessible structured tool bodies; new requests cannot feed revoked spatial evidence back to the model. Hook changes invalidate structured success. spatialRejected distinguishes rejected original success from ordinary recoverable errors: damaged success bodies are hidden and continuation fails closed without rewriting native history; ordinary errors allow corrected later requests. Already-written assistant prose remains historical text, not an authorization-checked reconstruction.

Native history remains authoritative across compaction/restart; no secondary transcript or result cache/database. Shared extraction distinguishes absent metadata from explicit null rejection and validates content agreement. Browser entries require actual message request/tool-call ownership, using delivery ownership for reads. Never derive geometry/success from assistant prose.

Save the original generated geometry or selected result item without recomputation/transcription. Require existing owned-draft basis/layer and preserve CAS, idempotency, transaction, cancellation and uncertain-receipt reconciliation. Dependency source scopes remain monotonic, including annotation-derived scopes. Public publication projection must not reveal private result references. Saving, publishing and adoption remain separate. Existing annotation ID/geometry constraints still apply: refuse incompatible source references, holes and multipolygons explicitly instead of dropping provenance or geometry parts.

## 5. Map presentation

Analysis owns only analysis:* resources on the retained MapLibre instance. Basemap switches do not rebuild it. Render analysis below business objects/editor controls; reference objects have distinct presentation identities. Display fixed input/target geometry, values, scope and time. Show/hide/clear are local actions; clearing does not delete history. Only explicit opening/locating moves the camera, respects drawing and accounts for panel occlusion. Discard inappropriate temporary display on identity/task/session navigation. Failed tiles or unavailable WebGL leave text/object results usable.

## 6. Required verification

Run typecheck, lint/boundaries, Vitest, build and relevant desktop Playwright. spatial-math-oracles, spatial-geometry-validity, spatial-contract-boundaries, spatial-source, spatial-worker-boundaries, pi/spatial and spatial-map-ui cover independent numeric expectations, invalid polygons, strict evidence, pagination/time/permissions, bounded workers, exact saves, restart/actual native compaction and rendering. Retain regressions for hook changes, ordinary-error recovery, selector bounds/Unicode IDs and canonical revision deduplication. Local-fixture browser tests cover both countries, view switching/failure, drawing retention, reference geometry and desktop narrow panels.

Live-model method selection is a separate gate. probe-spatial-* retains the frozen A/B/C schedule, code/data/Skill hashes, real tool/provider evidence and failures. Deterministic providers or successful tool calls do not prove Skill benefit or semantic correctness. Do not claim AC10 until scheduled trials and independent semantic review finish. Preserve first failures and distinguish contention reruns from product fixes.
