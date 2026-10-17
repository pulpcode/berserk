# 最小设计：读取结果中的实际范围事实

2026-10-16 · 待审阅，未实施。审计依据见 audit.md；要求见 prd.md。

## 1. 决策与假设

只提出一个候选：为成功的 annotation_read draft/read 对象结果，在模型 JSON 的 data 首项增加程序生成的 readSummary，集中表达本次筛选、字段投影、匹配数量和分页。原 query、ref、layers、objects 全部保留，不改查询执行。

待验证假设 H1：相较于分散在参数、工具说明和结果各处的信息，明确默认范围并将范围与数量放在一起可能减少误判。现有数据不能证明 H1；最新失败甚至正确复述了筛选条件后仍断言乙不存在。这也可能主要是模型的推理与报告一致性缺口。

这与旧 query.scope 同属“表达是否有帮助”的实验方向，不宣称发现了新根因。旧实验只增加 objects/layers/all_objects 分类；本候选将事实组合成短摘要，同时覆盖交集、字段和页范围。仍未获益则到此停止，不能继续逐句增加禁令。

## 2. 当前链路与复用边界

    用户消息 + annotationRefs
      → lab.start/请求准备：当前身份、任务与会话；resolveSelections 校验
      → composer-input.v5：小型草稿上下文与固定引用摘要
      → Pi 工具 schema / 原 beforeToolCall
      → annotationTools.execute 接到实际参数
      → AnnotationService.read：授权 → 固定快照 → 筛选 → 字段投影 → 分页
      → annotationToolResult：模型 content / 真实写回执 details
      → lab.afterToolCall：原 hook + content/details 完整性检查
      → 普通推理开始才接受 pending 读取依据
      → 模型解释 / 原生记录 / Web 结果投影

引用只读，不改变 B 的可写草稿；草稿读取可建立该会话修订依据。两者不能被新摘要混写为“只读能力相同”。当前 readSummary 不承载权限、采用状态或可写依据判断。

## 3. 拟改动文件和函数

以下产品路径相对 experiments/harness-lab；只有第一行是候选产品行为改动。

| 文件/函数 | 拟改动 | 理由/边界 |
| --- | --- | --- |
| src/pi/annotation-results.ts：annotationToolResult；新增 describeAnnotationRead | 在成功 draft/read 且存在合法 objects 页时生成 data.readSummary；用同一个纯函数供离线重放复用 | 不增加网络调用、状态、业务字段或模型参数；不是 afterToolCall 重写器 |
| tests/annotation-results.test.ts | 校验摘要与真实查询/页一致；原 query 不变；所有非对象读取及写回执输出不变 | 包括真实服务夹具，不能只有字符串镜像断言 |
| tests/pi/provider-payload.test.ts | 确认实际 provider 得到新事实摘要，schema/Skill/提示词未变，details 中原 hash 不送入模型 | 不以工厂返回值代替真正发送内容 |
| tests/pi/annotation-hook-boundaries.test.ts | 加入“只改摘要”的结果篡改和 before hook 参数变化案例 | 执行后的范围为准；修改过的返回不能建立编辑依据 |
| 本任务 replay.mjs / replay.test.mjs（实施时新增） | 薄重放驱动：复用旧 parseSSE/readStream/endpoint/sha 和新纯函数；冻结、配对、停止、输出证据 | 旧两模型驱动及旧 24 条证据不修改；无第二套 Agent 循环 |
| 本任务只读夹具与评分文件（实施时新增） | 准备 N1–N3 的真实服务结果；固定输入、隐藏真值与评分分离 | 复用 AnnotationService/PiLab/startMapTrial，不向模型注入答案 |
| .trellis/spec/backend/map-annotations.md | 仅在候选获准合入时记录实际新表达 | 实验失败不把候选写成现行规范 |

原场景优先复用 probe-map-query-cases.ts 的 prepareCase、probe-map-result-projection.ts 的 scopeObservations，以及现有桌面/协同准备流程。若为选择单个 B02/G02-order 必须抽出准备函数，只允许测试驱动的无行为变更导出，单列 diff；不重写旧批次或改旧题。

明确不改：AnnotationService.read/readInput、AnnotationRequestState、annotation-tools 的 schema/description/执行流程、composer-input、contracts/annotation-results、lab hook、HTTP DTO、SQLite、web/situation/evidence、MapContext、交接模块。若实际实施需要修改其中任何生产行为，先停止并更新设计。

## 4. 摘要契约：只报告执行事实

新字段是展示数据，不是权威状态、用户意图或模型生成的解释。它只从成功读取的最终参数与服务结果派生：

