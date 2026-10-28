# R16 首题误停：独立只读复核

2026-10-28；对象：`Q07-1-GST`。只分析已有记录，没有修改冻结代码、原始结果或评分文件，没有调用模型、重启批次或补测。

**结论：这是评测器误停，不是真正等待用户澄清。两条原题均已发出并得到完整最终回答。建议按已有证据判本题主任务及严格通过；原始 `waiting_user` 和完成轮数1仍保留，用独立复核说明其错误。其余287项未执行，不能据此评价四组准确率。**

## 1. 实际发生了什么

| 项目 | 原始证据 |
| --- | --- |
| 第一条用户要求 | 以当前草稿reference层的对象ID origin生成700米范围，只预览，不保存。 |
| 第一轮工具 | 一次 `skill_read(spatial-analysis)`、一次 `annotation_read(mode:draft)`、一次 `spatial_analyze(buffer, origin, 700)`。均成功。 |
| 第一轮回答 | 指定点的700米固定结果已生成，说明输入1点、近似方法和没有写草稿；末尾保存/继续筛选是可选邀请。 |
| 第二条用户要求 | 说明刚才这个范围现在的状态，以及你实际做了哪些操作；不要再次计算。 |
| 第二轮执行 | 一次模型请求，零工具调用，直接沿用历史真实工具证据作答。原生请求 `succeeded`，`active=null`，无待响应交互。 |
| 第二轮回答 | 已说明固定结果、半径、对象、保存/发布/采用状态、原草稿修订号和实际工具动作，没有再次计算或写入。 |
| 批次记录 | 4次Provider请求全部HTTP200、版本一致且正常完成；第一题标成 `waiting_user_unmapped_plain_question`，其余287项 `not_executed`。 |

停止发生在第二轮回答已经收到之后，不是模型还在推理、调用工具或等待交互API。`sentOriginalUserTurns=2`、`unissuedOriginalUserTurns=0`，但运行器的 `completedUserTurns=1` 和第二条 `incomplete` 被误判影响。

## 2. 哪条规则误判

触发原句：

> 如果要把它变成草稿对象，需要你另行要求保存；保存会在新修订中生成对象，但不会自动发布或采用。

这句话说明未来保存所需的授权。当前用户只要求说明状态，已经回答完；它没有要求用户必须补充信息才能完成当前任务。

按原始 `turn-2.json` 在本机重放冻结函数，得到：

- `plainClarificationKind = uncertain`。
- `reason = unmapped_question_requires_review`。
- `question` 正则命中的是 **“需要你”**，不是问号或真实的当前任务缺口。
- `offerStart=813`，能够找到“如果”开头的可选条件句。
- `currentTurnTools=[]`、`hasTool=false`。
- `isAllowedClarification=false`。

具体路径：

1. `cases.ts:127` 以“需要你”把整段答复列入疑似追问。
2. `cases.ts:129—132` 原本可以将“已答完，再给可选帮助”判为不阻塞，但依赖 `answerPresent`。
3. `cases.ts:115—118` 的 `answerPresent` 仅看当前 request 的工具消息；除两道纯文本题外，没有当前轮成功工具就直接返回false。
4. 本题第二轮已有前一轮证据，而且用户禁止重算，直接答复是合法行为。当前轮工具数为0并不表示没答完。
5. 后续兜底仍被“需要你”挡住，最终返回 `uncertain`。`live.ts:150—151` 据此记waiting_user并停批；`live.ts:158` 又把第二轮账本记为incomplete。

深层问题是把**“当前轮有工具调用”当成“已经有依据作答”的必要条件**，加上关键词式疑问识别。单纯扩大“如果需要”等关键词名单，不能解决这一条件错误。

## 3. 关键事实能否支持

核对的不仅是宿主真值：第二轮实际发送的 `provider-0004-wire-input.json` 中仍包含前一轮真实 `annotation_read` 和 `buffer` 工具结果，模型可以直接使用它们。没有用模型私有思考作为评分证据。

| 公开说法 | 实际依据 | 建议 |
| --- | --- | --- |
| origin、reference、修订1、700米、固定resultRef | buffer参数、scope、resultRef和完整性记录均一致 | 通过 |
| 只用了1个输入点 | `candidateCount=1`，input限定origin；真实result items对应origin | 通过 |
| 此前读取reference层共有1个对象基点 | draft读取没有过滤条件，`query={}`，唯一图层reference，`total=1`且`hasMore=false` | 通过；本题不是用buffer输入数推断全层数 |
| 未请求几何、属性等额外字段 | 实际annotation_read只传mode:draft；返回对象摘要 | 通过；这句话限定在该次annotation_read，并非否认计算内部取几何 |
| 没有保存、发布、采用、修改草稿 | 工具链只有读取与buffer；两轮before/after完全相同，草稿仍修订1、publications为空、current无publication | 通过 |
| 没有再次计算 | 第二轮无工具调用，全部记录只有第一次buffer | 通过；无需为了证明没有重算而强迫再次读取 |
| AEQD、每象限32段、点缓冲通常128边、近似边缘和距离阈值可能不同 | 模型可见 `method` 与 `limitations` 明确提供 | 通过；未承诺毫米精度或捏造存储机制 |
| “本次输入只有这1个点，构成完整输入，并不代表reference层的全部内容” | 随后明确说明该层此前完整读到1个对象；工具meaning提醒局部输入数不能推出全层数 | 按全文理解为口径提醒，可通过；建议改成“输入数量本身不能证明全层数量”更直白，不因单句歧义硬判事实错误 |
| 另行要求保存才写草稿，保存不会自动发布或采用 | 当前用户只准预览；已加载方法及工具契约区分这些动作 | 可作为条件说明，不是当前任务待澄清 |

