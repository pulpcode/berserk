# 已批准的实施与验收清单

2026-10-15。用户已批准实施与复测；按本清单执行，完成项随证据更新。基线 `efe2fb6`。

## 实施顺序

- [x] 用户审阅批准最新 PRD/design 后，按 Trellis 工作流进入实施；读取 backend/frontend 相关实际 spec，不仅参考本文件。
- [x] 在标注工具边界添加有类型的纯投影与结果格式：模型侧定点省略 hash；成功读结果的 query 直接回显原 objectIds/layerIds/fields，保留 total/offset/limit/hasMore。不引入范围分类或替代计数名。原始写入和旧动作回执进入 Pi details，不改变 service/HTTP/数据库契约。
- [x] 增加新地图输入 v5，模型侧 annotationRefs 省略校验 hash，保留原始 details；v1–v4 文本和校验逐字兼容。保留所有基线/current 与权限说明。
- [x] 接通共享契约 → lab 实时完成/历史快照 → useChat → 现有 EvidenceMapLinks。新旧格式互斥判别与验证共用；保持请求归属、原动作标记、固定引用、对象上限和权限。
- [x] 保持 RequestState 对原始值的管理，覆盖投影后 hook 内容/元数据被修改、失效及不确定结果的边界；错误不变成成功按钮。
- [x] 精简并就近补足 total、分页和字段省略语义，以及无需顺带复述技术标识的说明；不注入甲乙案例、错误原句或固定回答模板，不改 Skill 来强迫模型通关，不改原业务指令或模型参数。
- [x] 完成下列自动验证和原场景复测；更新实际契约 spec，提交实现/验证记录供审阅。本次实施授权本身不包含线上部署或推送。

风险集中在 `src/pi/annotation-tools.ts`、`composer-input.ts`、`history-evidence.ts`、`lab.ts`、`src/contracts/index.ts`、`src/web/useChat.ts` 和 `src/web/situation/evidence.ts`。可新增一个小的标注结果投影模块；不以此重构所有工具或注册统一结果框架。

## 确定性验证

| 组别 | 必须验证 |
| --- | --- |
| 投影与真实结果 | 不修改原对象；已知元信息 hash 不进入新模型工具/引用文本；业务 attributes.hash 不误删；固定 refs、字段值、sourceRefs 时间和错误恢复信息保留；原回执仍含原 hash |
| 查询范围 | 原 objectIds/layerIds/fields 原值回显；无选择时 query:{}；fields 省略/空数组；图层筛选；不同对象数量；摘要和不同业务字段组合；多页/空页；无草稿；不存在/无权对象。total/分页数值不变，禁止用缺 query 的旧结果推断全版范围；没有新增专用范围类型 |
| 原生 Pi 投放 | 捕获实际 provider 请求，确认只有投影 content、没有原始 receipt details 泄回；无需 Skill 也具备关键说明。不能仅断言 TypeScript 返回值就称模型已收到 |
| 实时与历史 | 实时结束、刷新、重开、服务重启、混合新旧历史与压缩后历史显示得到相同固定入口；v1–v4 固定夹具与 v5 混用续聊正常；未知/被篡改输入仍拒绝 |
| 成功入口证据 | 助手捏造 ref/URL/成功语句不生成入口；失败/缺失/未知结果无成功入口；旧 receipt/replay 标原动作；同 requestId 去重，跨请求不借回执，新 details 损坏不回退凑成功 |
| 操作保护 | 原 CAS、权限、创建/修改区别、来源依据、顺序写入、批暂停、取消/未知结果恢复、hook 替换或原地篡改继续按契约执行 |
| 桌面交互 | 点击正确固定发布版/修订，后续修改不漂移、不切换可写目标；重载可用、权限撤销后加载拒绝；不改变布局，不增加移动端用例 |

在 `experiments/harness-lab` 使用项目现有命令：

```sh
npm run typecheck
npm run lint
npm test -- tests/pi/composer-input.test.ts tests/pi/annotations.test.ts tests/pi/map-skill.test.ts tests/context-composer-map.test.ts tests/annotation-map-evidence.test.ts tests/probe-desktop-map.test.ts
npm test -- tests/annotations-acceptance.test.ts tests/annotation-from-source.test.ts tests/pi/annotation-workflow.test.ts tests/pi/annotation-hook-boundaries.test.ts tests/pi/annotation-source-history.test.ts
CI=1 AXON_E2E_PORT=5304 npx playwright test tests/e2e/annotations.spec.ts tests/e2e/situation-map.spec.ts --workers=1
npm run build
```