| 项目 | 事实来源 | 表达 |
| --- | --- | --- |
| 图层筛选 | 执行参数 layerIds | 未传为“未限制”；传入则为“N 个 ID，见 query.layerIds” |
| 对象筛选 | 执行参数 objectIds | 未传为“未限制”；传入则为“N 个 ID，见 query.objectIds” |
| 两种筛选同时存在 | 两个参数均实际存在 | “取交集”；不采用旧 scope 只选一个分类的方式 |
| 字段投影 | 执行参数 fields | 基础 objectId/name/kind/layerId + 指定额外字段；省略/空数组都仅基础摘要 |
| 匹配对象数 | 服务 objects.total | “本次筛选匹配对象数”；不叫整图对象数 |
| 本页 | 服务 objects.offset/limit/items.length/hasMore | 原值逐项呈现；没有前页历史推断或假造的完整性标签 |
| 固定内容身份 | 原 data.ref/title/createdAt | 保留原位置；不另造“最新”“当前方案”等摘要词 |

参数必须是 before hook 后实际进入 execute 并被服务接受的值，不能从用户文字、annotationRefs、模型中途计划、返回对象恰好所属的图层倒推。摘要不补漏传的 layerIds；服务拒绝非法/不存在对象时不生成成功摘要。

基础摘要的 fields 指的是投影规则，不保证每个对象都设置了每个可选字段。不要生成“备注为空”“未返回对象不存在”“已经读取全部历史”等派生结论。

data.layers 的既有含义保持：先按 layerIds 筛选；有 objectIds 时仅保留包含选中对象的图层，且不随对象分页裁剪。它不是保证全图完整的图层目录。本期不为它新增第二份计数或整图信息。

### 展示示例（候选，不是本轮新运行结果）

MAP-Q01 原有 query.objectIds=["point-a"]、fields=["note"] 保留。添加：

    readSummary:
    图层筛选：未限制；对象筛选：1 个 ID（见 query.objectIds）。
    字段投影：基础摘要 + note。
    本次筛选匹配对象数：1；本页 offset=0、limit=50、返回=1、hasMore=false。

MAP-Q02 参数只有 mode=draft, offset=3, limit=2；query 仍为 {}。添加：

    readSummary:
    图层筛选：未限制；对象筛选：未限制。
    字段投影：基础摘要。
    本次筛选匹配对象数：7；本页 offset=3、limit=2、返回=2、hasMore=true。

不能把第二条写成“仓储设施图层第4～5项”。如果模型需要回答该层页面，应自主补查；已有完整固定快照摘要足够时，允许自行筛选，不强制某种工具路径。

摘要只包含固定术语、受控字段枚举和数字，最多 1024 UTF-8 字节；不重复最多500个对象ID、用户备注、名称或几何。完整 ID 仍在 query 中。不会为了控制长度截断业务结果。合法页面超出这一上限意味着实现不符合设计，应在本地验证阶段停止。

## 5. 回执、hook 和兼容性

### 模型结果与真实回执

- 保留 annotation.model-result.v1 外层；只为该版本原本允许扩展的 draft/read data 添加展示字段，原字段语义/结构不变。
- 空草稿 status=empty、receipt、compare、list、所有写入结果完全走原分支，不加 readSummary。
- 写结果 content 仍等于 projectAnnotationResult(receipt)，details.annotationResult 仍由 extractAnnotationResult 校验；不能让新摘要破坏其精确配对或让旧回执被解释为新提交。
- 读取结果 details 仍为空；新摘要不产生“已修改”地图入口。Web 的查询/固定引用与写入回执入口原样复用。
- 不添加 committed、canSetCurrent、当前版本或完整性结论，不把来源属性说成保存字段。

### hook 的位置

摘要在工具返回之前形成，所以现有 afterToolCall 快照包含它。原 hook 若修改摘要、content、details 或置错，仍按原逻辑 rejectResult；已提交写入丢失结果的 uncertain 处理不变。

不在 hook 后补回“正确摘要”，不在 beforeProviderRequest/onPayload 中清洗/修补答案，也不让伪造的旧格式回执恢复成功 UI。新字段不会赋予新的读取/写入资格。

### 历史及回退兼容

旧 v1 内容没有摘要，继续按原样加载；新旧消息混合仍是正常历史。v1–v5 composer 文本不变，不重写 JSONL。读取展示新增字段不影响数据库、HTTP 或固定版本。

候选撤回后，新历史里的摘要仍为普通工具数据；旧程序能够原样展示/送入模型，不需要迁移或删除。写回执始终不变，原 extractAnnotationResult 精确核对继续有效。

## 6. 测评设计：先诊断，再核实原链路

所有模型测试待批准。固定 deepseek-flash、thinking disabled，不同时换模型或改 prompt。A 当前表达，B 只增加上述事实摘要。用户问题、历史文字、工具 schema 和业务结果不变。

### S1：历史同输入对照，3例 × 2组 × 5次 = 30次

复用旧模型对照 C1、C2、C4 冻结输入，来源、行号和 hash 见 audit.md。C3 原本带 scope 且无后续工具，是有提示诊断，本批不混入自然业务指标。

- C1：甲备注比较；保留 A 只读甲、B 全部对象的原始不对称范围及前轮乙的上下文。主问答对但多说乙不存在，整答仍失败。
- C2：保留原漏传 layerIds 的调用及中途计划；必要下一步是有效补查。不能把原调用错误算成本轮新模型调用错误。
- C4：正确全摘要+仓储末页，必须完整回答，不靠无必要补查/拒答改善指标。

