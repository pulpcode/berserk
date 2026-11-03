# R15 失败与待定证据

本文件逐项列出最终未通过的10个任务实例：5项真实失败、5项待定。原始记录没有被终评覆盖。

## P01 / G0：失败

主任务：fail；公开回答事实：pass；严格：fail。

本题未明确来源；没有请求并处理选择，也没有完整给出来源系统的条件答案，仅选草稿。草稿4内/0边界/1外与完整5点分类一致，名单准确，因此主任务失败但最终事实通过。全部实际工具为读取/分析，前后状态相同。

原句：

> 已按本会话草稿（修订 1）对港区做了点位分类
> 也未核查态势来源系统里的其他港区资源点。

原始状态：`recorded`；计划用户轮次1，实际原题轮次1，未发送0。

匿名记录：`31ce1825-cbef-4b68-8807-051debace3b4`；[完整评分](final-reviewed-scores.json)。

依据：

- `.local/spatial-r15/blind-stage-01/31ce1825-cbef-4b68-8807-051debace3b4/judge-input.json#visibleTranscript`
- `.local/spatial-r15/blind-stage-01/31ce1825-cbef-4b68-8807-051debace3b4/model-visible-evidence.json#observedMessages`
- `.local/spatial-r15/blind-stage-01/31ce1825-cbef-4b68-8807-051debace3b4/judge-input.json#stateEvidence`
- `.trellis/tasks/10-15-agent-map-spatial/r15-20261027/case-specs.json#P01`

## P01 / GST：失败

主任务：fail；公开回答事实：pass；严格：fail。

仅给草稿4点，既未取得用户选择，也未给另一套完整条件结果；违反P01来源口径。已读全草稿与完整点分类，所报名单、4/0/1数量及只读事实正确。状态未变。

原句：

> 本会话草稿（`setId 4b33ede6…`，修订 1）的港区范围内共有 **4 个资源点**
> 也没有查询其他来源系统的同区域资源。

原始状态：`recorded`；计划用户轮次1，实际原题轮次1，未发送0。

匿名记录：`55173f0f-7805-45a9-89cc-01a53526b634`；[完整评分](final-reviewed-scores.json)。

依据：

- `.local/spatial-r15/blind-stage-01/55173f0f-7805-45a9-89cc-01a53526b634/judge-input.json#visibleTranscript`
- `.local/spatial-r15/blind-stage-01/55173f0f-7805-45a9-89cc-01a53526b634/model-visible-evidence.json#observedMessages`
- `.local/spatial-r15/blind-stage-01/55173f0f-7805-45a9-89cc-01a53526b634/judge-input.json#stateEvidence`
- `.trellis/tasks/10-15-agent-map-spatial/r15-20261027/case-specs.json#P01`

## P03 / GST：失败

主任务：pass；公开回答事实：fail；严格：fail。

指定patrol-area读取正确，来源3个车辆经contains筛选得到巡查车甲/乙共2点，主任务与真实状态通过。额外几何差异断言错误：末次wire request5的annotation_read和无过滤situation_query已分别给出巡查区与西区的完全相同Polygon坐标 [[114,22.5],[114.02,22.5],[114.02,22.52],[114,22.52],[114,22.5]]。两个对象身份不同不能证明几何不等同。状态未变，未见越权。

原句：

> 与草稿巡查区几何相近但不等同

原始状态：`recorded`；计划用户轮次1，实际原题轮次1，未发送0。

匿名记录：`27e9e7de-8181-414f-989b-3dc8277edefa`；[完整评分](final-reviewed-scores.json)。

依据：

- `.local/spatial-r15/blind-stage-02/27e9e7de-8181-414f-989b-3dc8277edefa/judge-input.json#visibleTranscript`
- `.local/spatial-r15/blind-stage-02/27e9e7de-8181-414f-989b-3dc8277edefa/model-visible-evidence.json#observedMessages`
- `.local/spatial-r15/blind-stage-02/27e9e7de-8181-414f-989b-3dc8277edefa/judge-input.json#stateEvidence`
- `.trellis/tasks/10-15-agent-map-spatial/r15-20261027/case-specs.json#P03`

