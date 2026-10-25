# Professional Symbol Contract

## 1. Scope / Trigger

Read when extending professional annotation styles, information nature or shared geometry validation. Existing authorization, revisions, source restrictions and receipts remain owned by [Map annotations](./map-annotations.md).

## 2. Signatures

- `contracts/map-symbols.ts`: `MAP_SYMBOLS`, `getMapSymbol(id)`, `MAP_SYMBOL_ICON_SIZE`.
- `contracts/annotations.ts`: optional `AnnotationStyle.symbolId/iconSize/heading/lineEnd`; `AnnotationFeature.informationRole`; matching optional `AnnotationReadField`.
- `validateAnnotationGeometry(value, kind): SituationGeometry` is shared by saved-feature validation and browser previews. Its coordinate, capacity and polygon rules are unchanged.
- Existing `annotation_action` / `annotation_read` / `annotation_from_source` remain the only model path; no new write endpoint.

## 3. Contracts

Professional point symbols use the pure shared `src/contracts/map-symbols.ts` catalog (22 entries: 20 XF/T 3013—2020 symbols and two explicitly labeled application extensions). Standard IDs are `xf3013-2020.<clause>`; the extensions are `app.rescue-inflatable-boat` and `app.rescue-vessel`. IDs retain their meaning after persistence. The catalog owns category, aliases for search only, provenance, asset key, default 32 px size, center anchor and heading/upright orientation; local assets and extraction provenance live in `src/web/map-symbols/`. Do not infer a vehicle subtype from a source name, count, or ordinary source reference.

`AnnotationStyle.symbolId` is accepted only for catalog-backed `kind:point`. Optional `iconSize` is a finite 20–64 px value, distinct from legacy `size`; optional `heading` is finite clockwise true-north bearing in [0,360), allowed only for catalog entries with heading orientation. Both require a valid symbolId. Soldier, assembly location and drone symbols remain upright and reject heading even when zero. A missing heading retains the artwork's intrinsic orientation and is not an observed heading. `lineEnd:none|arrow` is line-only display metadata and never adds arrow vertices to persisted geometry. Legacy circle/square/triangle and color/size semantics remain readable; professional artwork keeps its standard colors independently of lifecycle or business status.

`AnnotationFeature.informationRole?:observation|assessment|plan` declares field record, assessment or intended plan. The service never supplies a missing role, including source-copy add. Old snapshots keep absent fields and their hashes; UI creation explicitly chooses plan, while Agent input declares intent. Role is an opt-in `AnnotationReadField`, not an unconditional basic summary field. Saved snapshots, copies, public projection, publication derivation, comparison, hashes, idempotency and explicit source refresh preserve the new metadata. Publishing/adopting does not turn plan into observation or arrival. Merged object changes undergo the same geometry/style/role validation before committing any operation in the batch. Pi schemas generate their bounded symbol choices from this catalog and use the same service validation for cross-field constraints.

These are optional schemaVersion 1 extensions, with no SQL migration or historical rewrite. Deploy the frontend, backend validators/readers and Pi schema together. Rolling back the UI must retain readers supporting the new fields; an old binary's strict whitelist cannot read new documents safely.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Unknown symbol, professional style on non-point, iconSize without symbol | INVALID_INPUT, no batch writes |
| Non-finite/out-of-range size or heading | INVALID_INPUT, no batch writes |
| Heading on upright symbol, even zero | INVALID_INPUT |
| lineEnd on non-line / unknown role | INVALID_INPUT |
| Invalid preview geometry | No valid preview; retain raw form for correction, never repair automatically |
| Existing old snapshot without role/symbolId | Read unchanged, no defaults injected |

## 5. Good / Base / Bad Cases

Good: apply a plan with `symbolId:app.rescue-inflatable-boat`, `iconSize:48`, `heading:30`; read explicitly requested style and informationRole; copy/publish/derive/refresh retain them.

Base: old generic circle/square/triangle keeps the original radius and missing role.

Bad: treat resource count as a specific vehicle, accept a remote SVG URL as symbolId, or apply part of a batch before rejecting an invalid heading.

## 6. Tests Required

`map-symbol-contracts.test.ts`, `annotation-geometry.test.ts`, `annotations.test.ts`, `annotation-from-source.test.ts` and `pi/annotations.test.ts` verify catalog provenance, bounds/combinations, shared preview/save geometry agreement, atomic rejection, fixed snapshots/hash/diff, copy/publish/derive/adopt/refresh, schema and receipt roundtrips.

## 7. Wrong vs Correct

Wrong: reimplement browser polygon acceptance, default historical roles to plan, or maintain a separate Pi symbol enum.

Correct: import the pure shared geometry validator and controlled catalog; preserve missing fields; generate bounded schema choices from the catalog and validate merged changes through the existing service.
