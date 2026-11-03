# 第二批验收证据索引

2026-11-02。最终统一回归 13 文件 226/226、桌面 4/4 已通过。以下按已批准的 D01—D24 逐组对应，详细状态及检查数量以 [review.md](review.md) 和 [results.md](results.md) 为准。这里的“组”是验收主题，不等于单条测试数量，也不是模型测评题目。

| 组 | 实际测试与核对内容 |
| --- | --- |
| D01 默认任务资源 | task-resource-query：第一批独立 inputs/expected，经真实服务核对名单、归并、关系、状态、数量和未分类位置 |
| D02 普通标绘兼容 | task-resource-query：原标绘点继续正常读取，不强制声明为资源 |
| D03 同名不同实体 | task-resource-query：跨来源同名分列，没有跨系统身份映射不声称确定实体总数 |
| D04 普通来源引用 | task-resource-query：普通引用不变成受控实体关联，不继承来源可用状态 |
| D05 同实体冲突 | task-resource-query：可靠身份归并但保留多份证据，可用状态冲突不冒充可用 |
| D06 汇总与明细 | task-resource-query：覆盖关系有/无分别验证，不重复相加；站点位置不代表车辆位置 |
| D07 单位与未知 | task-resource-query：车辆、船舶分组；knownValue 与 unknownCount 分列，未知不当零 |
| D08 计划位置 | task-resource-query：资源保留但位置未分类，不把计划位置当实际位置或区域外 |
| D09 登记区域 | task-resource-query：登记地区筛选和实际空间位置独立判断 |
| D10 空与不可用 | task-resource-query：完整空来源和不可用来源分开，无关联不推出已分配为零 |
| D11 采用发布版 | task-resource-query：采用他会话固定发布版，原草稿后续变化不改变该固定版本 |
| D12 用户报告 | task-resource-query：真实 user 原文、资源引用、报告内容保留；不自动认证转述或写回来源/草稿 |
| D13 筛选与分页 | context-resource-query、task-resource-query：真实 HTTP 在分页前筛资源类型，混合大量无关对象仍完整取数 |
| D14 来源稳定性 | task-resource-query：版本变化、重复游标、同对象内容变化、精确对象缺失及跨选择快照变化；不混合成成功全集 |
| D15-a 无任务接口 | task-resource-query：平台引用 R1 后只发精确对象条件，不带 taskId；related 不升级 assigned |
| D15-b 明确来源范围 | task-resource-query：R1/R2 没关系也能做普通位置计算，数据覆盖与关系覆盖独立 |
| D15-c 没有关联 | task-resource-query：不扫描全部来源，不把未知任务资源量写为零 |
| D15-d 部分有关联 | task-resource-query：保留 R1/R2，只有 R1 为平台相关，两者都不因此成为已分配 |
| D15-e 可选能力 | context-resource-query、task-resource-query：实际 identity 映射/明确支援规则；缺能力仍可基础精确读取 |
| D16 权限闭环 | task-resource-query、task-resource-spatial、pi/task-resource：来源/固定标绘撤权、跨任务/席位/会话、历史隐藏、下一次送模前拒绝，包括同请求工具续轮 |
| D17 身份与时间 | task-resource-query：受控关联、普通复制、跨来源相同 ID、不同集合相同 hash，以及过期/附条件事实 |
| D18 空间与缺位置 | task-resource-query、task-resource-spatial、spatial-point-classification：内/边/外、缺失/计划/估计/站点/冲突位置、后续派生保留缺口；非点不能静默作为缺位置 |
| D19 统计对应 | task-resource-spatial：Q/S 必须对应候选，不能只在参照目标里提到 Q；单位、关系和状态筛选；目标权限依赖继承 |
| D20 原生真实性 | pi/task-resource-results、pi/task-resource、task-resource-spatial：参数/正文/details/归属/交付篡改、重启、实际自动压缩；生成几何可以复用但不能冒充原资源位置 |
| D21 固定读取 | pi/task-resource 与资源专项：实际 HTTP 来源、采用版和草稿更新后，新查询读新版本；旧快照/分页保持原结果，不重新读取来源；查询和读回身份不同 |
| D22 上限与覆盖 | task-resource-spatial、来源边界专项：501 条、超过 50 页、1 MiB、中途取消；来源没有下一页但明确局部覆盖时保留原因 |
| D23 用户消息真实性 | pi/task-resource-results 与业务专项：助手、摘要、其他分支、不对应选择的消息不能充当依据；合法引用不代表含义已认证 |
| D24 完整调用与兼容 | pi/task-resource 的实际确定性工具循环，旧空间/来源/B1 回归，精确保存及公开投影；另有 4 项桌面历史/保存回归 |

## 证据使用边界

- D12/D23 只证明消息来源、原文与资源选择可核查，不证明模型能正确理解自由文字。
- D18 的孔内/孔边检查使用真实查询资源位置与现有计算库；标绘和来源接口仍不支持带孔面，未宣称这条产品路径可用。
- D20/D24 使用确定性 provider 驱动实际 Pi，不使用真实模型；不能据此宣称 Agent 正确率。
- D15 没有新增“必须有任务字段”的来源接入条件，也没有把模拟来源的可选能力当成真实外部系统已部署。
- 各报告测试文件有重叠，重复执行不累加为独立样本。首次失败及修正分别保留在 source-checks、pi-checks、offline-checks、review 中。
