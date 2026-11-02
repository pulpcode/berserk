# Task Resource Interaction and Presentation

## Scope

Batch 3 connects the existing annotation editor, explicit composer references, resource results and controlled Skills. It does not add an Agent loop, resource registry, result store, dispatch approval or automatic writes. See [Task Resource Queries](task-resource-query.md) for calculation and authorization, and [Model Thinking](model-thinking.md) for execution configuration.

## Explicit references

`MapReferenceChips` presents existing `contextRefs` and fixed `annotationRefs`. Selection, drawing, highlighting and viewport changes do not create references. Existing `useComposerSelections` owns deduplication, per-draft isolation, submission consumption and failure recovery. Do not introduce a second reference-state system.

Source names are a display lookup, not a frozen business snapshot: the host queries the full source identity again when sending. Annotation references retain the explicitly selected revision/publication. Failed display lookup must not substitute a similarly named object. Unsaved edits remain local; an ordinary conversation does not require saving them. An explicit request to reference unsaved geometry keeps the existing saved-version protection.

## Resource form and imports

`ResourceFields` edits optional `TaskResource` declarations through the existing `FeatureEditor` save action. The shared decoder validates quantity, relationship, availability and position facts, including evidence and optional reported/effective/expiry times and conditions. Missing quantities remain null, explicit zero remains zero, and ordinary old shapes acquire no resource defaults unless edited.

`resource` is a complete server replacement. Browser comparison/merge treats its top-level fields independently, retaining untouched evidence and other task relations; nested facts remain whole values. A concurrent same-fact edit requires the existing explicit choice. Trusted `resourceAssociation` is readonly and never included in normal updates.

`POST /api/sessions/:id/annotation/from-source` is a thin route to existing `AnnotationService.fromSource`. It uses the ordinary formal/test-seat actor, strict service input, source and draft revision checks, cancellation, idempotent receipt and existing atomic transaction. The UI supplies an exact source reference and chosen existing layer; no arbitrary old-object association API is introduced. Ordinary copies do not inherit trusted association, and geometry refresh does not refresh availability declarations.

## Resource result cards

Only successful, nonmissing `task_resource_query` messages with a validated `resourceResult` render `ResourceResultCard`. Query, summarize and read have different titles. Read delivery does not imply another query, computation or save.

Display `statisticsScope` filters/time and summary record/item counts as the statistics subset. The reusable `items` list may include additional candidates; do not label it as the matching-only list. Unknown entity/quantity totals remain unknown alongside known partial values. Category, unit, quantity meaning and scope groups remain separate; the frontend does not implement business aggregation.

Data coverage, relationship coverage and spatial omissions have separate presentation. Per-record facts show source revision/query time or fixed annotation identity, evidence, times and conditions. Planned/missing position is not outside the area.

UI paging reloads the existing authorized session snapshot and locates the same successful fixed result before locally slicing ten items. It makes no model call or source query. A missing result, revoked authorization or failed read clears the old displayed result; no stale-cache fallback. The initial projection and every reread rely on existing server dependency authorization. No new HTTP result-read service or secondary storage exists.

## Skill delivery and verification

The controlled `map-annotations` and `spatial-analysis` catalog/body versions are 2; descriptions are parsed from those bodies and hashes cover exact deployed bytes. Explicit selection and normal `skill_read` remain the loading mechanisms. Only foreground map requests get the short method reminder; children/background do not gain resource or annotation authority.

Explicit user scope wins. Pure shapes retain ordinary spatial methods. Task-resource questions use the approved default discovery and evidence-based identity merging; the old rule requiring explicit joint-analysis wording does not prohibit that task workflow. Real ambiguity still requires targeted reading/clarification. Reading a Skill or displaying a correct card does not prove correct model reasoning or prose.

Run affected Vitest, typecheck, lint/boundaries, build and desktop Playwright. Test real services/native Pi with deterministic provider outputs, including unknowns, concurrent edits, imports, fixed history, pagination and revocation. Actual SDK payload tests and browser screenshots are distinct from live-model effectiveness. Batch 3 has zero real provider calls; no automatic fourth-batch evaluation.
