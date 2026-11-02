# Task Resource Semantics — Batch 1

## 1. Scope / Trigger

Read when changing resource metadata, annotation resource fields, source-resource decoding, fixed evidence references or publication projection. This document covers batch 1 data contracts and lifecycle support. The implemented batch 2 query consumer is specified in [Task Resource Queries](./task-resource-query.md). See [Map Annotations](./map-annotations.md) for authorization, atomic revisions and host-controlled writes.

The approved business rule version is `task-resources-v1`: explicit user scope wins; otherwise task-resource queries consider related task sources, evidenced potential support, explicit resources in the current bound draft, task-adopted fixed publications and verifiable current-conversation supplements. Accessible data is not automatically task-related. Batch 2 implements the query tool; batch 3 UI and controlled Skills are specified in [Task Resource Experience](task-resource-experience.md).

## 2. Contracts and Ownership

`src/contracts/task-resources.ts` owns shared TypeBox schemas, types and decoders. `AnnotationFeature.resource` holds optional editable declarations. `resourceAssociation` separately records host-generated source entity association. `SituationObject.resourceData` optionally carries new source resource metadata; legacy `properties.availableCount` with `unit:'辆'` remains readable without automatic conversion into an individual entity.

Boundary decoders take `unknown` and return validated copies: `decodeTaskResource`, `decodeResourceAssociation`, `decodeSourceResource`, `decodeResourceCapability`, `decodeResourceCoverage` and `decodeConversationResourceSupplement`. `resourceSchema` is also used by the existing annotation tool parameter schema; model parameters cannot supply the separate host association.

Resource fields distinguish:

- `meaning`: actual resource, planned location, ordinary annotation, unspecified.
- `category` and `granularity`: controlled class and individual/aggregate/unknown.
- `quantity`: value or unknown, unit, what is counted, scope and evidence.
- `taskRelations`: task identity, assigned/potential-support/related/unconfirmed relation and evidence.
- `availability`: available/unavailable/unknown with evidence, time and conditions.
- `position`: actual/planned/estimated/unknown and whether geometry represents the resource or only a site.

Each fact retains its own basis. Evidence can be a declaration, a source revision reference or a fixed annotation object reference. These declarations and locators do not certify objective truth. `informationRole` continues to describe observation/assessment/plan independently.

The conversation-supplement contract carries a user-message locator, task/resource identity and report time. Its decoder checks structure only. The batch 2 Pi consumer verifies native-message existence and resource selection; semantic interpretation stays unverified. Do not build a second transcript store or pretend a model-supplied message ID verifies itself.

Source capability, task mapping, support rule and coverage types are an adapter handoff. Batch 2 implements optional explicit identity mapping and source-declared support relations; it does not require every source to support task queries. No new environment key or SQL table is added. The `task_resource_query` tool belongs to batch 2.

Coverage `partial` means incomplete coverage, not necessarily unread pages: it requires `asOf` and either a continuation cursor or a nonblank reason for a partial source that cannot continue. `complete` has a snapshot time and no next cursor; `unavailable`/`unsupported` require a reason and no cursor. Never present a complete page or a source's limited geographic coverage as a complete task inventory.

## 3. Authorization and Lifecycle

Normal create/add/update cannot supply a trusted `resourceAssociation`. A controlled exact source import may establish it only from explicit individual, actual-resource source metadata with an entity identifier. Plain source references, names, icons, coordinates and legacy aggregate counts are insufficient.

All structured source dependencies introduced through resource evidence or associations join the existing monotonic `requiredSystemIds`. Fixed annotation evidence must identify an accessible object in the same authorized task; inherit its source restrictions. Permission checks remain in `AnnotationService`, not model-supplied authority fields.

Ordinary object copying clears the host entity association; fixed-baseline derivation preserves the verified snapshot relation. Ordinary state, time and planned-position edits preserve identity; changing resource meaning, granularity or category incompatibly clears it. The declared attributes remain snapshots. Source geometry refresh preserves declared business fields and the association's original revision, and refuses refresh if the previously associated entity becomes missing, aggregate or different. Geometry refresh does not update availability or certify new facts.

Publishing preserves intentionally shared business declarations. Private annotation-evidence locators are replaced with an explicit unverified public declaration; private IDs, titles and text are not copied into that replacement. Public-baseline derivation uses the projected document, so removed private pointers cannot reappear. Source restrictions are not removed by this projection.

## 4. Compatibility

Use optional schemaVersion 1 fields and preserve absence. Never inject resource defaults into old objects or rewrite old snapshot hashes, receipts, composer text, source responses or spatial results. Strict readers, service validation and existing annotation-tool schemas must move together. A rollback binary must retain support for fields already written.

`resource` is a top-level replacement when edited, following existing annotation update semantics. Unrelated edits preserve it. Unknown counts are not zero; record counts are not entity counts. A resource declared in a plan can still be a real entity, while its geometry represents only a planned position.

## 5. Validation and Error Matrix

| Input / Condition | Required behavior |
| --- | --- |
| Negative or fractional count, invalid relation, category/unit mismatch | Reject with `INVALID_INPUT`; no partial revision |
| Missing optional metadata or valid unknown value | Preserve without inventing facts |
| Normal add/update contains host association | Reject; no client-authenticated identity |
| Inaccessible source/fixed annotation evidence | Reject through existing authorization, without leaking private content |
| Publication references private annotation evidence | Preserve shared declaration values, remove private locators |
| Legacy source count without new semantics | Keep legacy meaning; do not infer individual identity or assignment |
| Resource query capability unavailable | Consumer reports unsupported/partial relationship coverage; ordinary exact reads remain usable, never interpret unavailable discovery as zero resources |

## 6. Verification and Limits

Use synthetic B1-S01—B1-S12 data with independently stated business expectations. Current offline assertions verify shared decoding, actual service round trips, atomic errors, source imports, copy/refresh/publication/derivation, source-scope inheritance and unchanged legacy snapshots. Do not test an expected answer against itself or implement the second batch's aggregation merely to claim all business scenarios run end to end.

Run package typecheck, lint/boundaries, relevant Vitest, build and affected existing desktop annotation regressions. No paid model calls are required. Successful checks establish data/lifecycle behavior, not Agent accuracy, Skill benefit, actual source deployment or physical resource availability.

Wrong: one source record has `availableCount:3`, therefore import it as a verified single vehicle. Correct: retain its aggregate count semantics until an adapter provides explicit individual identity and evidence.
