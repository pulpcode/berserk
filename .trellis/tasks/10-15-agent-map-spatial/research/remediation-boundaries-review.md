# Research: 空间分析修复边界复核

- Query: 核查“只分析”的程序边界、空间结果/Composer 历史兼容性，以及评测器固定结果复用、前置筛选、派生对象传播与来源身份断言。
- Scope: internal；仅只读代码核查和此报告落盘。
- Date: 2026-10-16
- Baseline: 主会话指定 `codex/agent-map-spatial` 的 `661861f`。本研究未执行 Git 操作、未修改产品/Skill/评测代码、未运行测试或新模型试验，未重算历史样本分数。
- Repository: `/Users/lau/.codex/worktrees/agent-map-spatial/berserk`。下列 `src/`、`scripts/`、`tests/` 均相对 `experiments/harness-lab/`。

## Findings

### 1. 结论及确定性

1. **已确认：`AnnotationRequestState` 不是用户写入授权记录。** 它跟踪已读草稿、来源修订、任务当前序号、暂停/未知结果和回执。当前没有可直接复用、由可信宿主建立的“本请求只读”字段；自然语言“只分析”仍由模型遵循。
2. **已确认：不能直接修改共享 `projectSpatialResult()` 的输出形状来缩短模型摘要。** 历史正文与当前投影函数严格比较；旧历史可能因此失去可用性。Composer V1–V5 也有精确文本校验。
3. **已确认：评测器仍有单项断言的漏检和误拒。** 包括固定范围复用只看 ref 出现、前置过滤只看工具次序、派生几何经中间结果传播被误拒、来源对象身份未经独立核对。不能由此宣称所有受影响试次或整个 case 必然误判：其他断言和独立语义审阅可能继续拦截。
4. **未证实：上述问题对总体模型通过率的因果贡献。** 本报告没有新实验，也没有重打分；不能据静态代码推出修复后的百分比、Skill 收益或更换模型的收益。

### 2. 文件与职责

| 文件 | 一句话说明 |
| --- | --- |
| `src/pi/annotation-state.ts` | 请求内已读依据和未知写入结果的状态机 |
| `src/pi/annotation-tools.ts` | 草稿读取、普通编辑/发布、来源复制的模型工具边界 |
| `src/pi/spatial-tools.ts` | 只读计算与精确保存分析几何的模型工具 |
| `src/annotations/service.ts` | 身份、会话所有权、固定版本、CAS 与事务效果边界 |
| `src/pi/lab.ts` | 主 Agent 工具注册、请求生命周期、工具钩子与历史校验 |
| `src/contracts/index.ts` | 当前请求选择 DTO；没有只读操作意图字段 |
| `src/contracts/spatial.ts` | 空间 DTO、模型投影与共享严格解码器 |
| `src/pi/spatial-results.ts` | 真实原生调用和结果引用的验证 |
| `src/spatial/inputs.ts` | 固定结果/标绘/来源对象读取及授权 |
| `src/spatial/service.ts`、`src/spatial/calculation.ts` | 新计算结果构造与集合传递 |
| `src/spatial/geometry.ts` | 当前方法说明、限制说明和几何计算 |
| `src/pi/composer-input.ts` | V1–V5 选择资料的序列化与历史校验 |
| `scripts/probe-spatial-evaluation.ts` | 当前确定性评测断言 |
| `tests/probe-spatial-evaluation.test.ts` | 评测器已覆盖的正反例 |

### 3. “只分析”与写入边界

#### 3.1 已有检查解决什么

