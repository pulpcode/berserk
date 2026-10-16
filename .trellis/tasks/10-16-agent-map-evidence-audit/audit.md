# 地图模型接口与查询证据审计

2026-10-16 · 本轮只读审计及已有本地基线检查。没有新真实模型调用、产品修复、生产访问、Git提交或推送。审阅为本会话自行核查，不声称独立审查。

## 1. 结论与任务书适用范围

1. main已有地图模型结果投影、查询条件回显、固定引用、会话/席位隔离、宿主修订管理和hook保护；这些不是待新建机制。
2. MAP-Q01/Q02有原始输入、实际请求和输出支持，仍未解决。已看到模型在同一回答里先正确复述“按point-a筛选”，随后却推断乙不存在，反证“仅因未提供查询条件”的单一解释。
3. 新增真实范围摘要只能是一个可撤回的表达实验，尚无证据证明它能修复模型推理；不强制同范围、不补隐含筛选、不增加答案裁判。
4. 本次附件与先前交接阶段保存的source-plan逐字相同，原文主线确为交接/附件/后台。按本次用户明确要求，只沿用P0/P1证据方法、固定次数、停止与回退，不执行其交接P2–P6。

任务书源文件：/Users/lau/Downloads/AXON_CODEX_RELIABILITY_PLAN.md，26881字节。
已提交副本：.trellis/tasks/09-22-handoff-attachment-integrity/reliability-2026-10-15/source-plan.md。
两者SHA-256均为 acd36b817527f671ce3b86f63f3459334f2a7c29c88db37fda1a173df4b8227c。

## 2. 真实基线

| 项目 | 本轮实测 |
| --- | --- |
| 仓库根 | /Users/lau/workspace/berserk |
| 当前分支/HEAD/main | main / 3064bc62cbca5221ff907bc0ea0522d57b7ed6db |
| origin/main 与实时远端 | 本地引用同上；git ls-remote origin refs/heads/main也返回同一完整SHA |
| 初始工作区 | 干净；本轮结束只允许新增本任务文档/元数据 |
| 任务书历史引用 | 047ab63e7b78d0767f667836ddc021e274b7a5a0，2026-09-22；其后main有64次提交，不是本次最新运行基线 |
| 上轮地图测评来源 | fdba343包含产品说明整理、报告及评测脚本；实际对照输入来自其提交前冻结构建，不能仅以提交号代替原始payload |
| fdba343→main的产品差异 | 只有src/contracts/collaboration.ts及src/pi/collaboration-tools.ts；地图投影/服务及lab.ts无新增diff。其余为交接测试/报告/日志 |
| 其他工作树 | agent-map-spatial在c9ac309、map-basemaps在a79f1ae，均无未提交修改；前者相对其远端ahead8。未合入main的能力不算本任务已有能力，也不在此修改 |
| Node/npm | v24.14.0 / 11.9.0 |
| Pi声明和实际安装 | @earendil-works/pi-ai、pi-coding-agent均0.85.1；没有声称未找到的独立pi-agent-core包已安装 |
| 锁文件 | experiments/harness-lab/package-lock.json SHA-256：62589991b06ea7485a99c30077e5de838c5bc2570ca7c36619de8306c9fde967 |
| 配置标识 | 本地非敏感allowlist检查：LLM_PROVIDER=deepseek，LLM_MODEL=deepseek-flash；没有输出任何密钥/完整env |
| 实际历史模型参数 | C1/C2原payload：deepseek-flash、thinking disabled、stream=true、max_tokens=393216；两模型对照仅model不同。不能用当前env证明历史输入 |
| 权限策略 | Bash axon-bash-v2，源文件SHA-256：3d73855ac2c54dbaa13f4782d89df9ca7e39fa19c7f25944a98d4079b15b6ee0。地图没有另一个版本号，身份/任务/席位/来源校验随上述源码提交固定 |
| 产品通用指令 | fixtures/common/AGENTS.md SHA-256：0a74564fcc50d3d33231c5e2f272512cecf792f2e4cf376515da57a4a3cb2d07；开发AGENTS/Trellis不是产品模型指令 |
| 线上版本 | 本轮未访问生产，没有足够证据证明生产等同当前main；不从Git状态推断已部署 |

Trellis创建本任务时离线默认分支解析警告后采用main；实时远端SHA已单独核实。任务状态保持planning，未执行task.py start。原交接任务的历史记录不改写。

## 3. 历史演进与真实差异

检查main最近60次提交，并沿地图路径追溯首次引入。唯一相关历史合并25a5a93逐父检查；其内容为任务/席位及Pi工作区整合，早于标注模块，不把合并标题当作地图修复。