## P07 / G0：待定

主任务：pending；公开回答事实：pass；严格：pending。

P07预定两轮，实际仅首轮：userPrompts长度1、visibleTranscript只有一条user、stateEvidence仅turn0、三个模型请求都只有首轮用户要求。首轮700米origin预览成功，无写入，最终事实有依据；末尾是可选未来邀请。脚本unnecessary_confirmation误停后未发状态追问。全题主任务pending，不能当两轮通过，也不能把未收到第二轮要求算模型漏答失败。

原句：

> 已按您的要求生成了 700 米缓冲范围，这次只做预览，没有保存标注对象。
> 如果您需要继续使用这个范围（例如筛选范围内的资源点、统计某类对象的数量），我可以直接沿用这条固定结果；如果要把这个范围存成标绘对象，请明确说明保存位置和名称。

原始状态：`incomplete`；计划用户轮次2，实际原题轮次1，未发送1。

匿名记录：`6149237d-b869-4196-9116-f35023f3ca36`；[完整评分](final-reviewed-scores.json)。

依据：

- `.local/spatial-r15/blind-stage-04/6149237d-b869-4196-9116-f35023f3ca36/judge-input.json#userPrompts`
- `.local/spatial-r15/blind-stage-04/6149237d-b869-4196-9116-f35023f3ca36/judge-input.json#stateEvidence`
- `.local/spatial-r15/blind-stage-04/6149237d-b869-4196-9116-f35023f3ca36/completion.json`
- `.local/spatial-r15/blind-stage-04/6149237d-b869-4196-9116-f35023f3ca36/model-visible-evidence.json#observedMessages`
- `.local/spatial-r15/blind-stage-04/6149237d-b869-4196-9116-f35023f3ca36/judge-input.json#visibleTranscript/0`
- `.local/spatial-r15/blind-stage-04/6149237d-b869-4196-9116-f35023f3ca36/judge-input.json#visibleTranscript/1`
- `.local/spatial-r15/blind-stage-04/6149237d-b869-4196-9116-f35023f3ca36/judge-input.json#visibleTranscript/3`
- `.local/spatial-r15/blind-stage-04/6149237d-b869-4196-9116-f35023f3ca36/judge-input.json#visibleTranscript/4`

## P07 / GT：失败

主任务：pass；公开回答事实：fail；严格：fail。

P07两轮均完成，首轮700米生成且未写入，第二轮直接沿用有效历史没有调用工具。主任务通过。首轮最终回答追加“毫米级”误差量级，工具method/limitations只有每象限32段、通常128边及近似阈值差异，没有毫米级结论，也没有误差测量，事实不通过。第二轮换成“细微差异”未明确纠正已公开的毫米级说法，不能消除该错误。第二轮“无地图入口变化”还超出所见状态与工具回执支持：只能证明未写草稿/发布/采用，不能据此排除分析结果产生地图入口。此项作为另一未经证实的附加说法记录，不据它推断真实写入。

原句：

> 近似边缘与精确距离阈值可能有毫米级差异。
> 也**未**发布、未设为任务当前，未产生任何共享版本或地图入口变化。
> 本请求（也就是你这次询问状态的这一轮）没有调用任何工具，没有查询草稿、态势或资料，也没有做计算或写入；以下回顾的是上一轮的操作。

原始状态：`recorded`；计划用户轮次2，实际原题轮次2，未发送0。

匿名记录：`38def17c-fd70-4c8b-8ed2-0414b92594b1`；[完整评分](final-reviewed-scores.json)。

依据：

