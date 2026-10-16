# 默认 A：工具契约与报告规则实施

2026-10-15。范围为获批方案的 M1/M2；基线提交 `7c43e45`。本记录仅覆盖产品说明与确定性送达检查，不代替真实模型语义验收。

## 变更

| 位置 | 之前 | 现在 |
| --- | --- | --- |
| annotation_read 的 fields | 枚举额外字段，工具总说明仅称默认摘要 | 参数旁说明基础 objectId/name/kind/layerId 始终返回，不填入 fields；省略或空数组均为摘要；未请求不代表为空 |
| layerIds/objectIds | 无参数说明；总说明主要讲对象定位 | 参数旁说明使用 ID、查询双选择取交集、按需读摘要定位；已有摘要够用则不重复读取 |
| annotation_read 范围及比较 | 已说明筛选计数和分页、变化计数不是总数 | 保留原语义，并明确缺省筛选在固定版本全部对象中分页；变化项可以涉及标题、图层及对象 |
| annotation_list | 元信息、不含几何 | 明确不含对象字段，发布说明 note 不是对象备注 |
| annotation_action 报告段 | 按实际范围说明结果、只报告本次效果 | 用一条通用要求兼顾目标完成、必要分析、固定版本依据、事实/推断/建议及不确定性；保留任务当前、发布与采用等原契约 |

产品仅修改 `experiments/harness-lab/src/pi/annotation-tools.ts`：说明就近迁移并删重，两个读取分支共用 readFields schema。参数枚举、验证约束、权限、执行分支、宿主状态、服务调用及结果对象不变。

A 未增加 scope，未重排结果字段，counts 未改名。无 Skill、自动输入、回执、UI、服务 DTO 或模型配置改动；无强制读回、额外查询或回答审核器。没有注入场景名称、期望答案或逐题禁令。

## 检查

在 `experiments/harness-lab` 执行：

- `npm run typecheck`：通过。
- `npm run lint`：通过，包括 Pi/浏览器依赖边界。
- `npm test -- tests/pi/provider-payload.test.ts tests/pi/annotations.test.ts tests/annotation-results.test.ts tests/pi/annotation-workflow.test.ts tests/pi/annotation-hook-boundaries.test.ts`：5 文件、64 测试通过。
- 仓库 `git diff --check`：通过。

只扩展既有 provider-payload 投影测试：检查真实 provider JSON 中两个读取分支的参数说明、列表元信息语义及报告规则，并确认本请求未读取 Skill。已有测试继续覆盖结果 query/分页、content/details、旧历史、权限、宿主依据及 hook 边界。测试 HTTP transport 被替换，没有调用真实模型。

一次命令误在仓库根目录运行 `npm run typecheck`，因根目录没有 package.json 返回 ENOENT；随后在正确包目录执行通过。该失败属于命令目录错误，不是类型检查缺陷，也不计为模型测试。

## 局限与后续

确定性检查证明说明送达与既有契约保持，不证明模型会正确理解或完整回答。A 的真实业务验收和 B 的隔离 scope 实验由总任务按冻结计划执行，分别报告；本子任务未运行真实模型、部署或提交 Git。新增 H 场景与预期答案未用于产品说明。
