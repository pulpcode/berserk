# Professional map symbols and on-demand plotting

## 1. Scope / Trigger

Read when changing the single-map plotting tools, `web/map-symbols`, annotation rendering or professional symbol forms. The product targets desktop browsers, including narrow split panes. Real GPS/AIS feeds and mobile layouts are outside this feature.

## 2. Signatures

- `contracts/map-symbols.ts`: `MAP_SYMBOLS`, `getMapSymbol(id)`, `MAP_SYMBOL_ICON_SIZE` are the shared controlled catalog.
- `web/map-symbols/index.ts`: `symbolAssetUrl(id)`, `symbolImageId(id)`, `resolveMapSymbol(style)` and `ensureMapSymbols(map): Promise<string[]>` (failed IDs).
- `AnnotationMapEdit.paused` controls interaction suspension without discarding TerraDraw's unfinished geometry. The annotation runtime owns editor interaction; `SituationView` remains the independent source-query owner.
- `annotations/rotation-handle.ts`: retained local pointer control; `FeatureEditor` exposes a guarded imperative heading setter into its existing form state.
- Backend fields and strict validation are specified in [Map annotations](../backend/map-annotations.md).

## 3. Contracts

There is one retained MapLibre map. `标绘工具` is a local disclosure, initially closed; opening or closing it does not create a session, document, revision, publication or task-current choice. Closing pauses active editing and retains target, form and unfinished draw state; reopening must not automatically capture clicks. A deliberate resume continues the same operation. Hiding the target pauses interaction without discarding vertices. True identity/task/session/document changes retain existing dirty-data and late-response protections.

Entry context distinguishes global read-only situation, task-current read-only plans, and writable conversation drafts. Global entry selects an existing task; task entry returns to its existing task home to select a conversation. These hints/navigation never create a session or draft. Navigation from an in-map entry retains the dirty-input confirmation, including when a refresh failure temporarily removes writable context.

Clicking a catalog symbol in the tools dock immediately starts one point placement using the existing captured target/start identity. Block it while saving, awaiting a receipt, holding a dirty form, already drawing, or targeting a hidden/non-writable layer. Property-editor symbol replacement only changes that object’s local form and never starts drawing.

Object forms prioritize a compact symbol row with an adjacent replacement control, name, information role and applicable heading. Upright symbols omit the heading input. Replacement is a local disclosure that never dirties the form by itself; choosing a symbol updates the same preview, closes the catalog and returns focus to the replacement button. Typing or pressing Enter in catalog search never dirties or submits the object form. One “更多属性” section contains size, applicable styles, label, layer and note; coordinates and business JSON are nested disclosures. Explicit coordinate-add keeps both the extra-properties and coordinate sections open. Only display styles used by the current geometry/symbol; professional symbol color means label color, never glyph recoloring. Hidden legacy style values, notes and business attributes remain intact on save. Scroll the field body independently from save/cancel so narrow desktop docks retain reachable actions and last fields. Existing form previews, validation and dirty guards remain intact.

Source refresh does not mutate annotation revisions, clear form input or move the camera. Inspecting a source does not change the captured edit destination. Save, publish and adopt remain separate existing service operations; adopted plans do not become observations. New ordinary annotations default to `plan`; legacy missing roles remain unspecified. Copied source geometry is a snapshot, not a tracking binding.

Professional point images use MapLibre symbol layers with overlap enabled, with group/layer/object hit identity. HTML labels stay screen-upright. The symbol's intrinsic orientation and explicit true-north `heading` are distinct: omitted heading preserves source orientation; east-facing artwork with heading 0 renders at -90 degrees. Upright signs reject a heading at the service boundary. `iconSize` is 20–64 CSS px, default 32; legacy `size` remains the radius of a generic point. Line arrows are derived display, never extra persisted polygon geometry.

A direction-capable professional point exposes a rotation handle only while its writable property form and target/preview are visible and no geometry edit or save/receipt is pending. The numerical heading field remains the precise keyboard alternative. Both controls update the same local form; pressing without moving must not materialize an omitted heading. Rotation changes neither coordinates nor camera, and persists only through explicit save. Cancel keeps the saved heading.