| 提交 | 实际代码/测试变化 | 本轮含义 |
| --- | --- | --- |
| 047ab63 | 历史交接说明与三项缺陷记录；尚无本次会话标注模块 | 不能照任务书假定当前缺少单入口、固定副本等，更不能把它当地图基线 |
| 0670019 | 来源态势地图、对象引用和模拟控制 | 来源查询与后续会话标注是不同能力 |
| cbf0628 | 引入AnnotationService/Store、会话独立草稿、固定修订与发布；服务read先筛选再分页 | Q01/Q02所涉及的服务查询语义由此沿用 |
| e9a01b4 | 来源批量导入、AnnotationRequestState、移除模型机械版本参数、Skill及结构化入口；初版工具错误清空依据 | 机械状态已由宿主处理；不是需要再让模型填写revision |
| 9dc1250 | 创建/修改分离、保留无关读取依据、同输出暂停及未知提交恢复；新增原生循环保护 | 旧“空草稿先读/失败清空全部”的障碍已有改进 |
| 4c84f4f / efe2fb6 | 结果说明与基线/当前语义改进；关键说明进入常驻上下文/工具说明；新增provider/历史测试 | 原基线混淆在对应三链未复现，不能重报为当前已复现错误 |
| d79a561 | 新annotation-results投影，content/details分离；query回显；lab与Web统一校验；provider/hook/历史/地图入口测试 | 不能再次设计整套回执分离；已有字段级真实数据未因投影丢失 |
| 7c43e45 | 收窄设计文档 | 仅设计，不算产品修复 |
| fdba343 | read字段/交集/默认范围/total/hasMore说明；报告规则；测试与scope候选报告 | 不改read服务；默认不含query.scope；候选未获采用 |
| 75fc7f1 / 3064bc6 | 交接保护测试及说明A/B；后者仅小范围交接产品文案 | 未改变地图失败的实际接口，不把额外确认改善当地图改善 |

本轮查看了上述相关实际diff和函数，不根据commit标题推断行为。旧read工具早期“hasMore时尚未读完”不能等同后来已明示“末页不证明前页已读”的合同。

## 4. 指定问题记录与证据存在性

以下路径均相对仓库根。报告已在Git，.local运行材料被gitignore忽略；只有仓库clone不能获得完整原始证据。

| 入口 | 本轮核实程度 | 结论 |
| --- | --- | --- |
| .trellis/tasks/10-15-map-query-scope/issues.md | 读取全文并与C1/C2原始输入/输出核对 | MAP-Q01/Q02继续未解决；主线 |
| 同目录model-comparison/plan.md、validation.md、results.json、blind-review.md | 读取计划/结果及关键逐项评分 | 单步模型身份对照，不是自主端到端；各5/12明确错误 |
| 同目录validation.md、scope-candidate.patch及相关语义报告 | 核对候选唯一diff与未采用结论 | 加scope未达门槛；H01测试归属混淆，不能当scope反证 |
| .trellis/tasks/10-14-map-result-reporting/base-current-semantic-review.md | 原B02请求与B02-checks独立快照重新核对 | 固定A:r3确有甲乙；“不存在乙”是错误解释，非丢数据 |
| .trellis/tasks/10-15-map-result-projection/semantic-review.md、validation.md | 核对记录及summary/semantic-outcomes原始文件存在 | hash/回执转述有所改善，但范围误读仍存；三个只读例未完整覆盖边界 |
| .trellis/tasks/10-10-task-plan-validation/agent-map-workflow/recovery-review.md | 原阶段报告及原运行目录存在；本轮重新运行当前机制测试 | 历史故障有依据，已有修复不重建；本轮未重新调用模型跑来源恢复 |
| .trellis/tasks/09-22-handoff-attachment-integrity/bugs.md、reliability-2026-10-15/audit.md | 阅读以核对任务书历史与当前范围 | 交接调查是另一条链；不进入本设计改动范围 |

### 4.1 最新对照输入

执行旧replay.mjs导出的verify，只读核验manifest/script/plan/12份输入及源JSONL整文件哈希，全部通过。来源：

| 案例 | 原始JSONL路径与行号 | 整文件SHA-256 |
| --- | --- | --- |
| C1 | .local/map-query-scope/builds/A/.local/desktop-map-acceptance/2026-10-15T10-17-33.712Z/collaboration-1/model-inputs.jsonl，第9行 | 8fb784a4c06883bd8a6b81e3486c7909fb0af4f0831f3bd467a8c2d148e16d43 |
| C2 | .local/map-query-scope/live/G02-order-3-A/model-inputs.jsonl，第2行 | 6ba14bb086b37335b802b4539863ebaa3e88e054c2a1d183fe8a8a4a30c77c74 |
| C3 | .local/map-query-scope/live/Q01-1-B/model-inputs.jsonl，第1行 | ba33dd757dc7cc7aa86dd7cfd186e4954504a7ac5743c60c9e0030fe009b3407 |
| C4 | .local/map-query-scope/live/G02-1-A/model-inputs.jsonl，第3行 | db6be00d229b023f0341351a9cc9486f5703d426c91c884471899039ca195e01 |

