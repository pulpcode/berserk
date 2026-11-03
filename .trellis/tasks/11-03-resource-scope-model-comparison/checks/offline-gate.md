# 冻结前离线门槛索引

以下均为确定性检查，不是模型业务评分。具体运行记录和限制以链接文件为准。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| T01 空统计集合 | 通过 | [真实 HTTP → 工具 → 历史读取](tool-regression-review.md) |
| T02 汇总成员及副本去重 | 通过，独立预期 5 辆 | 同上；[证据哈希](tool-regression-evidence.json) |
| T03 缺合并依据 | 通过，完整合计为 null | 同上 |
| T04 完整引用、分页及跨轮边界 | 通过 | [产品检查](product-offline.md)、[独立静态复核](product-static-review.md) |
| T05 统计集合标签 | 通过 | resource-explanations 四种 position 渲染检查；真实集合／内部卡片及桌面窄面板见产品检查 |
| T06 指定题号覆盖及故障优先 | 通过 | [评分校准](calibration.md)、[旧结果勘误](../erratum.md) |
| T07 多问、文本/API 接续 | 通过 | [驱动检查](runner/summary.json)、runner-unit.log、native-http-29.log |
| T08 实际工具与 Skill 规则 | 通过 | 产品 provider-payload/map-skill 检查及独立静态复核 |

模型对照使用冻结后的工作区快照，包含未提交实现；不能把产品快照称为方案提交 af35e31 的原始源码。测试期间不改产品、题包或评分契约。公开流程仍须单独复核通过，离线通过不代替公开流程门槛。