The handle is owned independently of business-layer redraws and retains its pointer capture across preview updates. Object identity, visibility, permissions and pending state fence callbacks. Pointer release/cancel/lost capture, window blur, hidden editing and runtime destruction release capture and restore only previously enabled map handlers. Hidden tools never begin capturing on reopen.

For the current `icon-rotation-alignment: map` / `icon-pitch-alignment: viewport` renderer, use the projected local east tangent at the symbol anchor as the screen rotation baseline (the installed MapLibre symbol shader uses that tangent). Apply the explicit heading or intrinsic heading to this baseline. Do not derive arbitrary ground bearings from `unproject(pointer)` or use only `screenAngle + mapBearing` on tilted views. Keep existing glyph rendering rules unchanged.

Bundle only controlled SVGs. `provenance.json` distinguishes original vector paths, vector transcriptions of source bitmaps and project extensions. Standard shapes/colors are independent of status. Images are registered once per map at 128 px / pixelRatio 4; basemap ownership excludes these business images. Failure gets a neutral question mark and visible notice. Do not infer a fire engine subtype from a source resource's quantity/name.

Successful saves of new or existing objects preserve center, zoom, bearing and pitch. Initial document framing and deliberate locate actions remain available. Changing panel layout resizes the existing canvas and preserves camera state. The non-editor symbol catalog keeps its existing desktop dock. While the object form is visible, the retained map fills the complete available width and height and the same editor nodes form a right-top floating card. The card shrinks to its content, expands for disclosures, and caps its height below the map toolbar and above basemap/attribution controls. A regular div around the fieldset owns scrolling at that limit; the fieldset only retains disabled/form semantics, because its anonymous content box is not a reliable flex scroll container. Keep the outer form non-scrollable (`overflow: clip` in this implementation), so focusing low fields cannot move it and displace its footer. The header and save/cancel stay reachable. Card exterior space never intercepts map gestures, including narrow or short desktop panes. Do not remount the map/form, move the camera automatically or persist panel dimensions for this layout. Actual SVG source records and approved sample are the visual authority; historical dual-mode mockups are not.

## 4. Validation & Error Matrix

| Condition | Behavior |
| --- | --- |
| Open/close tools with no writable session | Read-only explanation; no implicit create/write |
| Select catalog symbol / replace property symbol | Start one point placement / update local form only |
| Rotate direction-capable point | Same local heading; no coordinate/camera/write change until save |
| Pointer cancel/lost capture or edit hidden | Release capture, restore prior gesture state |
| Fixed-upright / ordinary / read-only point | No rotation handle |
| Save new or existing object | Preserve center, zoom, bearing and pitch |
| Narrow desktop property panel | Independently scrollable fields and reachable save/cancel |
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
- Rotation: actual mouse drags, 0/90/359 and wraparound, omitted-heading press without movement, reverse numeric synchronization, saved/canceled headings, stable handle identity, pointer cleanup and gesture restoration, hidden/read-only/fixed-upright guards, projected glyph pixels versus handle on rotated/tilted maps.
- Service/Pi roundtrips and atomic rejection (see backend spec).
- Browser tests: same-map identity/camera, no writes on disclosure, unfinished draw retention/resume, retained form on source inspection/refresh, independent preview visibility, explicit save/publish/adopt, entry navigation without writes, direct symbol placement versus property replacement, camera preservation on new/existing save, content-sized floating editor, complete map dimensions, exterior pointer access, reachable narrow/short desktop form footer, visible pixels and overlap selection.
- Run typecheck, lint, build and affected annotation/situation/basemap tests with local tile fixtures. Do not equate mocked source updates with production GPS integration.

## 7. Wrong vs Correct

Wrong: merge source and annotation objects by display name, recolor standard glyphs to represent status, or rebuild the map when toggling tools.

Correct: keep full source reference identity and annotation group/layer/object identity, render the controlled glyph unchanged, label information nature separately, and resize/suspend the existing runtime.