- `AnnotationRequestState` 的类注释直接说明 observations 不是 authority；字段没有请求意图或只读策略（`src/pi/annotation-state.ts:11`、`:13`）。
- `beginInference()` 消费已交付且未被改写的读取结果；`draftBasis()` 要求已观察草稿；`assertWritable()` 只拒绝未知效果或暂停状态（`src/pi/annotation-state.ts:21`、`:59`、`:64`、`:70`）。它们避免基于未读/不确定状态继续写，不判断用户是否要求写。
- `annotation_read mode:draft` 会登记草稿依据，即便调用者读取草稿只是为了分析；`mode:read` 不登记（`src/pi/annotation-tools.ts:108`、`:116`、`:119`、`:129`）。因此“已读 draft”不能当成用户同意保存。
- `annotation_from_analysis` 的描述要求“仅用户要求保存时”，但执行代码只验证取消、活跃请求、原生 resultRef、当前授权、幂等回执和草稿依据，再进入保存（`src/pi/spatial-tools.ts:43`、`:47`–`:55`）。
- 保存服务保证目标是自己的会话草稿、来源权限仍有效、几何可无损保存、原几何精确引用和草稿版本未变（`src/annotations/service.ts:320`–`:340`、`:343`–`:352`）。这些条件不包含用户文本语义。
- 普通 `annotation_action`、`annotation_from_source` 同样通过已有状态/CAS 机制执行；若以后采用只读保护，不能只拦 `annotation_from_analysis` 而遗漏其他地图写入口（`src/pi/annotation-tools.ts:131`–`:164`）。

#### 3.2 没有找到可直接复用的可信只读信号

- 主请求 `Active` 具有 `input`、`selections`、`annotationActor`、`annotationState` 和工作交接 `grants`，没有 readOnly/allowed-map-effects（`src/pi/lab.ts:103`–`:112`）。
- `ComposerSelection` / `LoadedComposerSelection` 只有资料引用、Skill、Agent、自动草稿上下文（`src/contracts/index.ts:189`–`:190`）。其中选择资料表示用户提供上下文，当前不是“仅允许此范围”的强制权限。
- 主前台 Agent 在存在 annotationActor 时获得地图编辑及空间保存工具，注册条件没有自然语言“只分析”的分支（`src/pi/lab.ts:725`、`:749`–`:757`）。
- `authorizeRequest()` 检查活跃/取消状态（`src/pi/lab.ts:730`–`:733`）；beforeTool 人工确认逻辑只特判 `bash`、`confirmation_demo`、`work_item_action`（`src/pi/lab.ts:797`）。工作交接 grants 不等于地图只读授权。
- 自动上下文的 `writable` 来自会话绑定可编辑性（`src/annotations/service.ts:130`–`:133`），Composer V4/V5 明确它不代表任务采用权限（`src/pi/composer-input.ts:76`、`:87`），也不代表用户本次要求保存。

**结论：** 本次失败案例中的保存请求被无效 resultRef 阻止，不能证明正确 resultRef + 已读草稿时也会因“只分析”被程序拒绝。当前能够证明的是权限/版本/真实性边界；语义禁止写入的强保证尚未存在。

#### 3.3 建议与待审阅取舍

- 最小修复可以强化 Skill 的效果选择规则及专门回归案例，但必须标注为模型遵循改善，不能宣称形成了硬只读边界。
- 若产品要求硬只读，应先审阅**可信信号的来源**。例如用户明确选择的请求级只读模式可形成宿主策略，但这是新增产品/API 合约，不能假称已有字段可复用。
- 模型自行填写“用户授权写入”、模型分类自然语言、简单关键词匹配，都不能单独构成可信授权。它们可能提升路由，不能作为强保证的依据。
- 应明确策略覆盖哪些效果、何时生效、同一执行中的 steer/followUp 如何改变它、重试/回执读取如何处理。现有同一 host request 可以消费后续用户文本（`.trellis/spec/backend/harness-lab.md:107`），仅在最初提示上分类并永久锁定可能误阻止后续用户明确保存，也可能错误放开后续只读。
- 默认不引入逐次确认流程或独立权限系统；是否增加可见只读入口，应由用户审阅。保留当前 CAS、幂等、回执 reconciliation，不把“新策略”当成它们的替代。

### 4. 历史兼容与最小安全改动边界

#### 4.1 空间结果投影

