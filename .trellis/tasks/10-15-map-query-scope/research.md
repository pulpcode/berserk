# 规划依据与影响范围

2026-10-15，基线 `d79a561`。本次依据现有源码、原始复测材料和本轮收窄讨论；通用工具设计与评估资料只支持原则，不证明scope有效，也不把模型内在原因当成已证实事实。

## 已证实的问题

| 证据 | 事实 | 支持的最小方向 |
| --- | --- | --- |
| 上轮默认协同C01，request d0415b55 | 实际compare一项变化，两个read均objectIds:[point-a]/fields:[note]/total1；模型却说两版只有一个对象。最终provider输入第36条有参数及说明 | 整理既有计数与范围契约；scope仅作候选，不能从这次错误推定新增字段有效 |
| 上轮补充协同C02，request be3af1f1 | P1发布r4的“A 后续讨论”，模型说成r3的“A 现场讨论”。最终provider输入第34条有正确历史，本轮只list | 事实对应固定版本，必要分析仍需完成；不强制每次加载整版，不增加历史账本 |
| G01，request 559312c8 | 全图7摘要后自行筛出维修2，回答正确 | 允许合理业务路径，另测服务端筛选结果理解 |
| G02，request 89ab9c9d | 缺layerIds而全图分页，返回total7；误称仓储层7。仓储层位于最前使当前页碰巧正确 | 修正测试排列与评分；是否添加显式all_objects由隔离对照验证 |
| G03，request a99b6bd5 | 实际读取attributes/style/note，回答真实；原业务输入未禁止多读字段 | 参数说明更清楚；多读与错误分开，另测仅style结果 |

完整可审阅记录：

- [上一轮语义审阅](../10-15-map-result-projection/semantic-review.md)
- [协同链逐条审阅](../10-15-map-result-projection/collaboration-semantic-review.md)
- [上一轮验收报告](../10-15-map-result-projection/validation.md)
- 原始批次：`.local/desktop-map-acceptance/2026-10-15T08-20-48.898Z`、`.local/desktop-map-acceptance/2026-10-15T08-27-25.783Z`、`.local/agent-map-recovery/2026-10-15T08-31-19.035Z`、`.local/map-result-generalization/2026-10-15T08-33-22.033Z`。本地证据不提交、不作为产品输入。

## 现有实现锚点

- `experiments/harness-lab/src/pi/annotation-results.ts:4`：纯模型结果适配；draft/read从实际参数回显query，写入details保留原回执，A保持原状，仅候选B在此增加scope。
- `experiments/harness-lab/src/contracts/annotation-results.ts:4`：现有v1外层与严格原回执提取；已知hash裁剪仍保留业务同名属性，不应扩展成递归字段改名。
- `experiments/harness-lab/src/pi/annotation-tools.ts:16`：layerIds/objectIds；`:100`：read说明及fields枚举；`:138`：action结果报告规则。字段基础摘要与额外业务字段可就近澄清，无需新工具。
- `experiments/harness-lab/src/annotations/service.ts:172`：服务先筛选图层/对象再分页，基础摘要含name/kind/layerId；`:211`：比较生成变化集合及counts。无需改服务。
- `experiments/harness-lab/scripts/probe-desktop-map.ts:79`：比较取证当前读取counts。改名已暂缓，本轮无需因此适配或增加双字段兼容；上轮曾因投影消费者未适配出现假失败，避免为未证实收益再次引入这类成本。
- `experiments/harness-lab/scripts/probe-map-result-projection.ts:19`：原三题；`:35`：仓储在前、维修在后的夹具；`:48`：路径覆盖与语义评分分开但路径检查精确。本轮保留原题，增加独立变体和受控测试，不放松事实判断。
- 本地Pi 0.85.1的 `@earendil-works/pi-ai/dist/types.d.ts` 已提供Context、AssistantMessage/ToolResultMessage及ProviderStreams.streamSimple；`src/pi/controlled-stream.ts:53`已通过runtime传入context并捕获provider payload。受控解释可复用这些公开边界，测试用驱动调用及实际结果须明确标记，不能冒称模型自主决策。

以上行号对应基线，仅供定位。实现前再次查调用方，不以文档行号替代源码核对。

## 收窄依据与取舍

- **必做契约整理**：基础摘要、可选fields、图层ID定位及版本元信息，是工具本身需要表达的通用语义；就近说明并删重，不为具体错句追加禁止指令。
- **准确且完整**：模型应完成用户需要的数量、比较、分析及建议。上一版“收住解释”若理解成只答最少内容，会导致少答换准确，故新增完整性判据及H01–H03业务题。
- **scope为候选**：实际参数和计数说明已经可见，显式scope只是更直接的冗余表达；缺省范围误解说明值得试验，不等于已证明有效。A/B仅相差该字段，且用新业务题观察迁移，未证明收益则维持A。
- **暂缓changeCounts**：counts已有changes上下文及added/removed/changed含义。没有独立证据支持名称变更的净收益，服务、模型、HTTP及消费者均保留原名，不提前建设兼容分支。
- **分开评估问题**：G01/G03采用替代路径但业务正确，不应误判；Q显式提醒了边界，只用于诊断。新H题未用于此前调优，但公开后不是严格盲测；冻结后不能一边看结果一边调优。
- **固定3次**：旧重点只读、顺序变体、新H及Q各固定3次，原45/9按原安排。A/B条件和次数见implement，不失败补跑、不合并不同类别稀释错误；样本量不足以推出统计显著性。

原则参考：[OpenAI工具调用指南](https://developers.openai.com/api/docs/guides/function-calling)支持清楚的接口说明、可预测语义及将确定性工作交给程序；[评估最佳实践](https://developers.openai.com/api/docs/guides/evaluation-best-practices)支持任务相关的真实场景、独立评估数据和应对模型输出波动。这些资料不证明本项目的字段改名、scope、固定3次或候选采用阈值是通用最佳方案；阈值是本轮预算内的工程决策。

适用规范：backend/map-annotations、backend/conversation-references、backend/agent-scenario-validation、frontend/harness-lab。现有spec只记录已经实现的契约；待获批并实施后再按实际结果同步，不在规划阶段把候选scope写成现行规范。