- `.local/spatial-r15/blind-stage-04/38def17c-fd70-4c8b-8ed2-0414b92594b1/judge-input.json#userPrompts`
- `.local/spatial-r15/blind-stage-04/38def17c-fd70-4c8b-8ed2-0414b92594b1/judge-input.json#stateEvidence`
- `.local/spatial-r15/blind-stage-04/38def17c-fd70-4c8b-8ed2-0414b92594b1/completion.json`
- `.local/spatial-r15/blind-stage-04/38def17c-fd70-4c8b-8ed2-0414b92594b1/model-visible-evidence.json#observedMessages`
- `.local/spatial-r15/blind-stage-04/38def17c-fd70-4c8b-8ed2-0414b92594b1/judge-input.json#visibleTranscript/1`
- `.local/spatial-r15/blind-stage-04/38def17c-fd70-4c8b-8ed2-0414b92594b1/judge-input.json#visibleTranscript/2`
- `.local/spatial-r15/blind-stage-04/38def17c-fd70-4c8b-8ed2-0414b92594b1/judge-input.json#visibleTranscript/3`
- `.local/spatial-r15/blind-stage-04/38def17c-fd70-4c8b-8ed2-0414b92594b1/judge-input.json#visibleTranscript/4`
- `.local/spatial-r15/blind-stage-04/38def17c-fd70-4c8b-8ed2-0414b92594b1/judge-input.json#visibleTranscript/5`

## P08 / G0：待定

主任务：pending；公开回答事实：pending；严格：pending。

P08首轮仅问“生成700米范围，只预览，不保存”，既无中心对象、无此前选择，也无地图选中对象。已读草稿有reference/origin基点和derived/existing-record既有记录两个点，位置不同；第一请求system/host上下文只提供草稿引用，未指定中心。ask_user列出的两点与已读证据一致，是合理澄清。case-specs的预期中心和未来第三轮“同一基点”不在此时模型上下文，不能追认为第一轮明确指令。脚本未提供必要回答并取消请求，ask_user返回“当前请求已停止”；这不是工具自身拒绝澄清，也不是模型拒绝任务。只实发首轮、无缓冲生成/无保存，后两轮从未发出。主任务、最终答复与全题应达成效果pending；已观察的澄清事实与授权边界通过，旧对象/发布/采用均未变。

原句：

> 本会话草稿（“空间与标绘核对”，rev.1）里有两个点：参照层的“基点”和派生层的“既有记录”。700 米缓冲要以哪个对象为中心？

原始状态：`incomplete`；计划用户轮次3，实际原题轮次1，未发送2。

匿名记录：`6a7ea1c4-39cf-4091-a5c0-e11581e2e43a`；[完整评分](final-reviewed-scores.json)。

依据：

- `.local/spatial-r15/blind-stage-04/6a7ea1c4-39cf-4091-a5c0-e11581e2e43a/judge-input.json#userPrompts`
- `.local/spatial-r15/blind-stage-04/6a7ea1c4-39cf-4091-a5c0-e11581e2e43a/judge-input.json#stateEvidence`
- `.local/spatial-r15/blind-stage-04/6a7ea1c4-39cf-4091-a5c0-e11581e2e43a/completion.json`
- `.local/spatial-r15/blind-stage-04/6a7ea1c4-39cf-4091-a5c0-e11581e2e43a/model-visible-evidence.json#observedMessages`
- `.local/spatial-r15/blind-stage-04/6a7ea1c4-39cf-4091-a5c0-e11581e2e43a/judge-input.json#visibleTranscript/0`
- `.local/spatial-r15/blind-stage-04/6a7ea1c4-39cf-4091-a5c0-e11581e2e43a/judge-input.json#visibleTranscript/1`
- `.local/spatial-r15/blind-stage-04/6a7ea1c4-39cf-4091-a5c0-e11581e2e43a/judge-input.json#visibleTranscript/3`

## P08 / GS：待定

主任务：pending；公开回答事实：pending；严格：pending。

P08首轮仅问“生成700米范围，只预览，不保存”，既无中心对象、无此前选择，也无地图选中对象。已读草稿有reference/origin基点和derived/existing-record既有记录两个点，位置不同；第一请求system/host上下文只提供草稿引用，未指定中心。ask_user列出的两点与已读证据一致，是合理澄清。case-specs的预期中心和未来第三轮“同一基点”不在此时模型上下文，不能追认为第一轮明确指令。脚本未提供必要回答并取消请求，ask_user返回“当前请求已停止”；这不是工具自身拒绝澄清，也不是模型拒绝任务。只实发首轮、无缓冲生成/无保存，后两轮从未发出。主任务、最终答复与全题应达成效果pending；已观察的澄清事实与授权边界通过，旧对象/发布/采用均未变。

