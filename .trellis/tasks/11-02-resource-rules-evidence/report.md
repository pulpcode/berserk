# 第二轮：规则与证据说明实施记录

状态：第二轮实现和离线检查完成（2026-11-03），等待独立验收题包审阅；不是模型测评报告。

基线：第一轮`59f942d`。用户要求提交并开始第二轮时工作区干净，第一轮已提交，没有制造空提交。本轮不调用付费模型，不执行4公开+16正式验收。

## 修改内容

- 工具：新结果使用schemaVersion3，派生状态原因、时间含义、数量范围、成员重叠及位置缺口说明。已有状态不重算；旧v1/v2模型正文和读取保持原样。
- Skill：两份受控Skill版本升为3。单范围真实歧义先追问，明确引用直接处理，明确比较分别回答。强调过程说明和最终回答都需要证据，不减少用户要求的必要答案。
- 界面：只同步现有资源结果卡片的依据说明，没有新增引用或写入交互。
- 评测：新evaluation-v2适配显式审阅、最终答复与范围行为分类；产品失败无最终答复时主任务/严格失败、解释N/A，已有过程误述保留。旧评分器、题包、轨迹和分数不改。

## E01—E08对应检查

| 项目 | 内容 | 证据 |
| --- | --- | --- |
| E01 | 来源快照、查询、固定标注版本和业务事实时间分开；缺时间不补造 | resource-explanations测试、真实桌面结果卡片 |
| E02 | 未确认、有效不可用、过期后未知、冲突四种状态不改变；原因可并存 | resource-explanations状态矩阵及原记录不变断言 |
| E03 | 完整汇总成员不因缺单体ID被误称未知；已知重叠和缺实际位置分开 | 投影、SSR和大量成员回归 |
| E04 | 每组保留自己的scope、单位和数量含义 | 不同scope并列投影 |
| E05 | 平台引用只说明相关，分配与支援另有依据 | 有效关系事实与解释对照 |
| E06 | 候选数、统计数和筛选集合分开，同单位不能说成单位不同 | 候选2/统计1及同单位分组 |
| E07 | 严格澄清规则、明确引用、比较请求一致；实际问题才发送准备的回答 | 新评分适配正反例、普通/API真实离线接续 |
| E08 | 产品失败不移出分母，无答复解释N/A；过程误述和基础设施故障另记 | 新评分适配及格式异常反例 |

## 历史材料与校准的含义

[历史原句](historical-explanation-cases.json)共7条，来自旧A03-2、A04-2、A05-1、A05-2、A06-1、A08-1。已核对原轨迹存在对应原句，保留原轨迹/审阅路径及hash。[构造正例](calibration-positive.json)共6条，明确标识为构造材料。

这些检查验证既定审阅结论能否正确转换为分数，以及证据引用和接续格式是否有效；没有重新独立标注旧题，没有证明自动语义裁判准确率，更不是新模型正确率。旧A08/P03争议与原判保留，新题才采用更严规则。

## 独立复核

[复核记录](review.md)记录原发现及修复情况：大量成员的两两交集曾重复放大正文；新评分字段曾缺少运行时枚举检查。已完成修正和回归：重叠说明只列有限示例，原始成员与统计不变；评分运行时JSON枚举及形状错误进入待复核。独立审阅者在最后收尾前受执行额度限制中断，修正后由主会话完成核对，未冒称又一轮独立审阅。

## 最终检查

- [相关Vitest](checks/tests.log)：12文件、165项通过，覆盖第一轮工具回归、E01—E06、历史读取及Skill目录。
- [评分与接续](checks/evaluation.log)：12项通过，包含真实本地HTTP/Pi的普通追问与交互API接续；任务独立TypeScript检查通过。
- [桌面Playwright](checks/browser.log)：2项通过，检查新版依据呈现、分页、权限撤销清除、空间筛选与覆盖缺口。
- [产品类型与Lint/依赖边界](checks/typecheck-lint.log)、[构建](checks/build.log)：通过；保留既有大分包提示。
- `git diff --check`通过。历史原句与旧审阅文件hash核对通过，旧评分文件未修改。

桌面截图：[固定结果与状态依据](checks/resource-card-1440.png)、[空间统计与覆盖缺口](checks/resource-statistic-gaps-1440.png)。

大量汇总回归使用100条汇总、每条500名相同成员：原始437,929字节，最终投影633,388字节；初版曾为34,504,798字节。每条仅示例3条重叠记录、每例5个成员，明确完整性；总交集数量及完整原成员均保留。此次投影约452毫秒，只作本机诊断，不作性能承诺。

最终命令（工作目录`experiments/harness-lab`）：

```sh
npm test -- --reporter=dot tests/resource-explanations.test.ts tests/resource-summary.test.ts tests/context-resource-query.test.ts tests/task-resource-query.test.ts tests/task-resource-spatial.test.ts tests/pi/task-resource.test.ts tests/pi/task-resource-results.test.ts tests/pi/spatial.test.ts tests/pi/map-skill.test.ts tests/resources.test.ts tests/pi/skill-discovery.test.ts tests/pi/skill-metadata.test.ts
node --import tsx --test ../../.trellis/tasks/11-02-resource-rules-evidence/evaluation-v2.test.ts ../../.trellis/tasks/11-02-resource-rules-evidence/continuation-runtime.test.ts
npx tsc --noEmit -p ../../.trellis/tasks/11-02-resource-rules-evidence/tsconfig.json
npm run test:e2e -- tests/e2e/annotations.spec.ts --grep 'resource result card|resource statistic card' --workers=1
npm run typecheck
npm run lint
npm run build
```

首次启动Vitest/Vite受共享依赖缓存的沙箱写入权限影响，获准后按原检查范围运行。这是本地检查环境问题，不是模型任务中断或追加测评。

## 限制与下一步

没有真实模型调用，无法据此判断模型是否更少误述或Skill是否更有效。两轮完成后，仍需单独冻结和审阅独立验收题包，并连接新评分/接续适配、工具缺陷专门门槛；本轮没有自动启动验收。

`hasDraft()`与`annotationRefs`、用户消息无差别降低可用性继续保留为独立待办。本次不新增资源业务状态或通用自由文本拦截机制。