- 新工具结果正文为 `{format:'spatial.model-result.v1',data:projectSpatialResult(result)}`；details 保留完整 SpatialResult（`src/pi/spatial-results.ts:5`–`:6`）。
- 当前投影移除坐标，保留参数、范围、身份、属性、计数、方法、限制、来源和 delivery；字段由对象展开构造（`src/contracts/spatial.ts:33`–`:37`）。
- 共享 extractor 要求严格已知键、有效字段、`scope` 与 parameters 一致，并比较 `JSON.stringify(model.data)` 与 `JSON.stringify(projectSpatialResult(result))`（`src/contracts/spatial.ts:101`–`:120`）。这是解析后 JSON 序列化一致，受键插入次序影响；不应误称它逐字比较原 JSON 的空白格式。
- 原生 resolver 进一步要求实际成功的 `spatial_analyze` 调用、相同请求/工具调用所有权、原参数 JSON 一致、scope 一致；read 的 delivery 不能变成结果起源（`src/pi/spatial-results.ts:9`–`:29`）。
- 工具钩子改写成功正文/details 会使新证据失效（`src/pi/lab.ts:845`–`:869`）。不能通过 afterToolCall 单方面缩短正文而仍保留成功 details。
- 继续历史会话时会重新解码原始结果；成功记录不再通过会导致 `SPATIAL_RESULT_INVALID` 并禁止继续，而非仅少显示一张卡片（`src/pi/lab.ts:1040`–`:1046`）。浏览器也复用严格解码（`src/web/situation/evidence.ts:93`）。

**最小安全范围：** 默认不改 wire shape、不改 `SPATIAL_MODEL_FORMAT` 对旧记录的解释、不改 resultRef 算法/所有权、不修改旧参数和结果。可先改善新工具描述、Skill 和**新计算时**填入的 `method`/`limitations` 值。现在它们来自 `src/spatial/geometry.ts:13`–`:14`，统一放入每个新结果（`src/spatial/service.ts:22`）；decoder 校验存储值的形状，并未要求等于当前常量。按操作填相关说明可以保持 DTO 和旧历史不变。`read` 应继续返回旧存储快照，不能以新说明重写旧证据（`src/spatial/service.ts:15`）。

若确需短摘要 V2，应单独设计带版本的投影/解码：保留 V1 原函数和严格校验；新工具输出明确版本；读旧结果时仍可证明原生起源，且 delivery 不替代原始身份。要新增跨版本历史、原生 compaction/restart/read/save 和浏览器测试。不能用“只校验部分字段”或“兼容失败就按旧文本展示”为捷径。

#### 4.2 范围优先规则

- 现有输入支持 source、固定 annotation、原生 result（`src/contracts/spatial.ts:5`–`:8`）。读取验证选中对象存在、当前可访问和版本真实；没有验证“它就是用户在自然语言中想要的对象”。
- 当前明确几何选择要求只在运行期读取含生成几何的结果时执行（`src/spatial/inputs.ts:22`–`:32`），旧参数仍可由共享 decoder 校验；这是保留旧历史同时加强新计算的已有模式。
- 首轮范围改进宜放在 Skill/工具描述：显式用户限定优先、不同系统同名不混选、草稿/固定引用/外部来源分别确认。不要悄悄把自动草稿上下文变成唯一范围，也不要将所有显式资料引用追溯解释为排他权限。
- 若未来引入结构化范围限制，应区分用户选择与系统自动附加上下文，并设计新请求契约；强范围策略不应改写历史 scope/parameters，或依靠相同短 objectId 跨来源套用。

#### 4.3 Composer V1–V5

- `recordedComposerText()` 对每个版本选择对应生成函数（`src/pi/composer-input.ts:95`–`:101`）。
- `composerHistory()` 要求 `entry.content === recordedComposerText(input, entry.customType)`，并核对请求/会话所有权（`src/pi/composer-input.ts:103`–`:122`）。这里是完整文本精确比较。
- V2–V5 的部分分支调用 V1 `composerInputText()`；改共享 V1 文案会影响多个历史版本（`src/pi/composer-input.ts:57`、`:69`、`:81`、`:92`）。
- 最小方案不改这些持久正文函数。若必须调整发送时“范围优先”上下文，新增版本并保留全部旧生成器/decoder；或使用已经存在且经过验证的非持久请求提示机制，但必须单独验证 provider 实际输入和历史不变，不能在此假定任何注入点都安全。
- 已保存 Skill 正文/hash 是历史选择的一部分；后续更新 Skill 只影响新加载，不应重写历史 Skill 快照（`src/pi/composer-input.ts:21`–`:23`、`:30`–`:35`、`:47`）。

