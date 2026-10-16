# 主线已提交快照合并复核

2026-10-16。按用户要求，将 main 的已提交快照 `75fc7f169cc82c34db989c0fb7ee5dda75bf9845` 合入 `codex/agent-map-spatial`。空间分析功能继续保持 planning，未新增实现或运行空间 Skill 评测。

## 1. 合并边界

- 合并前空间分支：`6dea240`，已含底图 `a79f1ae`。
- 固定合入 main@`75fc7f1`，包含 `d79a561` 结果投影、`7c43e45` 规划、`fdba343` 地图工具契约及评测、`75fc7f1` 交接可靠性保护测试及记录。
- main 工作区尚未提交的 `src/contracts/collaboration.ts`、`src/pi/collaboration-tools.ts` 和 `reliability-2026-10-16/` 未纳入，也没有修改它们。
- 初次输入短提交号时多写一位，Git 拒绝且未开始合并；随后使用已核实的完整哈希完成整合。
- 本轮在本地提交合并，不推送、不部署、不切换模型。

## 2. 唯一冲突与处理

冲突位于 `experiments/harness-lab/tests/e2e/annotations.spec.ts`。底图分支为 setup 增加可选底图配置，主线为同一参数位置增加模拟模型回复，并分别在文件末尾追加测试。

保留全部两侧测试；setup 的第二参数继续接收底图配置，第三参数接收模拟回复，默认回复行为保持不变。主线新增流式发布测试显式传入第三参数。除此以外没有手工修改产品代码。结果投影、底图、共享规范和其余测试均自动合并。

检查确认，合并后的 MapCanvas、标绘运行时、底图运行时及标绘样式与底图源提交相同。

## 3. 对空间分析方案的影响

架构仍可行，之前的结果投影同步前置条件已经满足：模型 content 与界面 details 的分工、固定结果入口和历史校验已进入当前分支，可在实施时直接复用。

工具说明整理也已合入，但 [主线问题记录](../../10-15-map-query-scope/issues.md) 仍报告局部范围扩大和实际筛选与意图错配。query.scope 候选没有进入默认产品，counts 没有改名。这次合并不等于模型解释问题已经修复，更不能替代空间分析的规则、完整性和 Skill 效果验收。

设计、实施计划、PRD 和任务状态说明已同步更新；保留原架构图、底图隔离约定、第一阶段范围和待审阅状态。

## 4. 验证环境

从解决冲突后的暂存树 `8078a4a6e817aa5fea4e6005f2780ddf3304e3b0` 导出隔离副本：

`/private/tmp/main-merge-check-imu2aqsu/experiments/harness-lab`

复用底图 worktree 已安装的依赖，核对 package-lock 一致；缓存、构建和浏览器产物均写入隔离目录。检查没有使用其他会话未提交源码，没有安装依赖，没有运行真实模型或业务通知。后续只更新本任务文档，没有改动被测产品/测试代码。

## 5. 检查结果及失败保留

| 检查 | 结果 |
| --- | --- |
| TypeScript | npm run typecheck 通过 |
| Lint 与依赖边界 | npm run lint 通过 |
| 生产构建 | npm run build 通过；保留已有大 chunk 提示 |
| 相关单元/集成测试 | 18 文件共 227 项；首轮 226 通过、1 项因沙箱禁止 127.0.0.1 监听失败。允许本地监听后仅复核该文件，5/5 通过；该 5 项与 227 项重复，不累计计算 |
| 六项桌面回归 | 首轮 4 通过、2 个底图红色像素断言失败，不能记成首轮全通过 |
| 原底图对照 | 导出 a79f1ae，以同样的单工作进程独立执行两个像素用例，2/2 通过 |
| 合并版隔离复核 | 停止其他检查负载后，用不变源码、断言和独立输出目录执行相同两项，2/2 通过 |
| 冲突/空白检查 | 无剩余冲突；产品代码与本任务文档 diff 检查通过。主线 source-plan.md 原有三处 Markdown 双空格换行原样保留 |

首轮像素失败发生时，断言使用的画布截图缺少预期红色线，附近的 trace 帧中可见标绘。原底图与合并版独立复核均通过，说明尚未复现稳定的合并回归，但不足以证明渲染时序不稳定已经修复；本轮不扩大为底图修复，也不放宽像素断言。保留首轮失败及两次独立复核记录，后续涉及地图渲染时继续关注。

实际命令（包目录中执行）：

```bash
npm run typecheck
npm run lint
npm run build
npm test -- --maxWorkers=2 tests/map-basemaps.test.ts tests/web/api.test.ts tests/annotation-results.test.ts tests/annotation-map-evidence.test.ts tests/situation-map-ui.test.ts tests/pi/annotation-hook-boundaries.test.ts tests/pi/annotation-source-history.test.ts tests/pi/annotation-workflow.test.ts tests/pi/annotations.test.ts tests/pi/composer-input.test.ts tests/pi/provider-payload.test.ts tests/collaboration/service.test.ts tests/pi/collaboration.test.ts tests/access.test.ts tests/probe-desktop-map.test.ts tests/probe-map-query-cases.test.ts tests/probe-map-query-scope.test.ts tests/probe-map-result-projection.test.ts
node node_modules/vitest/vitest.mjs run tests/probe-map-query-cases.test.ts --maxWorkers=1
CI=1 AXON_E2E_PORT=5296 npm run test:e2e -- tests/e2e/annotations.spec.ts --grep 'receipt buttons|native streamed|basemap switches|solid annotation|hybrid progressively' --workers=1
CI=1 AXON_E2E_PORT=5298 npm run test:e2e -- tests/e2e/annotations.spec.ts --grep 'solid annotation|hybrid progressively' --workers=1 --output=test-results-isolated
```

原底图对照目录为 `/private/tmp/basemap-control-i33l4mgq/experiments/harness-lab`，使用端口 5297 和相同两个用例。首轮失败 trace 位于合并验证目录的 `test-results/`，合并版复核位于 `test-results-isolated/`；没有覆盖首轮失败。以上仅为合并相关检查，不声称执行了全仓库所有测试、公开底图实地验收或真实模型可靠性验证。