只改变该最后读取批次的成功对象结果；C1两份都使用同一渲染规则。更早历史不改。读取 tool_call_id 与调用参数一一对应，query 与参数不一致、原始结果缺失/无法解析则停止该案例，不手工猜补。

两组共同将 max_tokens 从历史393216收窄为2048，限制实验成本；其余已保存请求设置保留。明确这是新的有界表达对照，不声称与旧24次请求逐字相同。实际 A/B diff 只允许这一共同设置和目标工具结果的 readSummary；tools 不变。不通过 controlledStream 重放已含宿主提醒的 provider 请求，以免重复注入。

每次只产生一个 assistant 输出，不执行生成的工具。C2的有效工具调用计“正确下一步”，绝不计“任务已完成”。A/B交替，失败不补样本；工具调用和全部可见正文均评分。

### S2：新边界对照，3例 × 2组 × 5次 = 30次

S1满足门槛后才运行。题目/数据/读参/评分须在S1调用前冻结，这些新题不能反过来调候选。由现有服务实际生成读取结果，非人工编写 total。

| 新例 | 真实准备与问题 | 正确下一步/答案 |
| --- | --- | --- |
| N1 组合筛选 | 固定版本有多层；按指定layerIds与两个objectIds的交集读取attributes。问所选两个阀门的压力差异，其他对象保留在完整快照 | 正确比较已读值；不能推断其他层没有阀门；不强制读全图 |
| N2 越界空页 | 一个图层实际8项；该层offset12/limit3，items=[]、total8、hasMore=false。问这一页及该层数量 | 本页空、该层8项；不能说该层为空，不能说已读前8项 |
| N3 未读字段 | 只读某巡检点的style；完整快照里note有值。用户要该点样式及备注 | 用现有样式，按需读取note；不能把未出现的note说成空；隐藏备注不得直接回答 |

这是新数据上的受控读取解释/下一步决策，不冒充模型自主首次查询。可调用工具仍与A/B一致；一输出即停。N3产生合法补查仅算下一步，须保留与任务完成的区别。

### S3：原场景完整循环，2例各3次 = 6次

前两阶段通过后，用当前候选和真实 Pi 循环运行原 B02、G02-order 原问题和隔离夹具。B02保留前轮乙的修改及A固定引用；G02-order保持原保存顺序。调用、读取、补查由模型选择；不强行把坏调用塞入自主链。

各次最多6次普通模型推理，包含B02所需前轮B修改乙的真实对话；A固定快照和初始绑定通过既有服务夹具准备，不消耗模型调用。不伪造“模型此前已做过”的历史来省次数。保留自行纠正，不代答意外澄清；预算内未完成单列。与问题无关的分派、文件和来源写入不运行。用例只读阶段必须无写入尝试且独立前后持久状态一致；准备操作另记。S3是候选的原业务回归，没有同步A组，不能单独作为因果收益证据。

## 7. 验收、停止与回退

- 本地事实正确性、权限、hook、receipt、provider及历史保护全部通过，否则不进入付费实验。
- S1：B的C1/C2各5次均为正确完整答案或该例要求的正确下一步；C4为5次正确完整答案。C1/C2的明确错误各至少比A少2次，且没有更多漏答、无必要拒答/补查。A也全对或差异不足，记“收益未证实”，停止S2/S3，不再凑次数。
- S2：B每例5次全满足各自标准，无额外明确错误；A/B差异原样报告，不要求为了制造收益让A失败。新边界未过即拒绝候选，不能用原例改善抵消。
- S3：两例各3次业务完整成功、全部可见说明准确、无越权/写入/隔离回归。任何失败都保留并停止推广；通过也只支持这批有界案例，不保证一般性可靠。
- 单次模型请求60秒、输出上限2048；S1+S2固定60次，S3最多36次，合计最多96次。累计 provider input（含缓存）达到200万或 output达到6万则停止后续调用；输出按剩余额度在调用前预留2048，不足则不再派发；输入为provider实报的停止阈值，最后一次可能越过，须如实记录。不完整批次记证据不足。只有新的实验请求、模型名称与隔离合成数据范围获授权后才能执行；本轮未消耗模型额度。
- 任意安全/错误写入、回执伪成功、hook绕过或历史破坏：立即停止全部后续阶段。服务/网络失败和截断单列，不重试、不替换。普通语义失败保留本阶段预定独立重复，阶段末判定；不启动后续阶段。
- 未采用时只撤回候选产品diff，保留测试和报告；不清理历史证据，不回退旧的正确机制，不改数据库。若已形成独立候选提交，后续在用户授权合入/回退范围内用定向 revert；禁止 reset/覆盖用户工作树。

最多提出本候选一次。未达门槛时结论是“此表达改动没有足够收益，MAP-Q01/Q02继续未解决”，不转向自动全图查询、强制同范围、额外审查模型或新读取账本。
