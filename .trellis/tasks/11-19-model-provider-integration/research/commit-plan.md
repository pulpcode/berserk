# 待确认的提交清单

建议一个提交：`feat: 接入多平台模型并支持 Kimi Code`。

范围包含此次功能、兼容回归、方案与规范、当前任务记录。所有文件均由本次任务修改，无不明文件；原 feat/chat-rendering-c 工作区的未提交内容不包含。原分支未提交、未推送；用户后续授权的4316部署已完成，见验证记录。

## 文件

- `.trellis/spec/backend/harness-lab.md`
- `.trellis/spec/backend/index.md`
- `.trellis/spec/backend/model-thinking.md`
- `.trellis/spec/backend/task-access.md`
- `.trellis/spec/frontend/harness-lab.md`
- `.trellis/tasks/11-19-model-provider-integration/check.jsonl`
- `.trellis/tasks/11-19-model-provider-integration/design.md`
- `.trellis/tasks/11-19-model-provider-integration/implement.jsonl`
- `.trellis/tasks/11-19-model-provider-integration/implement.md`
- `.trellis/tasks/11-19-model-provider-integration/prd.md`
- `.trellis/tasks/11-19-model-provider-integration/research/baseline.md`
- `.trellis/tasks/11-19-model-provider-integration/research/commit-plan.md`
- `.trellis/tasks/11-19-model-provider-integration/research/validation.md`
- `.trellis/tasks/11-19-model-provider-integration/task.json`
- `docs/mvp/model-provider-integration.md`
- `experiments/harness-lab/.env.example`
- `experiments/harness-lab/README.md`
- `experiments/harness-lab/src/contracts/index.ts`
- `experiments/harness-lab/src/pi/controlled-stream.ts`
- `experiments/harness-lab/src/pi/lab.ts`
- `experiments/harness-lab/src/pi/model-runtime.ts`
- `experiments/harness-lab/src/pi/prompt-suggestion.ts`
- `experiments/harness-lab/src/pi/work-activity.ts`
- `experiments/harness-lab/src/server/app.ts`
- `experiments/harness-lab/src/server/auth.ts`
- `experiments/harness-lab/src/server/config.ts`
- `experiments/harness-lab/src/server/model-settings.ts`
- `experiments/harness-lab/src/web/ModelCatalogSettings.tsx`
- `experiments/harness-lab/src/web/ModelPicker.tsx`
- `experiments/harness-lab/src/web/ModelSettings.tsx`
- `experiments/harness-lab/src/web/PlatformSettings.tsx`
- `experiments/harness-lab/src/web/Settings.tsx`
- `experiments/harness-lab/src/web/TaskHome.tsx`
- `experiments/harness-lab/src/web/main.tsx`
- `experiments/harness-lab/src/web/model-settings.css`
- `experiments/harness-lab/src/web/useChat.ts`
- `experiments/harness-lab/tests/access.test.ts`
- `experiments/harness-lab/tests/admin-personal-access.test.ts`
- `experiments/harness-lab/tests/admin-personal-runtime.test.ts`
- `experiments/harness-lab/tests/capability-management-api.test.ts`
- `experiments/harness-lab/tests/e2e/administrator.spec.ts`
- `experiments/harness-lab/tests/e2e/chat.spec.ts`
- `experiments/harness-lab/tests/e2e/model-selection.spec.ts`
- `experiments/harness-lab/tests/model-config.test.ts`
- `experiments/harness-lab/tests/pi/mcp-runtime.test.ts`
- `experiments/harness-lab/tests/pi/model-catalog.test.ts`
- `experiments/harness-lab/tests/pi/model-platforms.test.ts`
- `experiments/harness-lab/tests/pi/model-settings.test.ts`
- `experiments/harness-lab/tests/pi/model-thinking.test.ts`
- `experiments/harness-lab/tests/pi/multi-provider-context.test.ts`
- `experiments/harness-lab/tests/pi/provider-payload.test.ts`

## 提交约束

依 .trellis/workflow.md Phase 3.4："Present the plan once, ask for one-shot confirmation"。最终检查完成后请用户一次确认再执行git add/commit；不推送。真实Kimi验收待凭证，因此任务暂不归档。
