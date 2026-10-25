# Professional map symbols and on-demand plotting

## 1. Scope / Trigger

Read when changing the single-map plotting tools, `web/map-symbols`, annotation rendering or professional symbol forms. The product targets desktop browsers, including narrow split panes. Real GPS/AIS feeds and mobile layouts are outside this feature.

## 2. Signatures

- `contracts/map-symbols.ts`: `MAP_SYMBOLS`, `getMapSymbol(id)`, `MAP_SYMBOL_ICON_SIZE` are the shared controlled catalog.
- `web/map-symbols/index.ts`: `symbolAssetUrl(id)`, `symbolImageId(id)`, `resolveMapSymbol(style)` and `ensureMapSymbols(map): Promise<string[]>` (failed IDs).
- `AnnotationMapEdit.paused` controls interaction suspension without discarding TerraDraw's unfinished geometry. The annotation runtime owns editor interaction; `SituationView` remains the independent source-query owner.
- Backend fields and strict validation are specified in [Map annotations](../backend/map-annotations.md).

## 3. Contracts

There is one retained MapLibre map. `标绘工具` is a local disclosure, initially closed; opening or closing it does not create a session, document, revision, publication or task-current choice. Closing pauses active editing and retains target, form and unfinished draw state; reopening must not automatically capture clicks. A deliberate resume continues the same operation. Hiding the target pauses interaction without discarding vertices. True identity/task/session/document changes retain existing dirty-data and late-response protections.

Source refresh does not mutate annotation revisions, clear form input or move the camera. Inspecting a source does not change the captured edit destination. Save, publish and adopt remain separate existing service operations; adopted plans do not become observations. New ordinary annotations default to `plan`; legacy missing roles remain unspecified. Copied source geometry is a snapshot, not a tracking binding.

Professional point images use MapLibre symbol layers with overlap enabled, with group/layer/object hit identity. HTML labels stay screen-upright. The symbol's intrinsic orientation and explicit true-north `heading` are distinct: omitted heading preserves source orientation; east-facing artwork with heading 0 renders at -90 degrees. Upright signs reject a heading at the service boundary. `iconSize` is 20–64 CSS px, default 32; legacy `size` remains the radius of a generic point. Line arrows are derived display, never extra persisted polygon geometry.

Bundle only controlled SVGs. `provenance.json` distinguishes original vector paths, vector transcriptions of source bitmaps and project extensions. Standard shapes/colors are independent of status. Images are registered once per map at 128 px / pixelRatio 4; basemap ownership excludes these business images. Failure gets a neutral question mark and visible notice. Do not infer a fire engine subtype from a source resource's quantity/name.

Changing panel layout resizes the existing canvas and preserves camera state. Wide tools dock alongside the map; narrow desktop panes retain usable map and form areas. Actual SVG source records and approved sample are the visual authority; historical dual-mode mockups are not.

## 4. Validation & Error Matrix

| Condition | Behavior |
| --- | --- |
| Open/close tools with no writable session | Read-only explanation; no implicit create/write |
| Collapse with unfinished geometry | Pause and retain; explicit resume |
| Source refresh during form/draw | Only source layer/data updates |
| Source/reference selected during editing | Read-only detail; retain captured form/target |
| Asset decode failure | Neutral selectable fallback plus notice |
| Unknown symbol or invalid role/size/heading | Service rejects entire operation; preserve local input |
| Save conflict/uncertain receipt | Existing CAS/receipt handling; no silent retry or discard |
| Hidden draft / pending preview | Independent visibility; no automatic task-current adoption |

## 5. Good / Base / Bad Cases

- Good: place an extended rescue boat as a plan; inspect a source, collapse/resume tools, save, publish, explicitly adopt. Source quantities and geometry are unchanged.
- Base: an old circle/square/triangle without role reads and renders with original size and unspecified information nature.
- Bad: collapsing calls `draw.stop()` and clears unfinished vertices; opening creates a draft; publishing implies vehicle arrival; rendering paints all standard red symbols green based on status.

## 6. Tests Required

- Catalog/provenance/asset completeness; source kind and shape distinction for the three boat types; source-relative direction conversion and legacy fallback.
- Service/Pi roundtrips and atomic rejection (see backend spec).
- Browser tests: same-map identity/camera, no writes on disclosure, unfinished draw retention/resume, retained form on source inspection/refresh, independent preview visibility, explicit save/publish/adopt, narrow desktop layout, visible pixels and overlap selection.
- Run typecheck, lint, build and affected annotation/situation/basemap tests with local tile fixtures. Do not equate mocked source updates with production GPS integration.

## 7. Wrong vs Correct

Wrong: merge source and annotation objects by display name, recolor standard glyphs to represent status, or rebuild the map when toggling tools.

Correct: keep full source reference identity and annotation group/layer/object identity, render the controlled glyph unchanged, label information nature separately, and resize/suspend the existing runtime.
