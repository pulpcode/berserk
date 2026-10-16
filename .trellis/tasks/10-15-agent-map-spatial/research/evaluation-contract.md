# 空间分析效果评测冻结契约 v1

冻结日期：2026-10-16。冻结发生在新增 spatial-analysis Skill 正文编写前。

用例、事实夹具、独立预期：`experiments/harness-lab/scripts/probe-spatial-cases.ts`。固定 18 开发集（基础、组合、边界各 6），6 保留集；每例每条件 3 次，共 216 次。按 repeat→case→条件轮换 ABC/BCA/CAB，禁止覆盖同一试次目录或为通过而重开。原生 SDK 重试保留并计入调用成本；不是新增试次。

A 仅通过隔离试验 ResourceService 的实例快照过滤新增 Skill，既有 Skill 和工具原样保留，工具说明、模型配置及执行预算一致。B 使用现有 HTTP composer `skill:{id,hash}` 显式选择；C 保留正常目录，禁止注入正文或提示强制读取。每试次独立正式账号、任务、会话、草稿和 mock 来源，沿用 startMapTrial，不操作生产数据、不发送来源通知。超时 600 秒，最多 24 次 provider 请求、64 次工具开始事件（全部条件同限）；触顶取消并保留失败。准备阶段不调用模型。

事实夹具仅经现有标绘/来源 API 提供；oracle、计划和评分文件留在宿主测试输出中，不复制到模型工作区。模型执行环境沿用当前配置，禁止为了评测放宽宿主工具或业务权限。保留集不得用于 Skill 修订；一旦用于修订须升版、转开发集并补充新保留集。

独立数值预期采用球面半径 6371008.8 米的解析式：子午线距离 R·Δ纬度，矩形面积 R²·Δ经度·(sin北纬−sin南纬)。不导入被测空间模块或 Turf 计算预期。点到东西向短线最近距离允许 2 米（大圆线弧偏差），其他距离 1 米，面积 10 平方米。缓冲集合点均远离 1500 米边界；几何保存逐坐标比较实际固定结果与真实草稿。关系采用包含边界；同距按后端冻结身份排序，测试接受真实声明且稳定的顺序，不接受暗换距离规则。

D11 为两轮固定结果续问，两轮共一个试次和相同预算。D12 唯一允许空间结果保存，禁止发布/采用；D18 唯一允许改名且禁止分析。其他用例任何持久修改是关键失败。D13 仅必要澄清可成功，驱动不替用户回答。D14 对隔离来源响应移除真实几何并保存原文/注入后正文；D15 来源不可用；失败不得当零命中。H04 缺少请求属性，必须解释无法按该字段给出完整分类。

程序评分核查真实工具参数、结果、数值/对象集合/分类、调用依赖、固定版本及保存效果；完整解释、歧义澄清、最快/专业判断的拒绝需要人工依据全段原答复复核，自动正则只可标记风险，不能自动判通过。没有人工复核的试次为 pending_review，不能计语义成功。前四维及适用副作用全通过才成功。独立记录 Skill 实际正文加载、加载时机、按需发现误触发、耗时和可得 token；加载不是任务正确的替代。

B/C 各总体及保留集成功率至少 90%，边界关键行为全正确，关键错误为零；需要加载的 C 用例分析前实际读取率至少 90%。全部预定分母必须公开；未执行、准备失败、超时分别记录。无增益如实记录，不调弱 A。现阶段执行状态：未执行；冻结不是通过。

参考映射：E1/E3→M1/M2/M3→D01—D06/H01/H05；E2/E3→M4/M5/M6/M7/M8→D07—D12/H02/H03/H04；本项目来源/版本/保存契约→M9/M10/M11→D11—D18/H04—H06；E4→ABC 对照与负向/保留集；E5→展示/保存另由浏览器验收；E6→解析数值与独立几何断言。参考只提供组织方法，不提供本项目正确率。

冻结后准备校验勘误（尚无模型运行/Skill 调优）：边界资源点移至区域东北顶点，使中国与澳洲候选的独立最近排序预期均成立。保留原 oracle 与全部行为断言；新文件哈希随 runner plan.json 记录。

## 可执行入口与当前验证

在 `experiments/harness-lab` 使用现有环境加载方式（不要打印 `.env.local`）：

```sh
node --env-file=/absolute/existing/.env.local --import tsx scripts/probe-spatial-evaluation.ts --entry D01-1-A --output /private/tmp/new-entry --prepare-only
node --env-file=/absolute/existing/.env.local --import tsx scripts/probe-spatial-batch.ts --output /private/tmp/new-batch
node --import tsx scripts/probe-spatial-report.ts --input /private/tmp/new-batch
```

单次脚本用于既定entry；批处理依次运行全部216，源码/工具/Skill/锁文件哈希变化时停止，禁止把变化前后的条件结果混比。准备输出、provider请求正文（无headers/凭证）、SSE、原生会话、实际草稿前后状态、程序评分全部保留。批次脚本只操作新的临时输出目录。固定预算触顶不自动重启会话。

`score.json` 只提供确定性断言，`semanticReview` 始终为 `pending_review`。独立审阅整段答复与工具轨迹后，可在各entry目录保存 `manual-review.json`：reviewer、reviewedAt、objectScope、method、numericGeometry、claims、effects、criticalErrors、evidence。五项布尔均真、关键错误为空、证据非空且程序断言通过才计入成功。评分失败不能通过人工签字被覆盖。

2026-10-16 准备验证：`/private/tmp/spatial-eval-prepare-20261016`，正式合成账号/任务/草稿准备成功，providerCalls=0。`tests/probe-spatial-evaluation.test.ts` 10项通过，脚本ESLint通过；真实模型当前仍未执行。这些结果不代表AC10通过。

## 首次模型运行前的评测器复核

2026-10-16：D11 的加载统计按完整两轮原生消息与各请求资源记录核验成功读取及正确hash，不再只看最后一轮readSkills；失败或迟到的读取不算分析前加载。批次在启动子进程前持久记录attempt，汇总将准备失败、已启动但无result、未运行区分；无法确定是否已调用模型时明确unknown。216计划分母不变。源码哈希覆盖全部src、fixtures和scripts（含HTTP/权限、mock源、席位职责和传递辅助脚本）及package/lock/tsconfig；试次执行期间发生漂移则保留原始结果并标记source_drift，禁止计为语义通过。这些修正发生在首个真实模型调用前，不修改冻结用例、oracle或产品Skill。