建议分项：`mainRequirement=pass`、`processFacts=na`（没有独立公开的过程断言）、`finalFacts=pass`、`effects=pass`、`boundaries=pass`、`strict=pass`。此为独立Agent审阅建议，不冒称人工金标；终评由主会话按既有流程记录，不能覆写原始停止标签。

## 4. 为什么离线检查没有发现

- 六条R15历史邀请回放在 `cases.test.ts` 中仅构造 `{messages: current}`，没有携带真实 `lastResult.requestId`。因此 `answerPresent` 会看到整个历史中的工具，而不是只看当前轮；未覆盖本次“真实requestId＋当前轮零工具”的情况。
- 原生Q07离线检查在第二轮主动调用一次固定结果read，满足了 `hasTool`；结束用通用完成句，没有本次“如果…需要你另行要求”的组合。
- 两类检查都通过，仍不能证明“复用历史证据、零新工具、附条件说明”的路径正确。之前独立复核也没有识别出该覆盖空缺，应如实记录，不把它归咎于模型不按预期调用工具。

## 5. 后续边界

当前只保留误停分析，不修改或重跑。修复方案应分别覆盖已有证据直接答复、真正缺少当前任务参数、答错但已作答、条件性未来授权说明，不能把所有无工具回答直接当作成功，也不能强制本题增加工具调用。修复与继续未执行287项需按停批后的审阅流程处理；本题已有完整两轮证据，无需为了改执行标签重新花费一次模型调用。

首12项检查尚未完成，不应生成继续276项的批准文件。原始一次尝试、4次请求及费用全部保留，不重置live-claim或把本次结果替换成重跑结果。

## 第二轮完整公开答复

**这个范围当前的状态**

- 性质：它是本会话中的一个**固定只读分析结果**，属于快照，不是草稿中的标绘对象。结果引用为 `spatial:e0be2201-8682-4b17-b5f5-0cbb831e6c43:call_00_pi7ac6rq3y1ghfosu7mbzura`，生成时为 2026-10-28T09:19:21Z。
- 形状与含义：中心是对象 ID `origin`（名称“基点”，点类型，位于 `reference` 层），半径 700 米的近似圆形范围，几何类型为面；本次输入只有这 1 个点，构成完整输入，并不代表 `reference` 层的全部内容。
- 保存状态：**没有写入草稿**，因此没有新增标绘对象；也没有发布，也没有设为任务当前。草稿仍为修订 1，此前读取到的内容是：`reference` 层共有 1 个对象“基点”。本次操作没有改变这个状态。
- 精度限制：采用 Turf 7.2.0 的 AEQD 点缓冲，圆弧每象限约为 32 段近似，因此近似边缘与严格的 700 米阈值可能有细微差异。

**我实际执行的操作**

1. 读取空间分析方法的正文，作为操作指引；这属于方法参考，不涉及业务数据。
2. 一次 `annotation_read` 的 draft 模式：只读取本会话草稿（setId 734fcb13…，修订 1）的图层与对象摘要，并按你给的 ID `origin` 定位对象；未请求几何、属性等额外字段。
3. 一次 `spatial_analyze` 的 `buffer` 操作：输入为上述草稿修订 1 的 `reference` 层对象 `origin`，`distanceM` = 700，返回固定 resultRef 与生成几何。这次计算是只读的。

**未执行**：没有再计算或重复缓冲，没有调用任何保存或发布类工具，也没有改动草稿内容和修订号。如果要把它变成草稿对象，需要你另行要求保存；保存会在新修订中生成对象，但不会自动发布或采用。

## 原始文件哈希

- `result.json`：`46b359f2857e33a07a2156fbe48892646937bebb43447169dffdd43cfea9ae47`
- `turn-ledger.json`：`aea50f1912f08968b65d04d6ab8d637a68f5a6635336b60041cd1dc05dd8b9ba`
- `turn-1.json`：`af0576b67f627d88557f69c48b56adee02fbe7b4cc40234ada4660c7cc4b86cf`
- `turn-2.json`：`8749ceaaccfd11b790a3a2af71dd3b92af8cbb738580498747a865489a0726c7`
- `provider-0004-wire-input.json`：`b879272def704d0c45479e79b29dc3bea035867944769143ad12e043f032bc15`
- `tool-arguments.json`：`e6b1b35dde614a83314d5dec5f368af2d8e8f72d4a0b57f07a6ef74b489e03f3`
- `review.json`：`a7a75e6e0cdd4d0cb1726a8284c9180b537bb843a7a74ffe31b33aea2c37f2c2`

本次复核结束时，frozen-execution.json中的全部driver文件仍逐项匹配。仅新增本报告。