连同本次新增投影/流式历史测试与受影响 lab/history 用例一并执行；不因列表未写到而略过关联检查。通过后仅在新修改或失败有必要时重跑。需要监听本地端口的验证沿用既有沙箱授权方式，不将环境拦截记成产品断言失败。

## 原场景复测

### 固定批次与对照

以 [上一轮报告](../10-14-map-result-reporting/base-current-validation.md) 的 45 请求为主要对照，保留原默认 5 环境及额外 2 条协同链：

| 原场景 | 操作与本轮重点 |
| --- | --- |
| A01→A02，三次独立主链 | 地图引用来源、复制几何生成标注；手工改名/移位后 Agent 接续改备注。检查真实保存字段、来源时间、模型/回执分离后无操作退化 |
| A03 | 两页面同会话旧表单保存冲突与恢复；不因 UI 结果链改动跳过冲突或丢失未保存输入 |
| A04 | 歧义对象经原预设正常澄清后操作；不能多问技术 ref 或要求操作员帮模型读回执 |
| B01→B02→C01→C02，共三条完整链 | 同席位 A/B 从 P0 独立修改；B 引用固定 A 版本并比较甲备注；发布 P1、管理 UI 采用 P1、各自续改、发布 P2、管理 Agent 比较并采用 P2、无权 A 请求采用旧 P1 |

协同链全程保留既有 P0/baseRef，不能去掉易混淆数据。B02 的固定版和本会话均实际有甲乙；让 Agent 自己选择读取范围，核对本次返回与最终断言，不强迫它执行某个工具序列。重点是不能把没查询的乙断言为不存在。

因本次涉及所有标注结果投影、receipt 查回和读取依据，另外重跑原 `probe-map-workflow.ts --recovery` 的 S01→S02→S03 三例。沿用其原场景和判据，补足来源导入/刷新与恢复的操作回归；这部分与上轮 45 请求基线分开统计，不能假称上轮也覆盖了。

原场景仍为 10 个隔离环境、54 个原业务请求，其中主对照 7 环境/45 请求、恢复 3 环境/9 请求。实际中断、澄清、未完成项照实记录，不为达到数量补写步骤或重复失败分支。

### 三个固定只读泛化案例

另准备一个小型隔离环境，用三个全新会话各执行一个只读请求；复用现有测试登录、会话和取证助手，不建设新验收框架。预先固定至少两个图层、一个含 5 个对象的图层，并让未读取对象及未读取字段确实有内容。名称不使用原甲乙，数量与字段组合也不同。

| 案例 | 业务输入方向 | 验证点 |
| --- | --- | --- |
| G01 图层筛选 | 列出指定图层的对象并给出数量 | 数量属于指定图层，不能扩展成整个版本数量，不能断言其他图层没有对象 |
| G02 分页 | 只展示该图层第 4～5 项的摘要 | 若仅取得后段页，hasMore=false 不代表已看过前面页；区分页内数量、筛选总数与实际已读范围 |
| G03 字段选择 | 只查看对象名称、类型和样式 | 未请求备注/几何不代表其为空；回答无需额外补充未要求的字段判断 |

冻结前固定完整材料和请求原文，不在模型失败后改题，也不向模型提供验收答案。每例只运行一次；若实际调用没有触及要观察的筛选、分页或字段边界，记录该观察点未覆盖，不凭回答看似正确算通过，也不临时强制它重试指定工具序列。

这些案例与原 54 请求单列；计划合计 11 个环境、57 个业务请求。确定性测试证明程序返回契约，三个真实模型案例仅提供额外语义观察；它们不能证明普遍稳定，也不能单独证明参数回显的因果收益。

### 执行步骤

