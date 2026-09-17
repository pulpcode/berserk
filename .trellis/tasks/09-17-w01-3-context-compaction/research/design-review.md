# Research: W01-3 规划方案独立复核

> 历史评审，不作为当前实施依据。当前方案见 [设计](../design.md)，检查结果见 [文档检查](../planning-check.md)。

- Query: 对照 Pi 0.85.1 证据，复核本阶段设计的请求边界、再次压缩、原文引用、取消/追加失败与重启，不要求 S3 的事务和自动运行恢复。
- Scope: internal；规划审阅，没有修改设计/产品，没有调用模型。
- Date: 2026-09-17

## Findings

### 总体判断

现有路线可实施，没有发现必须更换内核、引入扩展发现或提前建设 S3 的阻断。独立受控摘要调用、原生 `appendCompaction`、新 AgentSession 重建的分工正确；原始 branch 继续承担页面历史与证据，压缩上下文只承担后续模型输入。

建议主会话在冻结方案前补清下面 4 个有界细节。它们不扩大交付范围，也不需要先写应用代码。

### R1：明确“可引用消息 ID”集合与工具关联字段

- 设计位置：`design.md:72`、`:95`、`:109`、`:134`；`implement.md:32`。
- 当前代码：`src/contracts/index.ts:2–9` 的 PublicMessage 没有工具调用参数/关联 ID；`src/pi/lab.ts:230–235` 只公开有文本的 assistant，纯 toolCall assistant 不进入公开消息投影。
- 问题：归档准备包含“工具名称/调用关联”并不错误，但若把原生纯 toolCall assistant 的 entryId 一起允许为 `messageIds`，结构校验可以通过，而按现有公开消息投影实现的 `history.read` 和页面定位无法找到目标。
- 最小澄清：摘要 `messageIds`、history.read 和页面定位使用**同一份受控持久公开消息 ID 集合**；禁止 `partial-*`、纯内部思考和不可公开原生节点 ID 成为可回查引用。工具调用关联仅作为归档辅助结构，可关联到公开 toolResult ID，不必扩展公共聊天 DTO 暴露工具参数。
- 适用验收：B06/B07 增加纯 toolCall assistant、含思考但无可见文本的 assistant、临时 partial ID。引用校验必须拒绝，而可见的工具结果可分页读取。

### R2：把 0.6I 写成目标，把 I 写成准入线

- 设计位置：`design.md:40`、`:74–78`。
- 当前文字同时给出目标 `E_after ≤ 0.6I` 和最终限制 `E_after ≤ I`，但未明确处于二者之间如何处理。
- 最小澄清：切点在发出摘要调用前根据预留摘要预算一次确定；0.6I 是保留更多后续余量的目标。摘要生成后只要 `E_after ≤ I` 即可继续；不能仅因没达到 0.6I 就再次生成或扩大覆盖。若 `E_after > I`，按已有设计结束，不递归压缩。
- 适用验收：B09 增加一个成功摘要后落在 `(0.6I, I]` 的边界案例，确认只发生一次摘要调用和一次正常 prompt。

### R3：追加失败后的 finally 必须禁止任何旧 manager 追加

- 设计位置：`design.md:124`、`implement.md:30`。
- 当前代码：`src/pi/lab.ts:429–434` 的 finally 无条件通过 record.manager 写 RESULT_ENTRY，并从该对象生成终态快照。Pi `_appendEntry` 在写盘前已推进内存 leaf（见 `pi-compaction.md` 第 9 节）。
- 方案已要求丢弃污染对象，方向正确。建议把“不能以旧对象提交成功结果”写得更严密：**成功、失败、取消任何 terminal entry 都不能继续追加到旧 manager**。仅修改 status 不足以修复内存 leaf 断链。
- 若新读取的磁盘数据完整，则以明确只读/需核对标记返回本次失败和可信原文；没有可靠 manager 时，不调用依赖污染对象的普通 get()。原会话有怎样的可恢复 UI 状态属于有限故障表现，不需要自动重新摘要/恢复该请求。
- 适用验收：B11 的 append 抛错后，断言 finally 没有再调用旧实例的 appendCustomEntry，不发布未落盘摘要 ID，不留下 active 不释放。

### R4：明确“摘要已提交，当前新用户消息尚未写入”时的重启表现

- 设计位置：`design.md:68`、`:75`、`:136`、`:144`。
- 当前代码：请求资源记录在 prompt 前写入（`src/pi/lab.ts:391`）；当前证据校验器允许遍历结束时仍有 currentRequest（`src/pi/history-evidence.ts:29–59`），启动恢复只检查压缩上下文的消息末尾/工具闭合（`lab.ts:124–135`）。本阶段已计划修正为检查完整 branch，是必要改动。
- 特殊情形：新请求的 RESOURCE_ENTRY 已落盘 → 摘要已落盘 → 进程退出 → 该请求还没有 user message 和 RESULT_ENTRY。原来的最后一条正常 assistant 可能看起来已完成，但新资源记录仍代表未结请求。
- 最小澄清：重启保留已经完整提交的摘要和原文，不合成用户消息，不标 running、不自动调用模型；以未完成/需核对提示处理当前请求标记。本阶段可以禁止直接续跑并让用户按现有恢复入口操作，不要求 S3 的自动接续。若实现选择允许后续新请求，需要先明确如何结束孤立请求标记，不能被新的 RESOURCE_ENTRY 静默覆盖。
- 适用验收：B11 增加准确的“checkpoint 后/prompt 前”断点，区别于正常结束后重启；检查 pending request 不被压缩摘要掩盖。

