# 提交计划（用户已批准）

分支：`codex/expert-optional-trial`；固定基线：`codex/axon-r3a@1e99845`。

拟提交一个完整变更：`feat: 将专家试用调整为可选并保留发布校验`。

包含本次源码、回归测试、现行契约同步及本任务计划/验证证据；不包含其他 worktree 的改动。以下是本任务现有受控文件清单：

- `.trellis/spec/backend/authoring-r3a.md`
- `.trellis/spec/backend/capabilities-r2.md`
- `.trellis/spec/backend/capabilities-r3.md`
- `.trellis/spec/frontend/harness-lab.md`
- `docs/capability-center/requirements-delta.md`
- `docs/capability-center/roadmap.md`
- `experiments/harness-lab/README.md`
- `experiments/harness-lab/src/capabilities/management.ts`
- `experiments/harness-lab/src/contracts/capability-management.ts`
- `experiments/harness-lab/src/server/capability-management-routes.ts`
- `experiments/harness-lab/src/web/CapabilityManagement.tsx`
- `experiments/harness-lab/src/web/ExpertTrial.tsx`
- `experiments/harness-lab/tests/capability-management-api.test.ts`
- `experiments/harness-lab/tests/capability-management.test.ts`
- `experiments/harness-lab/tests/e2e/capability-management.spec.ts`
- `.trellis/tasks/11-16-expert-optional-trial/`（本任务计划、审查、日志与截图）

没有未识别的受控变更；本地依赖链接、缓存、dist 和 test-results 均由原规则忽略。完整单测183文件1849项复跑已通过；工程检查、桌面5项和独立审查均通过。用户随后明确回复“提交”，本清单已获批准。按本计划提交一次；不推送、不部署，不归档或标记用户产品验收通过。