1. 冻结代码、构建、测试、Skill、驱动、原输入和夹具；记录 Git 与文件 hash。沿用 Node 24、既有 DeepSeek 端点，以及原批次 `deepseek-flash`、thinking disabled、max_tokens 393216、stream true、temperature 未显式设置；开跑前核对有效配置，不做模型调参。配置标识相同不保证提供方内部构建相同。固定端口仅供隔离环境，开跑前确认无占用。
2. 先用原三种 prepare-only 模式准备；0 模型调用，正式账号权限隔离、虚构来源与本地瓦片，不接触生产任务。
3. 自动测试通过后，顺序执行默认桌面、额外协同、来源恢复三个原批次，再执行单列的三个只读泛化案例。新增环境同样先完成零模型准备。无失败重跑凑通过；原预设业务澄清、明确采用属于正常步骤，额外人工提示与修正单独计数。
4. 每个请求保留实际 provider 输入、原生工具结果含 content/details、用户输入/引用、全部中途/最终回答、截图、独立前后持久状态。评分和独立快照不注入模型。不要把真实凭据写入证据文件。
5. 离线逐条对照：用户目标 → 实际工具调用及范围 → 完整存储 → 界面固定入口 → 助手解释。模型无需读取的 hash 由程序核对，而非再问模型是否相等。
6. 再次检查冻结文件未改变；如发现范围内缺陷需修复，保留失败批次，建立新代码批次并重跑受影响完整链，不能拼接成同一版本全部通过。

执行命令模板（目录为 `experiments/harness-lab`）：

```sh
LAB_EXECUTION_ENABLED=false node --env-file-if-exists=.env.local --import tsx scripts/probe-desktop-map.ts --prepare-only --port 4361
LAB_EXECUTION_ENABLED=false node --env-file-if-exists=.env.local --import tsx scripts/probe-desktop-map.ts --reporting-recheck --prepare-only --port 4361
LAB_EXECUTION_ENABLED=false node --env-file-if-exists=.env.local --import tsx scripts/probe-map-workflow.ts --recovery --prepare-only --port 4343

LAB_EXECUTION_ENABLED=false node --env-file-if-exists=.env.local --import tsx scripts/probe-desktop-map.ts --port 4361
LAB_EXECUTION_ENABLED=false node --env-file-if-exists=.env.local --import tsx scripts/probe-desktop-map.ts --reporting-recheck --port 4361
LAB_EXECUTION_ENABLED=false node --env-file-if-exists=.env.local --import tsx scripts/probe-map-workflow.ts --recovery --port 4343
```

默认不改驱动。若原取证代码只读取 model content，允许为新 details 增加只读取证适配，须单列差异；业务输入、执行顺序、权限、业务判据和次数不变。批准后沿用此前已获准的隔离 DeepSeek 虚构数据验收范围，不扩大到真实业务资料。

泛化案例使用现有验收助手增加独立入口，不改变上述原模式；该入口的具体命令在实施时记录。其输入不复用甲乙失败句，也不把新案例答案加入产品提示词。

### 通过与停止线

- **操作通过**：原全部必须步骤完成，独立状态与原断言一致，隔离、权限、来源几何、手工续接、并发恢复无回归。
- **界面通过**：所有必需入口来自真回执，实时/历史一致，固定版本不漂移；错误、未知、旧回放不冒充本次新成功。
- **目标改善通过**：实际新模型输入不含标注元信息 hash，三条 B02 无筛选范围扩大，C01/C02 不要求模型复述技术标识，也没有 hash 编造、虚构回执字段或 baseRef/current 回归。输入少了 hash 只证明机制生效，不能单独充当回答准确率提高的证据。
- **泛化观察通过**：G01～G03 均实际覆盖指定边界且无范围扩大、把未读字段当空值或把末页当全量已读；只读前后无持久修改。未触及边界列为未覆盖，不以确定性测试补算真实模型理解通过。
- **整体说明通过**：全部可见助手文本无已证实的实质错误；每个疑点记录用户要求、原话、实际输入/回执和独立数据。中途自纠正仍单列；合理歧义不强判错误。
- **效率**：报告模型/工具调用、错误和自恢复、额外全局查询、保存后读回、耗时和 token。普通保存不得被设计成强制额外查询，不先设置缺乏依据的延迟数字门槛。

未达到任一项就分别报告，不能用“操作通过”掩盖正文问题，也不能把小样本零复现说成普遍稳定。不在失败后临时改 prompt、强制 Skill 或加答案审核来扩大批准范围。

## 实施后交付

实际完成后创建 `implementation.md`、`validation.md`、`semantic-review.md`、`review.md`，报告目标问题前后对照、其他新问题、全部批次和限制。本次规划阶段不预填通过报告；上线另按用户指令执行。

## 本轮执行完成状态

全部计划请求已运行并保留原始证据。复选完成表示已实施/执行/审阅，不代表每条验收标准通过；查询范围及历史备注转述仍有错误，新增精确边界未完整覆盖。实际结果见 [validation.md](validation.md)，不自动扩大修复范围。
