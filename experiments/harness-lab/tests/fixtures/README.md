# Local basemap fixtures

Synthetic MVT only; these files contain no third-party map data.

- `basemap-vector.pbf`: one primary road and empty OpenMapTiles companion layers, used by the original switch/retention regressions.
- `basemap-road-hierarchy.pbf`: five transportation features with `class` primary/minor/service/track/path. Each is a multiline spanning x=0..4096 at y=64+classIndex*128+n*640 (extent4096, MVTv2); the other seven required style source-layers are empty. Repeated rows keep each class visible across zoom thresholds and z14 overzoom, so browser tests can distinguish missing layers from data outside the viewport.