.local/map-model-comparison/manifest.json：SHA-256 f6732d973313b5dd6ee644c1b9460771758b4301a312f5006434d1d65606544e。

runs/01至24均存在request.json、response.sse、result.json、events.json。逐项重读并验证：

- 实际request.json与对应冻结模型输入逐字一致，requestSha256一致；
- 用旧parseSSE重新解析response.sse，正文与tool_calls逐值等于result.json；
- 24/24通过。本轮没有再做一次完整独立语义盲审，沿用已冻结评分并重新核对关键错误原文。

本轮初次临时校验错误地将parseSSE的外层对象当result，报mismatch 1；检查返回签名后改读.result，24项通过。此为本轮审计脚本错误，没有修改原始证据或产品以消除失败。

### 4.2 关键失败原文与实际调用

C1最新冻结输入中：

    A: annotation_read mode=read，objectIds=["point-a"]，fields=["note"]
    B: annotation_read mode=draft，fields=["note"]（未指定对象，返回本草稿全量2项）
    A回执：query明确回显point-a；objects.total=1
    B回执：query明确回显note；objects.total=2

run01原句：

> 本会话的 point-b（集合点乙）在所选引用版本中不存在（该版本按 point-a 筛选读取，total=1）

这不是“完全不知道条件”；同一句明确提到条件仍越界推断。run18同类原句为“引用版本中只有 point-a 这一个对象”。旧B02中B显式查询甲乙、最新C1中B未传对象筛选，两者都保留原貌，不能混成同一份原始调用。

C2最新冻结输入：

    用户要仓储图层第4～5项
    实际 annotation_read {"mode":"draft","offset":3,"limit":2}
    回执 query={}，layers为维修+仓储，objects.total=7
    实际全图该页：storage-2南仓 / storage-3河畔仓

run03仍称“仓储设施图层第4～5项”，并说“该筛选范围内的仓储设施对象共7个”。服务按实际参数返回正确，未发现服务偷换筛选。原始持久状态/准备文件在同目录final-state.json、preparation.json、G02-order-3-A.json；本轮核心复核为调用参数、真实返回和回答，沿用冻结夹具与报告中的正确层内顺序。

### 4.3 更早B02与其他原始材料

早期完整对话：
.local/desktop-map-acceptance/2026-10-15T03-48-32.382Z/collaboration/B02-request-b7c30b11-6760-4445-892f-58ecd051ff40.json

SHA-256：8af66b2d8bf6fe6e675742b43878f5d045d24d487eecfb57caac61675564dadc。

同目录B02-checks.json SHA-256：b3b7651c2c454d99dcdcd5e99559dd98e40a931f65ca88b29a7852ee9c758048。
本轮实际读取value.fixed.version.document：甲note=A现场讨论、乙note=基线备注，均存在。

另外确认存在：

- .local/agent-map-recovery/2026-10-14T08-47-33.036Z/
- .local/base-current-reporting/summary.json、input-and-efficiency-audit.json
- .local/map-result-projection/summary.json、semantic-outcomes.json
- .local/map-query-scope/freeze.json、review-ledger.json、metrics.json、live-audit.json
- .local/map-model-comparison/blind-review-freeze.json

存在性核验不冒充对这些旧批次全部轨迹重新审阅。未来搬到其他机器时，缺少原始文件必须停止“原样重放”；可另准备新合成实验，但要标为新实验，不能从报告反造旧对话。

## 5. 当前真实函数与责任

路径相对experiments/harness-lab；行号对应3064bc6。