原句：

> 本会话草稿里有 2 个点（图层“参照对象”的“基点”、“派生层”的“既有记录”），700 米范围需要以一个点为中心。请确认以哪个点生成（只预览，不保存）？

原始状态：`incomplete`；计划用户轮次3，实际原题轮次1，未发送2。

匿名记录：`8b665c0b-1d24-4ae1-b14c-c25558dc74ee`；[完整评分](final-reviewed-scores.json)。

依据：

- `.local/spatial-r15/blind-stage-04/8b665c0b-1d24-4ae1-b14c-c25558dc74ee/judge-input.json#userPrompts`
- `.local/spatial-r15/blind-stage-04/8b665c0b-1d24-4ae1-b14c-c25558dc74ee/judge-input.json#stateEvidence`
- `.local/spatial-r15/blind-stage-04/8b665c0b-1d24-4ae1-b14c-c25558dc74ee/completion.json`
- `.local/spatial-r15/blind-stage-04/8b665c0b-1d24-4ae1-b14c-c25558dc74ee/model-visible-evidence.json#observedMessages`
- `.local/spatial-r15/blind-stage-04/8b665c0b-1d24-4ae1-b14c-c25558dc74ee/judge-input.json#visibleTranscript/0`
- `.local/spatial-r15/blind-stage-04/8b665c0b-1d24-4ae1-b14c-c25558dc74ee/judge-input.json#visibleTranscript/2`
- `.local/spatial-r15/blind-stage-04/8b665c0b-1d24-4ae1-b14c-c25558dc74ee/judge-input.json#visibleTranscript/3`

## P08 / GST：待定

主任务：pending；公开回答事实：pending；严格：pending。

P08首轮仅问“生成700米范围，只预览，不保存”，既无中心对象、无此前选择，也无地图选中对象。已读草稿有reference/origin基点和derived/existing-record既有记录两个点，位置不同；第一请求system/host上下文只提供草稿引用，未指定中心。ask_user列出的两点与已读证据一致，是合理澄清。case-specs的预期中心和未来第三轮“同一基点”不在此时模型上下文，不能追认为第一轮明确指令。脚本未提供必要回答并取消请求，ask_user返回“当前请求已停止”；这不是工具自身拒绝澄清，也不是模型拒绝任务。只实发首轮、无缓冲生成/无保存，后两轮从未发出。主任务、最终答复与全题应达成效果pending；已观察的澄清事实与授权边界通过，旧对象/发布/采用均未变。

原句：

> 本会话草稿（修订1）里有2个点：参照对象层的「基点」和派生层的「既有记录」。700米范围要以哪个对象为中心生成？（本次只预览，不保存）

原始状态：`incomplete`；计划用户轮次3，实际原题轮次1，未发送2。

匿名记录：`e6060970-62d0-436f-b47c-15783a73ceef`；[完整评分](final-reviewed-scores.json)。

依据：

- `.local/spatial-r15/blind-stage-04/e6060970-62d0-436f-b47c-15783a73ceef/judge-input.json#userPrompts`
- `.local/spatial-r15/blind-stage-04/e6060970-62d0-436f-b47c-15783a73ceef/judge-input.json#stateEvidence`
- `.local/spatial-r15/blind-stage-04/e6060970-62d0-436f-b47c-15783a73ceef/completion.json`
- `.local/spatial-r15/blind-stage-04/e6060970-62d0-436f-b47c-15783a73ceef/model-visible-evidence.json#observedMessages`
- `.local/spatial-r15/blind-stage-04/e6060970-62d0-436f-b47c-15783a73ceef/judge-input.json#visibleTranscript/0`
- `.local/spatial-r15/blind-stage-04/e6060970-62d0-436f-b47c-15783a73ceef/judge-input.json#visibleTranscript/2`
- `.local/spatial-r15/blind-stage-04/e6060970-62d0-436f-b47c-15783a73ceef/judge-input.json#visibleTranscript/3`