### 已核对通过的关键机制

1. **完整旧请求边界**：设计 `firstKeptEntryId` 指向保留 user，当前输入在压缩提交后只 `prompt` 一次，匹配 Pi 的保留区重建；不依赖默认 split-turn 行为。
2. **再次压缩覆盖**：设计明确从前次 firstKeptEntryId 开始，携带前一摘要，未错用“前次 compaction entry 之后”。建议测试使用前次保留区中一个唯一定义事实，证明没有遗漏，而非只比较消息总数。
3. **JSON 与原生摘要**：宿主严格 JSON 经过验证再渲染为原生 summary 文本可行；Pi 只要求 summary 字符串。渲染必须保留可回查 ID 及宿主效果说明；details 中结构/渲染文本对应关系应被版本化验证，不能一份给 UI、一份给模型内容不一致。
4. **摘要无工具**：静态摘要 context、无 schema、独立用途计数，避开当前回答 onPayload 提醒和调用状态混用，符合实际流路径。
5. **无隐式重放**：默认自动 compaction/retry 关闭；本轮工具结果超限时停止，不能触发原生 overflow retry 或重新 prompt 原消息。摘要重试不调用业务工具，明确最多两次，保持原请求截止时间。
6. **当前规则与原文**：摘要属于历史数据；当前 AGENTS/提醒每请求固定加载；history.read 从原始 branch 找历史 toolResult，不用当前 source 替代，隔离边界正确。
7. **持久化范围**：文档已承认同步 JSONL 无 fsync/事务保证，并把正常重启续聊与运行中自动恢复区分开，没有要求原生内核提供不存在的保证。
8. **不丢模型使用费信息**：成功 CompactionEntry 能承载 usage；失败/取消摘要另由请求结果统计；不存在“未写 checkpoint 就免费”的隐含假设。

## Files Found / Reviewed

- `prd.md`：用户需求与 S2b 范围。
- `design.md`：Pi 分工、预算、结构化摘要、原文工具和失败恢复。
- `acceptance.md`：B01～B13，确定性与真实模型证据分开。
- `implement.md`：P1～P6 顺序与必须先解决的工程细节。
- `review.md`：用户审阅入口。
- `research/pi-compaction.md`：同版本接口和真实持久化行为依据。
- `experiments/harness-lab/src/pi/lab.ts`：原始/公开历史投影、恢复判定、请求资源/结果提交。
- `experiments/harness-lab/src/pi/history-evidence.ts`：已有请求证据验证器。
- `experiments/harness-lab/src/contracts/index.ts`：公开消息边界。

## External References / Related Specs

- 沿用 [Pi 0.85.1 研究](pi-compaction.md) 中已核验的同版本官方链接，本轮未引入不同版本 API。
- `.trellis/spec/backend/harness-lab.md`：固定快照、无自动重放、Pi 类型封装、公开字段与既有效果边界。
- `.trellis/workflow.md`：当前只规划与审阅，未激活实施。

## Caveats / Not Found

- 这是规划评审，不是应用实现验收；没有执行真实模型、持久化故障注入或浏览器测试。
- 不审定模型容量来源本身，相关专门研究见 `model-budget.md`；这里检查的是容量/估算如何影响 Pi 调用和边界。
- 上述 line 引用对应评审时的文件；主会话若补充段落，行号会移动。
- 没有要求数据库事务、无限长对话、多轮摘要递归、跨会话检索或 S3 自动恢复。

## 修订后闭合复核（2026-09-17）

重新只读核对修订后的 `design.md` 和 `acceptance.md`。R1～R4 的核心契约均已闭合，没有新增的方案阻断。

| 项目 | 修订证据 | 结论 |
| --- | --- | --- |
| R1 公开消息 ID | 设计第 4 节步骤 5 明确引用目标必须能在现有公开投影读回，纯 toolCall/思考/custom 节点不可引用；第 5 节重复要求与 history.read 共用投影；B06 有负例 | 闭合。history.read 只针对持久消息，临时 partial 不满足该条件 |
| R2 目标与准入线 | 第 3.1 节明确 0.6I 是目标，最终 `E_after≤I` 且 `E_after<E_before` 就继续，不再次生成；B02 覆盖目标以上但仍可容纳的情况 | 闭合，另加入实际缩小条件，防止无效压缩 |
| R3 污染 manager | 第 7 节明文禁止 finally 向旧 manager 追加成功/失败/取消任何终态；B11 对应断言 | 闭合。实施时仍需在该故障分支生成可信只读快照，不能走污染实例的普通成功路径 |
| R4 checkpoint/prompt 间隙 | 第 9 节明确摘要保留、无终态资源记录识别为未完成、不重发输入/工具、不承诺恢复未持久化文字；B11 增加准确断点 | 核心闭合，无需 S3 自动接续 |

R4 还有一个非阻断的措辞注意：当前代码的恢复入口是 `recoveryWarning` 并要求新建会话（`src/pi/lab.ts:133–135、:361`），没有现成的“结束孤立请求后恢复同一会话”接口。第 9 节“原请求按现有中断规则结束后”应按现有恢复提示/新建会话理解；如果后续实施选择允许同会话显式新请求，P3 须先定义孤立请求的终态处理，不能暗示现有代码已支持。无需为了闭合本阶段而建设 Run 接续。

本次仅追加评审记录，没有编辑设计正文、应用代码或运行配置，没有进行真实调用或将未执行验收标为通过。
