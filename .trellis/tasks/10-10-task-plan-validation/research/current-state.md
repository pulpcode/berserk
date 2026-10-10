# 现状依据

核对日期：2026-10-10。分支 main，提交 `f40bf3a`，开始规划前工作区干净。以下为仓库只读核对，不代表本轮已实测线上环境。

| 已有能力／边界 | 依据 |
| --- | --- |
| 席位审批与统一待办已合并，旧入口兼容 | `25a5a93`、`f40bf3a`；[整合记录](../../10-09-work-inbox-overview/research/main-integration.md) |
| 工作待办 `/work` 组合工作、外部信息、补充审批 | `experiments/harness-lab/src/web/Workbench.tsx:17`；`src/web/main.tsx:337` |
| 工作总览和读取摘要需显式权限 | `experiments/harness-lab/src/web/main.tsx:338`；[契约](../../../spec/backend/workbench.md) |
| 当前任务、席位职责目录和任务信息查询进入主会话 | `experiments/harness-lab/src/pi/lab.ts:635`、`:639`、`:653`、`:681`；`src/access/store.ts` 的 seats() 返回 responsibility |
| 关联信息按需读取，返回精确分析版本 | `experiments/harness-lab/src/pi/task-information-tools.ts:57`、`:64` |
| 报告历史、当前态势和任务条件可查询 | `experiments/harness-lab/src/pi/context-tools.ts:37`；`src/context/service.ts` |
| 文件／脚本和下载工具已经存在 | `experiments/harness-lab/src/pi/file-tools.ts`；[文件契约](../../../spec/backend/files-execution.md) |
| 分派、签收、提交、验收／退回共用 work_item_action | `experiments/harness-lab/src/pi/collaboration-tools.ts:66`；实际状态检查在 `src/collaboration/service.ts:193` |
| 跨席位文件需附件导入，非共享目录 | `experiments/harness-lab/src/pi/collaboration-tools.ts:82`；`src/pi/lab.ts:653` |
| 模拟数据目前仅有 E1/E2/E3，尚无道路恢复场景 | `experiments/harness-lab/scripts/mock-context/server.ts:9`、`:46`、`:62`；`fixtures.ts` |

## 需要实际验证的内容

现有查询、文件和交接具备实现与分段测试；本次核对没有证明“合并后的页面 + 多条真实模型分析 + 编制方案 + 后续修订 + 正式交接”全程可用。这里的测试缺口不等于产品功能缺失。

上一阶段整合记录报告 669 项单元／集成测试及分批覆盖 154 项不同浏览器场景；本任务尚未重新运行，不将其计为本阶段结果。

当前方案基于本线程已确认方向：尽量复用 Pi、避免新增未经证明必要的提示词或状态、场景仅验证能力。相关讨论已在当前上下文，无需再次检索历史会话。
