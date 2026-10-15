# Situation Map and Mock Controls

## 1. Scope / Trigger

Read for changes to spatial source data, map UI, object references, and simulation controls. This is a capability-validation scene, not a final operational data model. MapLibre renders configurable Esri imagery / OpenMapTiles-compatible vectors and independent business overlays. Do not render an unconditional “模拟态势” canvas badge or label the shared canvas as simulated; dataset provenance belongs to its actual source, while basemap attribution remains visible. No routing engine, geographic access model, source-write Agent tool, or Pi core change is introduced.

## 2. Signatures

- `GET /api/context/map-config` exposes public basemap settings and actor-specific `simulationEnabled`, never business-source tokens or private URLs; public basemap URLs and attribution are intentionally exposed.
- `POST /api/context/situation`, `POST /api/context/reports/search`, and `GET /api/context/reports/:systemId/:reportId` use existing `ContextService` permissions.
- `/api/simulation` and its `object-updates`, `report-updates`, `actions/:id`, `actions/:id/send` routes proxy only the configured mock control service.
- Optional `SituationObject.geometry` is bounded GeoJSON Point, LineString, or Polygon in WGS84 longitude/latitude order. Road properties may contain `passability`; legacy empty properties and objects without geometry remain valid.
- `npm run probe:situation-map -- serve` creates an isolated trial without sending notifications or model messages. `verify` explicitly performs one real model request.

## 3. Contracts

Use complete references, never names alone. Map buttons derive from actual query data; Markdown answer links are enabled only when their full reference and revision match recorded evidence. Re-query current authorized data when opened. Show historical evidence revision separately from current state; never overwrite the original evidence. Missing geometry produces a list entry, not an invented location.

Global `/situation`, task map, and nonmodal conversation/information sidepanel share components. Global/task/conversation maps fill the available work area with one “图层与对象” panel containing source filters and the category/object tree, plus dismissible object details. Source-query ownership remains in SituationView; local visibility does not filter objects out of the browser or its result counts. Overlay panels must not intercept uncovered map gestures or cover attribution and navigation controls. Task candidates union explicit object references and area matches. Task filters never grant data access or establish task impact. Key responses and selected drafts to the captured identity/view/task; cancel superseded fetches and ignore late responses. Source errors retain applicable existing data with an error, not a fresh empty-success state.

Keep Markdown renderer component types stable across streaming updates. Pass changing map evidence through props/context without creating a new anchor component type on every render; remounting ordinary links loses keyboard focus and can incorrectly collapse the existing process display. Preserve the existing focus regression tests.

Context object selections load at send time through the host and persist in Pi native custom input; see `conversation-references.md`. Browsing, opening links, selecting objects and preparing a draft do not start model requests.

Mock controls require explicit enabled configuration, read permission on both intel and situation systems, and management of both configured ingress sources. Credentials for query, control and ingress are independent. The browser cannot select service identities or credentials. Nonprivileged users do not receive control state or controls.

The mock source persists a bounded SQLite snapshot containing facts, revisions and frozen notification actions. Save uses `clientActionId` and expected revision; repeating identical input returns the same action, conflicting reuse fails. Saving facts and the pending action is atomic. Sending is separate, uses the saved stable source message ID, and checks ingress receipts after uncertainty; a send failure does not undo source facts. A fresh instance has fresh IDs and data directory; persistent map instances reject legacy reset/advance operations. Old Axon tasks and files are never cleared by the test driver.

Control state projects only the latest revision per report and the latest 20 operations; older revisions/actions remain addressable. Only this control-state response has a 2 MiB bound. Ordinary queries and composer facts retain their 256 KiB limits.

### Basemap contract and isolation

`src/contracts/map.ts` owns `BasemapConfig`, WGS84/Web Mercator XYZ metadata, the imagery/road/hybrid enum, defaults and legacy single-raster normalization. Context config validates supported coordinates, finite ordered Mercator bounds, native integer zoom 0–24, HTTP(S) endpoints, attribution and mutually exclusive vector TileJSON/XYZ endpoints. Legacy config remains readable. Defaults use Esri World Imagery and global OpenFreeMap OMT-compatible planet data; boat regional tiles must never be advertised as global coverage. No business geometry or persistence migration is involved.

