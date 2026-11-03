# 第四批验收结果材料

最终判分见 [scores-index.json](scores-index.json)：正式16项均已完成双审及主审裁决。主任务15/16，严格9/16；有公开答复15题中的解释事实正确9/15。分配/可用状态证据关键约束15/16，其余三项16/16，因此未达到冻结验收门槛。

[execution-index.json](execution-index.json) 与 trajectories/ 下20个 public.json 是执行证据投影，不是最终判分。其中 semanticReview=pending_review 是材料准备时的默认元数据；请以 scores-index.json 为最终状态。目录不包含未评分 ReviewPacket 模板。公开4项流程检查不进入正式16项分母，见 [公开流程门槛审查](../records/public-gate-check.md)。

A06-2 是经只读诊断确认的产品校验缺陷，未形成公开助手答复：主任务和严格失败并保留在16分母；解释列N/A，排除有答复解释率分母。原冻结评分器对空助手语料返回的 explanation=true 保留在 frozenScorerExplanation，仅表示无已知误述，不当作成功解释。原第二审异常分类及产品分类修订均保留。

A04-2初版主审文字遗漏了第二审final中的关键约束失败；初版另存 [初版决议](../records/root-resolution-A04-2-initial.json)，当前 [修订决议](../records/root-resolution-A04-2.json) 明确记录纠正。独立两审未改写。

[Skill加载观察](skill-loading-index.json) 仅统计真实skill.read/skill_read工具返回：总11次，正式8次（6/16任务）、公开3次（2/4任务）。读取率不是正确率；未调用工具不代表没有收到宿主规则。

审阅方式为AI辅助双审与显式主审裁决，不称真人盲审。scores-index的逐项记录链接双审、主审裁决及哈希。原始provider请求/响应、native历史、凭据和私有思考不在本目录；初始可见上下文只保留私有路径/哈希索引，不发布正文。浏览器截图由主审独立放置browser/。

字段口径：scores-index中formal.incomplete=[]表示没有尚未完成评分的计划项，不表示所有业务任务完成。独立报告字段formal.executionFailures=["A06-2"]保留实际runtime incomplete，来源及hash在executionFailureEvidence。formal.protocolFailures=[]表示没有归类为评测流程故障的项；A06-2是产品故障。冻结aggregate函数未修改。
