# Skill与离线评分调整

## Skill

`spatial-analysis`和`map-annotations`目录版本升为3，仍按需读取或显式选择。没有增加宿主提示、强制读取、文本拦截或新的裁判Agent。

空间Skill撤掉“确有独立解释即可分别给条件答案”的宽泛出口：用户要单一范围、选择未明确且影响结果时先问；明确引用直接做；明确比较时分开回答。补充状态原因、时间、每组scope、数量集合及汇总成员的解释边界。标绘Skill仅同步资源解释含义，引用、受控导入、保存规则不变。

## 新评分接口

旧验收目录的`scoring.ts`、`run.ts`、原分数和轨迹保持不变。下一轮题包应导入本目录的`evaluation-v2.ts`，并将该文件纳入冻结清单：

- `scoreReviewV2(packet)`：要求`scoringVersion:resource-evidence-v2`。复用既有全轨迹双审、原句与当时证据校验；每份审阅另填`answer`和`scope`。这些是审阅者阅读实际对话后的明确判断，不是关键词识别。
- `answer`记录实际最终答复的消息ID、完成/产品故障/未完成及证据。没有最终答复时主任务和严格失败，解释为null（N/A）。基础设施故障仍单列为protocol_failure。
- `processExplanation`只检查最终答复以外的事实断言。没有此类断言为null；有错误则false。即使最终答复缺失，原过程误述仍保留在review和此项中。存在最终答复时，主`explanation`仍检查整个助手轨迹，不能用最终纠正抵消早先错误。
- `scope`明确需求是范围已确定、单范围真实歧义或明确比较，以及实际是否先问清、直接完成、分别回答。与原句和证据一起审阅。两审语义决定不同须裁决；理由措辞不同不算分歧。
- `aggregateV2(scores, frozenSlots)`：接受下一轮实际冻结题号，输出固定总分母、主任务/严格通过数、解释适用分母与N/A数、过程解释统计；不自动宣布验收通过。工具修复专门门槛仍由独立验收逐项判定。
- `reviewedContinuation(scenario, observed, match, interaction?)`：按真实问题原句、审阅者、冻结事实ID及（若有）真实questionId/optionIds生成后续动作。内部复用旧`reviewedAction`的问答/选项校验。返回`ordinary_text`或`interaction_api`，业务追问与API覆盖分开记录。普通动作的text通过现有发送函数送入下一轮；结构化动作的response送现有interaction API。未知事实、错误问题或选项拒绝，不能主动塞入隐藏偏好。

本轮没有创建N题包或启动新runner。正式执行前，需要将上述接口接入下一轮运行器、冻结题包与审阅模板；离线通过不是正式验收放行。

## 校准材料与边界

- `historical-explanation-cases.json`是7条真实历史原句，保存轨迹和旧审阅哈希、原句、当时证据及原判。
- `calibration-positive.json`是6条明确标为constructed的正例。
- `evaluation-v2.test.ts`验证原句来源/hash、固定判定到评分的转换，以及澄清与无终答边界。历史原句仅在校准包装中使用，不重新给旧任务评分或改旧报告。
- 测试中的双审输入是确定性构造，不冒称两位独立审阅者重新作了语义判断；这些检查验证契约和计算，不证明模型会照做。

离线命令（仓库根目录）：

```sh
node --import ./experiments/harness-lab/node_modules/tsx/dist/loader.mjs --test .trellis/tasks/11-02-resource-rules-evidence/evaluation-v2.test.ts
./experiments/harness-lab/node_modules/.bin/tsc --noEmit -p .trellis/tasks/11-02-resource-rules-evidence/tsconfig.json
```
