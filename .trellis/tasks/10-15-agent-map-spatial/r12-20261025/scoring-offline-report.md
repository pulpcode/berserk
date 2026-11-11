# R12 A：离线评分修复与核查

状态：已实施并完成离线核查。新增模型请求 **0**；没有重新运行或重新付费评分R11的64项任务。

## 修复内容与实际结果

| 问题 | 本次处理 | 实际旧记录核查 |
| --- | --- | --- |
| 把第一轮预览状态当成第二轮保存状态 | 每轮单独索引用户请求、当轮新增公开消息及before/after状态 | Q06-1-S1-P、Q06-2-S1-N都是第一轮rev1→1、第二轮rev1→2；新增对象在derived图层，名称和几何匹配，原文档、发布与采用状态未改 |
| 读取旧buffer结果被计作再次生成 | 按原始请求中的toolCallId和operation去重计数；回执用外层toolCallId对应实际调用 | Q04-2-S1-N是2次buffer、1次read；最终筛选引用第一次500米结果，0命中、5候选。旧knownResult=different原样保留，R12诊断为matching |
| 分项和总评相互矛盾 | R12由程序汇总：fail优先，其次pending，最后pass；模型总评可省略，若提供则原样留档并标记冲突 | 新协议构造检查通过；缺字段、非法枚举、无证据、无效行号不补默认值 |
| 用新协议改写旧失败 | R11历史判断仍按其原契约核对 | 64条仍为61有效、相同3条judge_error，未把旧pending/fail改写为新的通过 |

固定范围工具结果正确，只解决Q04的评分程序误报。其原回答“其次是边界点”仍有独立的排名错误，不能据此改成严格通过。Q06最终保存正确也不能自动证明它此前每句过程说明都正确。

## 可复用接口

`scoring.ts`提供：

- `summarizeTurns(turns)`：逐轮状态、实际新增消息、公开说明和工具回执；保留完整文本，不做关键词语义评分。
- `stateDelta(before, after)`：对象增删改、修订号、发布/采用变化和只读状态比较。
- `spatialCallSummary(calls, messages)`：基于真实调用计数；区分读取与计算。
- `fixedBufferFilterEvidence(...)`、`exactSavedGeometry(...)`：本次已证实错误的确定性回归。
- `aggregateAxes(...)`、`assessJudgment(...)`：结构校验和程序汇总；不证明语义标签或证据解释本身正确。

`assessJudgment`的新R12输入用schemaVersion=2、七个分项、severity、clarity、reason和evidence；总评verdict不再必填。历史R11仍使用schemaVersion=1及原必填总评，矛盾继续记为judge_error。模型总评与程序结果冲突不改变原值，严重程度与程序总评也须一致。

## 离线语义材料与边界

[语义复核材料](scoring-semantic-review.json)保存7条材料：4条已获用户确认的历史样例（含C25待定）、2条真实R11误述及既有代理建议、1条明确标注的构造自纠正材料。它们用于检查全文、轮次与证据没有在投影中丢失；不是新校准集、保留集或自动语义正确率。

计划句、同答自纠正和措辞别扭仍需结合上下文审阅；程序不把“将要”“更正”等关键词当作事实正确性的充分条件。新的B/C任务继续按各维度保留公开文本并单独语义复核，不因工具成功自动通过。

## 检查与证据

- `scoring.test.ts`：13项离线回归通过，覆盖真实Q04/Q06和全部64条旧评分，并明确区分构造输入。
- R12 TypeScript检查、三个scoring文件的ESLint：通过。
- [离线结果](scoring-offline-results.json)：记录修正后的事实检查、原3条裁判错误和原文件路径/哈希。
- 对照主会话预先保存的`.local/spatial-r12/r11-evidence-before.json`：4002份R11原始证据文件逐份SHA256一致；该清单哈希保存在离线结果中。
- 未修改R11脚本、冻结输入、原始响应、旧分数或人工标签；未调用模型。

复现命令（仓库根目录；输出路径须不存在）：

```bash
node --import ./experiments/harness-lab/node_modules/tsx/dist/loader.mjs --test .trellis/tasks/10-15-agent-map-spatial/r12-20261025/scoring.test.ts
node --import ./experiments/harness-lab/node_modules/tsx/dist/loader.mjs .trellis/tasks/10-15-agent-map-spatial/r12-20261025/scoring-audit.ts /tmp/r12-scoring-audit-new.json
node experiments/harness-lab/node_modules/typescript/bin/tsc --noEmit -p .trellis/tasks/10-15-agent-map-spatial/r12-20261025/tsconfig.json
node experiments/harness-lab/node_modules/eslint/bin/eslint.js --config experiments/harness-lab/eslint.config.js .trellis/tasks/10-15-agent-map-spatial/r12-20261025/scoring.ts .trellis/tasks/10-15-agent-map-spatial/r12-20261025/scoring.test.ts .trellis/tasks/10-15-agent-map-spatial/r12-20261025/scoring-audit.ts
```

这些检查证明记录定位、计数和结构汇总已修复，不证明自动语义裁判已经重新校准，也不改变原90%验收结论。
