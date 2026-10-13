# 提交计划（已获授权）

用户于 2026-10-13 明确要求先提交 Git，以下功能与已有发布记录作为 UI 优化前回退基线：

`feat: 实现会话独立地图标注与任务版本发布`

包含实现、依赖锁定、迁移、回归测试、规范和本任务设计／验证记录。包含已有部署记录，不包含源服务数据、凭据或临时验收目录。

## 文件范围

- `.trellis/spec/backend/index.md`
- `.trellis/spec/backend/map-annotations.md`
- `.trellis/spec/backend/seat-delivery.md`
- `.trellis/spec/backend/workbench.md`
- `.trellis/spec/frontend/index.md`
- `.trellis/tasks/10-12-conversation-map-annotations/check.jsonl`
- `.trellis/tasks/10-12-conversation-map-annotations/design.md`
- `.trellis/tasks/10-12-conversation-map-annotations/implement.jsonl`
- `.trellis/tasks/10-12-conversation-map-annotations/implement.md`
- `.trellis/tasks/10-12-conversation-map-annotations/prd.md`
- `.trellis/tasks/10-12-conversation-map-annotations/research/check-report.md`
- `.trellis/tasks/10-12-conversation-map-annotations/research/commit-plan.md`
- `.trellis/tasks/10-12-conversation-map-annotations/research/deployment.md`
- `.trellis/tasks/10-12-conversation-map-annotations/research/evidence.md`
- `.trellis/tasks/10-12-conversation-map-annotations/research/implementation-validation.md`
- `.trellis/tasks/10-12-conversation-map-annotations/research/pi-live-acceptance.md`
- `.trellis/tasks/10-12-conversation-map-annotations/task.json`
- `experiments/harness-lab/package-lock.json`
- `experiments/harness-lab/package.json`
- `experiments/harness-lab/scripts/probe-annotations.ts`
- `experiments/harness-lab/src/access/database.ts`
- `experiments/harness-lab/src/access/schema.ts`
- `experiments/harness-lab/src/access/store.ts`
- `experiments/harness-lab/src/annotations/service.ts`
- `experiments/harness-lab/src/annotations/store.ts`
- `experiments/harness-lab/src/annotations/validation.ts`
- `experiments/harness-lab/src/background/store.ts`
- `experiments/harness-lab/src/contracts/annotations.ts`
- `experiments/harness-lab/src/contracts/index.ts`
- `experiments/harness-lab/src/pi/annotation-input.ts`
- `experiments/harness-lab/src/pi/annotation-tools.ts`
- `experiments/harness-lab/src/pi/composer-input.ts`
- `experiments/harness-lab/src/pi/history-evidence.ts`
- `experiments/harness-lab/src/pi/lab.ts`
- `experiments/harness-lab/src/server/annotation-routes.ts`
- `experiments/harness-lab/src/server/app.ts`
- `experiments/harness-lab/src/web/ChatMessage.tsx`
- `experiments/harness-lab/src/web/TaskInformation.tsx`
- `experiments/harness-lab/src/web/annotations/AnnotationWorkspace.tsx`
- `experiments/harness-lab/src/web/annotations/FeatureEditor.tsx`
- `experiments/harness-lab/src/web/annotations/annotations.css`
- `experiments/harness-lab/src/web/annotations/helpers.ts`
- `experiments/harness-lab/src/web/annotations/map-runtime.ts`
- `experiments/harness-lab/src/web/annotations/useAnnotations.ts`
- `experiments/harness-lab/src/web/main.tsx`
- `experiments/harness-lab/src/web/situation/MapCanvas.tsx`
- `experiments/harness-lab/src/web/situation/MapContext.tsx`
- `experiments/harness-lab/src/web/situation/SituationView.tsx`
- `experiments/harness-lab/src/web/useComposerSelections.ts`
- `experiments/harness-lab/tests/annotations-acceptance.test.ts`
- `experiments/harness-lab/tests/annotations.test.ts`
- `experiments/harness-lab/tests/background/service.test.ts`
- `experiments/harness-lab/tests/e2e/annotations.spec.ts`
- `experiments/harness-lab/tests/pi/annotations.test.ts`

## 未识别的工作树变更

无。开始时已有的本任务规划目录也属于本次功能范围，已随实施更新；未归档其他活动任务。

已授权执行上述一项中文提交，不 push、不 amend。