`MapCanvas` retains one MapLibre instance and annotation runtime. `basemap-runtime.ts` exclusively owns generated `basemap:*` source/layer IDs below `business:anchor`; business rendering IDs use `business:*`. View changes toggle layers, retries/config changes replace only owned basemap resources. Never use `setStyle`, remount the canvas or call annotation restore to switch a basemap. Sources load on demand and old source-generation errors are ignored. Preserve unfinished TerraDraw geometry, camera, selection and visibility. Keep original business colors with white casings/label halos on imagery and light roads.

Hybrid road detail uses separate category layers with native `minzoom`: minor at z13, service at z14, and dashed track/path at z15. Detail line widths cap at 1.8/1.4/1.0 px with restrained opacity and dark casings, below existing major roads and all business layers. Minor/service names appear at z15/z16 with collision avoidance; paths remain unlabeled. Preserve the road view's existing hierarchy. Use top-level zoom interpolation for camera paint and layer minzoom for reveal thresholds; do not put zoom conditions into feature filters. Above the vector source's native z14, these layers reveal features already present in overzoomed data, never manufacture missing detail or change source coordinates. Validate style syntax, category thresholds, width caps and actual rendered fine-road pixels.

Public source metadata drives active-source attribution, viewport partial/outside-coverage notices and native detail warnings. Higher zoom overzooms without moving the camera; lower-than-minimum zoom prompts zoom-in. Tile/TileJSON failures bubble with their current source ID, retain business layers, and expose basemap-only retry; loading after later pans also has a bounded timeout. Confirmed completion from the current source generation clears only timeout failures; explicit source errors remain until retry. MapLibre 6.4 renders failed glyph ranges locally through its native fallback rather than emitting a source error. WebGL failures open the object browser. Use `tests/map-basemaps.test.ts` for config/style/runtime contracts and local-fixture browser regressions for actual editor retention. See `experiments/harness-lab/docs/map-basemaps.md` for deployment examples and limits.

## 4. Validation & Error Matrix

| Condition | Behavior |
| --- | --- |
| Missing source permission / control grant | Existing safe denial; no source credentials or private state |
| Stale object/report revision | Conflict; refresh and review before a new save |
| Source unavailable | Explicit failure; retain applicable loaded UI data |
| Public tiles unavailable / no WebGL | Explain map failure; object list and queries remain available |
| Invalid/unverified answer link | No map action from untrusted prose |
| Old evidence opened | Current query plus old revision label, no history substitution |
| Selection query incomplete/too large | Preparation fails before model use |

## 5. Good / Base / Bad Cases

Base: an authorized seat opens the current road without any model call. Good: overall seat saves a synthetic road closure, reviews the frozen notice, then sends it into the existing processing pipeline. Bad: browsing a road emits a notification, inferring geometry from a name, or using a selected task as a substitute for source authorization.

## 6. Tests Required

Cover geometry compatibility, actual local HTTP permissions, separate save/send, idempotency/CAS, source restart, native reference history and identity/draft boundaries. `situation-map.spec.ts` intercepts public tile URLs with a local fixture. Automated pan/zoom must not fetch public OSM tiles. Manual connectivity and visual alignment are separate acceptance items; WebGL fallback alone does not prove map rendering. Retain real model outputs, including absent Markdown links and reasoning errors, separately from deterministic test results.

## 7. Wrong vs Correct

Wrong: pass source bodies from the browser directly to the model, or query current sources when reconstructing old composer history. Correct: the host obtains source facts once at send time, validates complete coverage, and stores actual results through Pi's existing public custom-message API.

Wrong: copy approximate road coordinates and claim basemap alignment. Correct: use attributed real OSM way nodes for road geometry, label synthetic states/resources, and retain provenance in the mock source README.