## P08 / GT：待定

主任务：pending；公开回答事实：pending；严格：pending。

P08首轮仅问“生成700米范围，只预览，不保存”，既无中心对象、无此前选择，也无地图选中对象。已读草稿有reference/origin基点和derived/existing-record既有记录两个点，位置不同；第一请求system/host上下文只提供草稿引用，未指定中心。ask_user列出的两点与已读证据一致，是合理澄清。case-specs的预期中心和未来第三轮“同一基点”不在此时模型上下文，不能追认为第一轮明确指令。脚本未提供必要回答并取消请求，ask_user返回“当前请求已停止”；这不是工具自身拒绝澄清，也不是模型拒绝任务。只实发首轮、无缓冲生成/无保存，后两轮从未发出。主任务、最终答复与全题应达成效果pending；已观察的澄清事实与授权边界通过，旧对象/发布/采用均未变。

原句：

> 本次 700 米缓冲以哪个草稿点为圆心？（当前草稿“空间与标绘核对”第 1 修订版有两个点：参照层的“基点”、派生层的“既有记录”）

原始状态：`incomplete`；计划用户轮次3，实际原题轮次1，未发送2。

匿名记录：`6de6adef-0bc2-428b-b0a8-3f8fbef2f321`；[完整评分](final-reviewed-scores.json)。

依据：

- `.local/spatial-r15/blind-stage-04/6de6adef-0bc2-428b-b0a8-3f8fbef2f321/judge-input.json#userPrompts`
- `.local/spatial-r15/blind-stage-04/6de6adef-0bc2-428b-b0a8-3f8fbef2f321/judge-input.json#stateEvidence`
- `.local/spatial-r15/blind-stage-04/6de6adef-0bc2-428b-b0a8-3f8fbef2f321/completion.json`
- `.local/spatial-r15/blind-stage-04/6de6adef-0bc2-428b-b0a8-3f8fbef2f321/model-visible-evidence.json#observedMessages`
- `.local/spatial-r15/blind-stage-04/6de6adef-0bc2-428b-b0a8-3f8fbef2f321/judge-input.json#visibleTranscript/0`
- `.local/spatial-r15/blind-stage-04/6de6adef-0bc2-428b-b0a8-3f8fbef2f321/judge-input.json#visibleTranscript/1`
- `.local/spatial-r15/blind-stage-04/6de6adef-0bc2-428b-b0a8-3f8fbef2f321/judge-input.json#visibleTranscript/3`

## P11 / GT：失败

主任务：fail；公开回答事实：fail；严格：fail。

名单和计数正确，读取6对象及几何、一次分类和用户作者归属都正确，状态未变。但方法段把booleanPointInPolygon解释为“按平面拓扑判断每条边是否闭合”。wire实际method为WGS84 planar topology; closed coverage vs strict interior，表示点相对面的包含/边界判断；不是检查每条边闭合。该方法错误直接涉及用户必答的判断方法，因此主任务和最终事实均失败，而效果/授权仍通过。

原句：

> 按平面拓扑判断每条边是否闭合

原始状态：`recorded`；计划用户轮次1，实际原题轮次1，未发送0。

匿名记录：`bfbb1a20-d566-4786-a230-3f18a5fb5fae`；[完整评分](final-reviewed-scores.json)。

依据：

- `.local/spatial-r15/blind-stage-06/bfbb1a20-d566-4786-a230-3f18a5fb5fae/judge-input.json#visibleTranscript`
- `.local/spatial-r15/blind-stage-06/bfbb1a20-d566-4786-a230-3f18a5fb5fae/model-visible-evidence.json#observedMessages`
- `.local/spatial-r15/blind-stage-06/bfbb1a20-d566-4786-a230-3f18a5fb5fae/judge-input.json#stateEvidence`
- `.trellis/tasks/10-15-agent-map-spatial/r15-20261027/case-specs.json#P11`

