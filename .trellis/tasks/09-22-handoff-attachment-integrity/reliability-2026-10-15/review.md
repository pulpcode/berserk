# P0—P1 独立质量审查

2026-10-15。审查范围：本轮三个测试文件的 diff、audit.md / plan.md / verification.md / protection-tests.md，以及适用的交接、访问、HITL、前端规范。按任务书首轮限制，不修改业务实现，不执行付费模型或生产操作。

## Findings (fixed)

无。新增测试及方案未发现需要机械修复的缺陷；未修改他人文件。

- 固定副本用等长不同内容验证摘要保护；缺失和损坏分别覆盖提交前、合法提交后的导入，无工作/回执与目标文件不覆盖均有断言。
- 账号停用用既有 AccessStore 操作，经真实 HTTP 身份入口验证两种回执查询及重复提交被拒绝；已有合法工作保留。
- 超时测试先观察真实 pending 确认，再等待已有整轮期限，检查准备单过期、晚批准拒绝、无调用提交及无工作。沿用既有 1800ms 期限测试方式，没有新增产品时限。
- 变更仅为测试与任务材料，无 src、SDK、锁文件、权限、提示词或存储契约变更，因此无需改写 `.trellis/spec/` 的产品契约。

## Findings (not fixed)

- **既有展示歧义，留待审阅 D1**：`src/web/InteractionCard.tsx` 对工具 failed 显示“执行失败”“工具返回（未完成）”；既有 Pi before/after commit 故障测试证明，after 分支已经保存工作及回执，工具仍会失败。当前文案可能被理解为业务未发生。此为产品文案判断，且本轮禁止业务修改，未修；plan.md 已限定为 handoff 的中性说明，不新增恢复/补提交机制。
- **验证边界，非新增代码缺陷**：真实 Docker 计算及自然语言选片未执行；C08 其他权限转换和 U01 部分交互组合未完全覆盖。verification.md 已明确列出，不能据本轮绿测关闭原问题或宣称全部场景稳定。

## Verification

- Lint：**pass**。本审查执行 `npm run lint`，exit 0；`final-lint.log`。
- TypeCheck：**pass**。本审查执行 `npm run typecheck`，exit 0；`final-typecheck.log`。
- Diff check：**pass**。本审查执行 `git diff --check`，exit 0。
- Tests：**pass（核对既有本轮日志，未重复运行）**。修改前三个相关层面共 14 文件 / 316 项确定性基线；桌面浏览器 32 项；修改后三文件 69 项。新增 6 个实例替换原 1 个，净新增 5 项；316 与 69 有重叠，不相加为独立总数。
- Build：主代理基线日志通过；本轮仅改测试，未重复构建。

所有日志位于 `.local/handoff-reliability-20261015/`。浏览器 handoff 走真实本地服务与确定性 provider，通用 HITL 使用浏览器替身；两者均不是付费模型证据。首次 localhost EPERM 中断由 verification.md 单独记录，没有混入成功计数。

结论：本轮 P0—P1 材料与保护测试可交付审阅。未发现新增阻断问题；不代表 D1 已实施，也不代表真实模型/容器验收完成。
