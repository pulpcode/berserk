# R15 实施设计与改动边界

完整决策与图见plan.md；本文件落实批准设计，不扩大范围。

## 责任与文件

1. 工具实现：experiments/harness-lab/src/annotations/service.ts及相关contracts/annotations.ts；pi/annotation-results.ts、annotation-tools.ts；contracts/spatial.ts、pi/spatial-results.ts及其必要调用/解析与针对性测试。ID提示在已授权读取的服务层产生，返回摘要与总数含义在模型结果适配层产生。新增字段必须有真实来源并保留旧历史解码；不改几何算法、写入状态或数据库。
2. Skill候选：r15-20261027/candidate-skills/{map-annotations,spatial-analysis}/SKILL.md。以6a631a4正文重新组织本轮规则，旧工作区Skill保持原样；目录描述计入Skill因素。
3. 题目与真值：本轮data.ts/cases.ts/case-specs.json及测试，公开题目不放模型工作区；真实HTTP/Pi业务夹具，独立数值/状态oracle。
4. 执行评测：本轮runtime/provider/budget/live及测试。复用R14/R13成熟帮助函数；旧执行器/材料只读，候选四组隔离归档。逐请求记录、冻结与一次性claim，不做隐式恢复。

## 运行接口约定

caseId P01—P12，Group G0/GS/GT/GST；每题各组顺序轮转，12×4=48；round/repetition均1。准备函数prepareCase(manifest,caseId)返回与R14 Prepared兼容的fixture/prompts/truth/sourceBefore等；需要本轮caseId和新效果检查，不直接套R14 caseId特例。cases.ts提供canonicalFixtureHash、clarificationResponse、clarificationReplyForTurn、plainClarificationKind、criticalEffect/fixedPreviewEvidence或清楚的替代接口，cases与runner实现者直接协调并锁定。

## 提示与历史兼容

旧spatial v1/v2正文/真实details严格匹配与读取字节语义必须保持。若新增模型说明需要新封装，明确标记新封装并兼容旧解码，不能放宽验证为接受任意额外文字/未知字段；native continuation、权限撤销、固定结果保存、前端证据提取都必须验证。

名称为零匹配时只在本次有权读取且满足图层限制的精确版本中找同字符串ID；提示独立于objects/items/total。部分名称成功、命名与ID交叉时不替换已匹配对象。空范围不等于全草稿为空。

数量摘要按操作生成，分类items不等于命中数，计算input不等于整层。状态只说明当前动作；历史receipt/read不伪装成刚完成写入。不推断内部介质或作者。

## 保全与回退

protected-before.json和.local/spatial-r15/preexisting.patch/status保全旧修改。旧产品Skill及resource-tools不覆盖。回退仅撤销明确本轮改动；旧记录/失败不删除。所有候选和组别哈希记入runtime冻结与模型可见Skill记录。