| 边界 | 当前文件/函数 | 关键事实 |
| --- | --- | --- |
| 身份/固定读 | src/annotations/service.ts:92 accessible，:120 binding，:172 read | 固定task/seat授权；来源scope全满足才可读；不对隐藏对象先计数后过滤泄漏 |
| 规范化 | src/annotations/validation.ts:178 readInput；service.ts:30 pagination | layerIds/objectIds可同时出现并取交集；先筛选再分页，默认0/50；缺少选中对象安全失败 |
| 工具执行 | src/pi/annotation-tools.ts:74 annotationTools/execute | params是实际执行参数；draft取绑定head；state记录原始basis；read固定引用不建立draft依据 |
| 模型输出 | src/pi/annotation-results.ts:4 annotationToolResult | 已回显提供的objectIds/layerIds/fields；未传则query={}；目前无readSummary |
| 投影与回执 | src/contracts/annotation-results.ts:44 extractAnnotationResult、:61 projectAnnotationResult | 只去已知标注metadata hash；业务attributes.hash保留；写回执与模型data精确配对 |
| 原生状态 | src/pi/annotation-state.ts:22 beginInference、:40 rejectResult、:47 observeDraft、:81 committed | 读取依据按调用pending，普通推理后接受；自身成功提交推进CAS；错误不清空无关依据 |
| hook | src/pi/lab.ts:769 beforeToolCall、:829 afterToolCall、:861 streamFunction | 链接原hook，快照content和details；修改/错误拒绝pending，未知写结果按原回执处理 |
| 自动上下文 | src/pi/composer-input.ts v5生成分支；lab.ts:1075引用解析 | 引用摘要明确只代表所选范围，不自动带整图；基线不代表任务当前；不依赖Skill |
| Web与历史 | lab.ts:592与:1143；src/web/situation/evidence.ts:58 annotationMapEntries、:83 requestMapEvidence | 同request真实回执生成固定入口；不从助手正文提取权限或成功事实；损坏新metadata不退回旧文本伪造入口 |
| 来源态势 | src/pi/context-tools.ts→ContextService；lab注册回调→observeSources | 来源查询已有结构化query；来源几何复制和UTC保存已有机制。本次没有证据要求扩展其模型接口 |

## 6. 问题—原因层级—最小动作

| 问题 | 当前事实/复现证据 | 原因层级判断 | 最小动作与验证 |
| --- | --- | --- | --- |
| MAP-Q01局部→整版不存在 | C1参数/回执齐全仍错 | 已证实模型结论越界；显著性/历史干扰/推理弱点占比未隔离 | 一种事实摘要A/B，原范围不对齐；失败即不采用 |
| MAP-Q02意图→已执行筛选 | C2缺layerIds，query={}，数据与参数一致 | 原调用漏筛选；下一步又未纠正。模型决策/理解问题已发生，默认表达是否重要诱因尚未证实 | 保留错误调用，测发现偏差后的合法补查；不让宿主代补参数 |
| 字段/分页/计数误解 | 既有G/Q/H报告部分错误、部分未覆盖 | 测试设计混杂与模型错误分别保留 | 真实服务准备边界，控制解释与自主业务分开评分 |
| baseRef/current、hash/虚构回执 | 对应后续样本改善/未复现 | 不能宣布普遍修好，也不能声称本轮再次复现 | 不另改协议，保留现有保护与回归 |
| 创建前必读/失败清空全部 | 旧问题，当前代码和回归已改变 | 已有正确宿主机制 | 复用，不建设新状态缓存或第二套edit/write工具 |
| 两边读取范围不同 | 合法查询，核心甲比较可完成 | 客观条件，不是服务缺陷或根因证据 | 必须保留；禁止强制同范围绕开模型错误 |

被反证：模型完全没有收到查询条件；当前没有结果/回执分离；当前必须加载Skill才知道范围；改用Pro就能消除错误。
尚未证实：更显眼的事实摘要有效；错误完全是模型能力不足；同错证明工具设计错误；Claude Code不会发生此类错误。
未知：生产当前版本与表现、任意任务/模型的总体可靠率、本候选真实收益。

## 7. 本轮确定性基线结果

工作目录experiments/harness-lab；未运行带真实provider的probe。

    npm test -- tests/annotation-results.test.ts tests/annotation-map-evidence.test.ts tests/pi/provider-payload.test.ts tests/pi/annotation-workflow.test.ts tests/pi/annotations.test.ts tests/annotations-acceptance.test.ts

6文件57测试通过，14.09秒。

    npm test -- tests/pi/annotation-hook-boundaries.test.ts tests/annotations.test.ts tests/annotation-from-source.test.ts tests/probe-map-query-cases.test.ts tests/probe-map-query-scope.test.ts

初次5文件76测试，75通过、1因本机listen EPERM被沙箱阻断。经工具授权重跑原tests/probe-map-query-cases.test.ts，5/5通过，未改产品/断言。合计11文件133个不同测试通过，不把重跑的5项重复累计；保留原环境失败。

    npm run typecheck
    npm run lint

均exit0；lint包括现有Pi/browser依赖边界检查。SQLite实验性提示为运行时提示。本轮未做build、浏览器或真实模型验收；已有本地通过不证明MAP-Q01/Q02已修复。

## 8. P0/P1交付状态

- 审计已足以支持一个有界、可回退的表达实验；不足以支持新增宿主拒绝或宣称找到唯一根因。
- design.md具体定义候选字段、函数、真实范围来源、hook/回执/历史边界和失败门槛。
- implement.md定义先本地、后历史对照、新边界、原生链路的顺序与预算；付费阶段未执行。
- 本轮没有必要复刻已有正确机制；只新增本任务文档和Trellis元数据。候选实施及真实模型评测待审阅。
