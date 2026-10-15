# Implementation

- [x] Extend/validate config contract and defaults, preserving legacy map inputs.
- [x] Add owned vector/raster styles and stable basemap runtime; scoped errors/coverage/attribution.
- [x] Wire view selection and remembered preference, business namespacing and contrast, stable annotation readiness.
- [x] Add focused config/runtime tests and browser regressions including line/polygon continuation.
- [x] Run typecheck, lint, build and map/annotation checks; browser live Qingdao/Sydney acceptance and screenshots.
- [x] Review diff, update specs and source configuration docs; record remaining network/provider limitations.

Ownership: implement agent owns product code/config/docs and unit tests. Root owns browser acceptance/regression scripts, task records and final coordination. Work only in this worktree. Rollback is reverting this branch changes; no persisted business migrations.

完成实现、复核和浏览器验收；按用户要求提交至独立分支，暂不合并到主分支。详见 research/verification.md。

## Follow-up scope
- [x] Reveal hybrid minor/service/track+path groups at native style zoom thresholds 13/14/15, keeping widths subordinate to business strokes.
- [x] Add style and real-rendering hierarchy regression coverage; rerun retained drawing/state tests.
- [x] Review, rebuild and refresh the existing 5198 preview; document actual source coverage limitations.

Ownership: implement agent owns basemap style, unit tests and style docs/spec. Root owns E2E fixture/regression, task notes and preview. No commits or merges.

后续授权：用户已要求提交本轮修复，采用中文 Git 提交信息，继续保留在独立分支，不合并主分支。