### 5. 评测器可由代码明确证明的问题

下表每一项均是**单项断言的能力限制**。是否影响某条已记录 trial 的总判定，仍需依据完整证据、其余断言及独立语义审阅，不能由此表重写旧分数。

| 断言 | 已确认缺陷/边界 | 代码依据 | 下一版本建议 |
| --- | --- | --- | --- |
| `reuses_fixed_result` | 仅要求恰好一次 buffer，且某 filter 的 scope 中出现该 buffer ref；不要求 `geometry:true`、不要求出现在 filter 的区域 target、也不确认属于后续请求。geometry:false 引用原点并另作距离筛选也能满足这一单项条件。 | `scripts/probe-spatial-evaluation.ts:132`–`:133` | 按实际参数和请求顺序验证指定旧生成几何沿合法依赖链被用作范围，禁止重算替代；容许合法中间结果传播。 |
| `filter_before_nearest` | 只比较首个 filter 与首个 nearest 的位置，不证明 nearest 使用前置 filter 的结果/等价固定子集。无 filter 时 findIndex=-1，也会满足 -1<nearestIndex；但要求 filter 的 case 还可能由 `method_coverage` 拒绝，不能说整例必过。 | `scripts/probe-spatial-evaluation.ts:98`–`:109` | 检查候选集合、版本、业务条件和实际依赖；分别报告方法语义与特定工具路径覆盖。 |
| `filter_before_summary` | 检查 filter 存在且位于首个 summarize 前，仍不证明分类计数使用筛选结果。 | `scripts/probe-spatial-evaluation.ts:112`–`:116` | 验证 summary 输入集合与目标条件的关联，不只看调用顺序。 |
| 派生几何身份 | 直接 buffer→geometry:true 的对象已支持；但对象经中间 result.items 传递后仍保留原 buffer id，新操作直接 scope 引用中间 result，当前检查强制 scope 引用原 buffer，造成合法链误拒。 | `scripts/probe-spatial-evaluation.ts:79`–`:94`；运行期保留 item 的行为见 `src/spatial/inputs.ts:28`–`:31`、`src/spatial/calculation.ts:36`、`:46` | 建立按时间验证的结果依赖 DAG，并沿真实选择验证 item 身份/几何，拒绝未来/自引用/篡改/重复起源；不要通过接受任何 `spatial:*` id 来放宽。 |
| 来源身份/几何 | 非 annotation 的 item 只要 `source !== undefined` 就通过这部分；不与独立来源快照对比完整 ref、revision、geometry。运行期服务仍有自己的权限和数据检查，此缺陷属于评测独立证据不足，不证明产品可伪造来源。 | `scripts/probe-spatial-evaluation.ts:84`–`:85`；运行期检查见 `src/spatial/inputs.ts:43`–`:67` | 在评测侧保存授权的固定来源快照/版本期望，按完整 tuple 和业务时间核对；不要只与同一工具返回自我对照。 |
| 最终选集 | 取最后一个 filter/nearest，排序后比较短 objectId。可误拒前面已经正确完成、后面是其他辅助计算的链；也不能区分不同系统/类型中同名短 ID；排序后比较不检验返回次序。 | `scripts/probe-spatial-evaluation.ts:104`–`:108` | 明确任务答案对应的结果/依赖及完整身份，最近排序另验次序；完整最终答复仍需独立审阅。 |
| 工具路径覆盖 | 除边界 predicate 允许 relate/filter 二选一外，必须包含列出的工具；完整逐对象 relate 可语义正确但没有 filter，或合法在读取结果上计数但没有 summarize，会被拒。 | `scripts/probe-spatial-evaluation.ts:98`–`:102`、`:112`–`:116` | 核心正确性与工具路径覆盖分列；允许事先声明的等价算法，不按工具名替代语义。 |

#### 5.1 间接传播误拒的静态示例（未运行）

1. B：buffer 生成几何 G。
2. F：`filter input={kind:result,resultRef:B,geometry:true}` 无附加筛选，得到 items 中的 G；item.id 仍为 B。
3. M：`measure area input={kind:result,resultRef:F}`，从 F.items 复用 G。

