# R11 校准修订实施记录

**2026-10-25：新验证材料已接入，离线核验完成。** 有效24条为原16开发加C30–C37验证，人工确认24/24，验证4通过/4失败。此记录不代表裁判已经取得8/8；本子任务没有发起任何真实模型请求。

## 本次变更

- `selection-manifest.json`：C30–C37正式替换原8验证；原8移入discussion而不删除，37条记录中16开发、8验证、13历史/讨论。原16开发的声明、输入、语境、状态时点约定和标签保持原样。
- `human-labels.json`与`human-confirmation-20261025.md`：记录用户明确接受的新8判定。旧23条确定标签和C25待定逐条不变，完整快照在`human-labels-before-reselection-20261025.json`；此前清单快照也保留。
- `validation-reselection/`：保留已审原稿和候选记录快照，更新8条正式输入；C35–C37单独记录构造过程，不创建虚构native会话。所有真实源文件保持原样。
- `exposure-audit.md`：原region-membership与pagination-list的曝光结论仍有效；新增J12选用依据和限制，并通过manifest哈希冻结。评分规则没有改动。

## 输入与门禁契约

现有顶层输入字段不变，TS裁判驱动无需因本次材料调整改字段。manifest对新8明确声明`sampleOrigin=real_historical_output/constructed_counterexample`及`evidencePolicy=pre_answer_visible_v1`。构造条目必须指向真实基例，保留完全相同的原路径、hash、sourceLine、provider、family和contextSpans，`derivation`只能改claim。构造内容不能通过真实原文匹配入口。

对新8，兼容名`transcriptThroughClaim`实际只投影源assistant消息之前的可见消息；原正确回答、后续对话和事后状态不作为证据。`stateEvidence={}`。`claimContext`是待评回答的必要语境，不是金标或独立事实：C32/C36共享原数字列表，C36不含原manual/failed解释；C34保留资源图层5点的范围。程序按原文字符偏移核对上下文，检查基例与构造题相同的证据截止方式。

旧16开发仍使用原有完整回答和状态记录，并沿用区分当时依据/事后效果的明确约定，避免丢掉C19/C22等已确认判断的语境。构造来源、标签、分组和改写理由不进入裁判请求。

```bash
python3 -B -m unittest discover -s .trellis/tasks/10-15-agent-map-spatial/r11-20261023/calibration-v2 -p 'test_calibration_gate.py'
python3 -B .trellis/tasks/10-15-agent-map-spatial/r11-20261023/calibration-v2/calibration_gate.py --verify-labels --judge-config .trellis/tasks/10-15-agent-map-spatial/r11-20261023/calibration-v2/judge-config.example.json
```

`materials-only`只验证完整性，ready始终false。`verify-labels`要求选用24条确认、验证4/4、家族隔离、曝光与确认文档哈希一致，以及旧标签快照逐条不变。`verify`额外要求24条真实请求/原始响应/评分输出和用量，以及实际验证8/8；手写ready或离线合成结果不能替代真实调用事实。`validate-output`继续检查既有schema、unit/id、task核心轴与合取口径。

结果仍采用schemaVersion=1、kind=calibration、bindings和records。每条包含id、request/response/output路径及SHA256、requestId、起止时间、model和usage；request必须实际承载原rubric与对应完整inputs记录，response内容与输出一致。manifest同时绑定曝光审计、确认记录及旧标签快照。

## 离线验证与限制

- Python unittest：28项，通过合成临时目录验证；新增真实/构造来源伪装拒绝、基例证据/语境变更拒绝、原回答/后续状态泄漏拒绝、冻结规则与曝光修改拒绝、旧标签保留，以及两类材料共用实际8/8一致门禁。测试不会改写真实历史证据。
- 实际材料`verify-labels`：24/24确认，验证4/4，5真实+3构造、5基础轨迹、1家族；providerRequestsByGate=0。
- Python AST、JSON解析、正式inputs与8个分文件一致、标签隔离、原始来源SHA256与`git diff --check`通过。评分规则SHA256仍为`89cc99b933ad4e481e1db9b567f2def276e8ac3585efb9db5dc8cc2765aa6dad`。
- 开发集仍15通过/1失败，验证只有一个家族，没有critical负例覆盖。即使后续8/8一致，也不能声称证明所有空间业务或关键越权错误检出能力。3条构造负例不得计入模型历史失败率。

本次只完成已授权的材料与离线门禁。后续由主执行流程在既有预算内进行24次校准，通过后再执行64项任务；不自动重试、扩样或改评分规则。冻结后到真实批次结束不要再写本目录。
