# 离线评分校准

`calibration.json` 的13例均为本轮离线构造，名称、数字及语句不来自正式模型轨迹。`annotation` 是作者显式语义判断，`expected` 是先行人工预期；测试只验证审阅到分数转换，不证明两位独立复核一致。主审应先单独读取 user/evidence/process/fault/final 字段，记录自己的判断，再对照 annotation/expected。主审独立复核结果另存，不覆盖本材料。

| 样例 | 校准边界 | 主任务/解释/严格 | 过程/工具 |
| --- | --- | --- | --- |
| C01 | 完整且有据的名单数量 | 通过/通过/通过 | N/A |
| C02 | 数量事实错误 | 失败/失败/失败 | N/A |
| C03 | 全文有限定，仅建议改写 | 通过/通过/通过 | N/A |
| C04 | 过期证据留下未知 | 通过/通过/通过 | N/A |
| C05 | 未知被说成确认不可用 | 失败/失败/失败 | 状态关键约束失败 |
| C06 | 单范围歧义直接合并 | 失败/通过/失败 | 范围规则否决 |
| C07 | 明确比较直接分别完成 | 通过/通过/通过 | N/A |
| C08 | 比较却强迫单选，无终答 | 失败/N/A/失败 | 非事实问题，过程N/A |
| C09 | 过程误述后产品中断 | 失败/N/A/失败 | 过程失败仍保留 |
| C10 | 工具重复计数，模型纠正 | 通过/通过/通过 | 工具失败 |
| C11 | 早期错话，最终更正 | 通过/失败/失败 | 过程失败 |
| C12 | 空统计产品中断，无终答 | 失败/N/A/失败 | 过程N/A，工具失败 |
| C13 | 无依据工具精确合计，模型纠正 | 通过/通过/通过 | 工具失败 |

`scoreReviewV2` 与 `aggregateV2` 直接复用冻结的上一轮模块。新适配仅固定 N01—N08×2 分母、15/16 主任务与严格、四项关键约束16/16、同题不得双失败，以及独立工具门槛。公开业务错误照实记录，不改变正式分母；公开协议故障或缺审阅会阻止整体验收通过。任一离线/公开/正式真实工具回归均失败；缺少某类本轮公开/正式实际路径证据为 `unverified`，离线成功不能替代。未走相关路径不扣等价正确任务的主分，不自动追加模型任务。

运行（仓库根目录）：

```sh
node --import ./experiments/harness-lab/node_modules/tsx/dist/loader.mjs --test .trellis/tasks/11-03-resource-independent-acceptance/scoring.test.ts .trellis/tasks/11-03-resource-independent-acceptance/report-materials.test.ts
node --import ./experiments/harness-lab/node_modules/tsx/dist/loader.mjs .trellis/tasks/11-03-resource-independent-acceptance/report-materials.ts BATCH_DIRECTORY NEW_OUTPUT_DIRECTORY
```

导出为每槽 `review-input.json`（紧凑原始公开文字/固定引用/工具参数及原件位置）和 `review-packet.json`（未填两份审阅）。保留所有过程文字，不靠关键词摘“关键句”。公开投影未包含完整原生历史或控制器/来源记录，`trajectoryComplete`、`evidenceVerified` 故意默认false，必须核对原件和hash后设置。审阅者必须查 rawDirectory 中原生历史、来源分页、接续、导入回执、状态前后、计费和冻结记录；不能将导出视作自动完成证据校验。私有思考和凭据不导出。程序核对独立预期只可否决，不能取代语义审阅。此阶段模型调用0。