运行期 `SpatialInputs.read()` 支持步骤 3；F 本身没有顶层 geometry，无需再次声明 geometry:true。评测到 M 时能找到先前 B.geometry，但当前 M.scope 只引用 F，因而第 87 行失败。此例只证明身份断言的误拒路径，不声称真实模型已经走过此链。

#### 5.2 当前已修复/应保留的部分

- `verifiedResults` 只接受此前验证通过的结果且禁止重复 ref 覆盖，直接几何引用检查有效；其未来/自引用/几何篡改用例已有测试（`tests/probe-spatial-evaluation.test.ts:45`–`:78`）。应扩展合法传播，不回退成弱匹配。
- `uniqueSpatialResults()` 在 read 不改变证据的前提下去重，保留原计算位置，冲突 ref 抛错（`scripts/probe-spatial-evaluation.ts:39`–`:48`）；相应测试覆盖 delivery/read 和篡改（`tests/probe-spatial-evaluation.test.ts:121`–`:135`）。
- `no_unrequested_write` 同时检查调用尝试与前后版本 hash；因此失败的保存尝试也计关键失败（`scripts/probe-spatial-evaluation.ts:118`–`:120`）。报告必须区分“尝试被阻止”与“实际写入”，是否同时保留更严格行为门槛是验收定义，不应静默放宽。
- 评测器明确将所有 prose/scope claims 留给独立审阅（`scripts/probe-spatial-evaluation.ts:70`、`:137`）。修复确定性断言不能取代对完整回答的事实核对。

### 6. 建议的后续验证边界（待方案批准后）

1. 先修评测断言，新增上述合法/非法依赖、完整来源身份、无过滤/无关过滤、固定几何/原点混淆测试。只改变新评测版本；保留既有原始成绩和审阅记录。
2. 产品第一步优先改新请求的工具字段描述、按操作方法说明、Skill 的范围选择及答复证据核对，保持结果/Composer wire shape。
3. 如采用新的结构化只读或排他范围策略，单独验收其可信来源、所有地图写入口、steer/followUp、取消、幂等/回执与显式保存合法流程，避免将模型自述当授权。
4. 若新增结果投影或 Composer 版本，必须覆盖固定旧样本 V1–V5、新旧混合历史、真实原生 compaction/restart/read/save、strict rejection、provider 输入和地图显示；不篡改旧历史以“修复兼容”。
5. 模型效果因果用预先冻结的新实验验证；本报告不建议重跑失败直到成功，也不把新试验并入旧分母。

## External References

未访问网络；本次是对指定本地实现和项目规范的核查。代码中方法标记为 Turf 7.2.0（`src/spatial/geometry.ts:13`）。本报告没有据外部文档新增算法正确性声明。

## Related Specs

- `.trellis/workflow.md`：研究落盘、当前禁止实施的审阅边界。
- `.trellis/spec/backend/spatial-analysis.md`：固定结果、共享严格提取、授权与精确保存、独立模型验收。
- `.trellis/spec/backend/map-annotations.md`：草稿/版本/CAS/回执与 Composer V1–V5 兼容。
- `.trellis/spec/backend/conversation-references.md`：显式 Skill 与原生历史快照。
- `.trellis/spec/backend/harness-lab.md`：同请求 steer/followUp、持久历史与 provider 输入边界。
- `.trellis/spec/backend/agent-scenario-validation.md`：协议完成不等于语义成功、完整答复审阅、保留失败与实验条件。

## Caveats / Not Found

- 未找到现有可信的请求级地图只读/排他范围字段。以上结论基于本报告列出的请求 DTO、工具注册、状态机、调用钩子和服务链，不推断别的未检查系统存在等价授权。
- 没有证据表明某个新增只读 UI 模式已被用户接受；这是产品取舍，当前只提出审阅项。
- 没有修改 Skill/工具/评测/夹具，没有调用模型或重打分旧样本；示例均为静态代码推演。
- 没有读取密钥、私有推理、主工作树或 boat；仅研究已指明的独立工作树。
