# Design

## Boundary
MapConfig / context parser / context route defaults carry public basemap metadata. Existing API and useApi storageKey are reused. No database/schema changes. MapCanvas creates one MapLibre instance and annotation runtime for its lifetime. A small basemap module manages exclusively prefixed sources and layers beneath a permanent business anchor. Never setStyle or rebuild map to switch/retry. Rename business render IDs only, never GeoJSON identity.

## Data and rendering
Default imagery: Esri World_Imagery XYZ raster (tile/{z}/{y}/{x}), configurable URL, bounds, native zoom and attribution. Default roads: OpenFreeMap planet TileJSON (OpenMapTiles 3.16 compatible, native z0–14, global Mercator bounds), glyphs https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf. Use owned minimal Positron-inspired OMT layers based on boat regions.js (land/water/building/transportation/place). No arbitrary remote style framework. Roads and hybrid share vector data, with separate visibility/palette. Imagery and road source metadata allow regional deployment replacements. Reject GCJ02/BD09 and incompatible projection rather than silently shifting data. Legacy single-raster config remains readable/normalized for current config/tests.

## State
Selection remembers only basemap view via client.storageKey; config default applies initially. No inferred scene from text or camera; defaultView is explicit scene/deployment input. Changing config does not reset chosen view. Stable callbacks/runtime separate from React config/view changes. Switching toggles owned layer visibility synchronously. Config replacement/retry removes only owned sources/layers, scopes late errors to current source generation; drawing source/layers remain. Attribution lists active sources with safe links. Coverage is viewport-aware, zoom above native detail is identified without moving camera. Basemap errors do not invoke business map unavailable fallback. Use retry that retains the map and editor.

## Validation
Fixed local fixtures for repeatable automated tests; live provider access only in bounded manual browser acceptance. Qingdao (120.38,36.07) and Sydney (151.21,-33.86), explicit ports/offshore positions. No public OSM raster scanning.
