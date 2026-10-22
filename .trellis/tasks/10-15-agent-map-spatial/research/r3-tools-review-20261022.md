# 本轮工具复核：先复用现有能力

日期：2026-10-22；基线`ef5d4a2`。结论：本轮未发现必须新增工具字段、计算入口拦截或范围状态系统的证据，因此不修改产品工具。此结论不表示工具返回一定已最优，也不表示模型已经会正确使用。

## 对照已知失败

[R2完整报告](r2-results-20261018.md)中，B-V09、M-J09和S-J09的范围错误发生在同名候选已经可见之后；B-J04、B-V04和S-V04是对正确筛选结果的方向或边界解释出错；M-J07实际精确保存成功，但提前声称已经读取了可写草稿。不能把这些错误直接归因于缺少新的查询接口或数学算法。

## 现有检查与返回信息

| 要检查的情况 | 现有实现 | 本轮处理 |
| --- | --- | --- |
| 名称找到多个图层 | `src/annotations/service.ts`的read在授权、固定版本读取后返回`ANNOTATION_LAYER_NAME_AMBIGUOUS`，错误中包含候选ID | 保留；不把错误视为用户已经选择，不添加全局同名封锁 |
| 上下文已有合法ID | 同一read入口允许`layerIds`；已有测试证明同名时也可读取明确选中的图层 | 保留直接ID路径，不加凭证要求 |
| 查询只返回部分对象或字段 | `src/pi/annotation-results.ts`回显实际选择；工具说明明确`objects.total`、分页和未请求字段含义 | 不重复增加readScope/coverage摘要；Skill和评测区分各数量 |
| 固定旧版本、固定结果继续计算 | `src/spatial/inputs.ts`验证来源/权限/版本及真实结果；生成几何和原对象选择已明确 | 复用已有检查与错误恢复，不重新创建范围令牌 |
| 失败是否已经修改数据 | `src/pi/annotation-tools.ts`返回错误code/message及outcome；普通拒绝为not_committed，不能确认的写入为unknown并返回原动作ID | 复用恢复信息；不一概宣称所有失败都未写入 |
| 保存分析结果 | `annotation_from_analysis`复用真实结果、读取依据、权限和并发检查 | 保留；评测分别检查实际效果及模型如何解释效果 |

代码路径均相对于`experiments/harness-lab/`。参数合法只能说明调用成立，不能独立证明用户想分析该对象；读取引用也不是限制所有其他查询的名单。

## 已完成工程验证

在独立空间worktree的`experiments/harness-lab`执行：

- `npm run typecheck`：通过。
- `npm run lint`：通过，含Pi和浏览器依赖边界检查。
- `npm test -- tests/annotations.test.ts tests/annotation-results.test.ts tests/spatial-source.test.ts tests/pi/spatial.test.ts tests/pi/map-skill.test.ts tests/pi/provider-payload.test.ts`：6个测试文件，57项通过。

这些是已有后端与加载机制的确定性验证，不是真实模型测评。原测试和产品实现未修改，不重复增加只复述现有断言的测试。新的评测代码仍需独立检查；本记录不替代模型90%验收，也不声称Skill试验版已经有效。
