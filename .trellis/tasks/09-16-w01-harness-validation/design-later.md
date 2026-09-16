# W01 后续设计：Harness 扩展、运行管理与可替换边界

日期：2026-09-16。基线：MVP v0.7。状态：后续阶段设计草案，无实现或验证结果。第一步以 [design.md](design.md) 为准；本文不作为 W01-1 的启动或退出条件。

## 当前详细方案与适用优先级

S2a 已形成 [W01-2 具体设计](../09-16-w01-2-workspace-memory/design.md)，状态待审阅。本文件的第 7～9 节继续保存完整目标；涉及本次 S2a 的工作区、原生历史、指令写入与 Skill 接法，以 W01-2 方案为准，不提前套用 S3／S4 的 Run／快照／操作账本。S2b 压缩、S2c 子 Agent 与累计预算仍为待细化草案。

## 使用范围与进入顺序

| 阶段 | 使用本文的范围 | 尚不要求 |
| --- | --- | --- |
| S2 Harness 能力扩展 | 第 7～9 节中的工具／Skill、文件式 Memory、压缩、只读子 Agent 能力语义；先以 Pi 原生会话与轻量请求关联验证 | 持久化 Run／确认／操作账本、平台快照、成果版本和数据导出 |
| S3 运行管理与成果 | 第 3～7 节正式平台对象、完整 Run 状态机、确认、操作账本、成果版本、可靠事件；第 8～9 节对应持久化与异常约束 | 完整跨内核迁移、自研第二内核 |
| S4 可替换边界验证 | 第 4、11 节的平台工作记录、原生协议记录、版本化快照、受控导出与未来切换说明 | 实际自研和完整迁移实施 |

S2 只验证能力行为：S2a 提供最小工作区及会话归属验证指令范围，不等同于业务任务管理；S2c 的父子关联、取消和预算先采用内存请求上下文。S2 的“下一 Run 重载”先对应下一次用户请求；本文中的 TaskScope、正式 Run、输入／压缩快照和操作账本在 S3／S4 才落地；不能因第 8～9 节引用这些后续对象而将它们提前拉入 S2。

S3 从 Pi 原生会话保存方式过渡到平台持久化前，先备份实验数据并制定单次转换验证；历史只读保留，无法转换时明确保留旧会话并创建关联的新会话，不静默丢数据、不重放写动作。平台存储投入使用后，它成为新增运行的事实来源，不长期维护两套可写历史。原生历史保留并不等于 T13 或正式平台恢复已通过。

## 后续内核契约

首增量已有独立 Pi 模块和少量页面事件。S3／S4 再依据实际调用补全 HarnessAdapter：开始／继续执行、宿主工具执行、取消／确认暂停、平台事件和版本化保存恢复。Pi 类型、hook 与原生格式仍集中在适配模块；宿主拥有权限、预算和操作效果，通用存储只保存不透明内核 payload。

该接口及 T13 的确定性契约替身／导出检查均后移。未来自研可实现同一契约接入，但历史迁移须另外验证。以下保留原第 3～11 节编号，便于追踪已有设计引用。

## 3. 统一实现、独立状态

- 一个 Harness 实现被多个会话复用，每个 Run 创建独立的内核实例、取消信号和输入快照。禁止全局可变 messages、工具上下文或当前身份。
- Session 固定关联 `taskId + ownerId`；同任务不同 Session 不默认互读聊天历史。任务共享资料和指令文件按各自配置授权。
- W01 后续阶段的测试账号由服务端固定配置，页面选择后取得开发会话；后续请求从服务端会话解析主体，不能信任请求体中的 ownerId／权限列表。只监听本地回环地址，不承担正式登录或公网部署。
- 同 Session 最多一个非终态 Run，包括待确认。不同 Session 可并发。实验执行器是进程内的有界执行槽位，不是常驻人格 Agent，也不让每个 Session 永久持有 Worker。
- 全局模型请求并发建议为 2，父运行等待子结果时不持有模型请求配额；子运行单独申请，避免父子互等。每次工具调用重新校验身份、任务范围及当前版本。

## 4. 数据与持久化契约

以下是 S3／S4 的目标契约：S3 建立运行恢复所需的平台记录与 Pi 快照保存，S4 补齐独立导出及版本兼容边界验证。数据库仍以 SQLite 为实验候选，安装与迁移须在进入该阶段时验证。

ID 使用不透明字符串；时间用 UTC；所有结构带 `schemaVersion`。下列为最小字段语义，实施时统一定义运行时 schema 与 TypeScript 类型，不在前后端各写一份。

| 对象 | 最小字段与约束 |
| --- | --- |
| TaskScope | taskId、可访问主体、资料引用；S3 预置两个任务，不做完整任务管理 |
| Session | id、taskId、ownerId、engineBinding、revision、activeRunId；身份／任务与内核绑定不可由模型改写 |
| Message | id、sessionId、runId、role、origin、contentBlocks、sourceRefs、createdAt；平台内容块保存完整文本、工具调用参数／结果引用及 toolCallId／operationId 关联，区分草稿增量、完整回合和中断残片；原生协议扩展另存 |
| Run | id、sessionId、parentRunId、continuedFromRunId、engineId、engineVersion、adapterVersion、contractVersion、status、segmentNo、inputSnapshotId、policyVersion、budget、usage、cancelRequestedAt、error、revision |
| InputSnapshot | 当前消息、历史截止点、资料／成果版本、加载的指令文件文本与内容摘要、Skill 版本及不可变正文引用、模型配置指纹及范围；不含密钥 |
| NativeCheckpoint | runId、segmentNo、engineId、engineVersion、adapterVersion、checkpointSchemaVersion、throughEventSeq、throughMessageId、payload；平台管理外层版本和边界，payload 仅对应适配器解释 |
| ProviderRecord | runId、provider／model 标识、协议版本、对应平台消息 ID、原始协议字段；服务端受控保存，不含鉴权信息、不直接返回普通 UI；不以此承诺跨模型通用恢复 |
| ToolOperation | id、runId、模型 toolCallId、toolName、validatedParams、paramsHash、targetRef、expectedVersion、状态、resultRef；记录经校验的实际执行参数、授权和效果 |
| Confirmation | id、operationId、actorId、动作摘要、paramsHash、targetVersion、pending／approved／rejected／invalidated、decisionAt |
| ArtifactVersion | artifactId、version、taskId、生成 Run、Markdown、结构化内容、sourceRefs、状态；版本不可覆盖 |
| InstructionFile | fileId、workspaceId、受控相对路径、当前内容与 contentHash；作为工作区文件保存，输入快照记录当次内容，无记忆条目／采纳状态 |
| CompactionRecord | id、覆盖的平台消息 ID、原文引用、结构化摘要、近期保留边界、模型／配置、前后估算、校验结果和失败原因；原生 entries 映射仅在适配器／payload 内 |
| RunEvent | runId、seq、type、occurredAt、payload、schemaVersion；`(runId, seq)` 唯一且递增 |

SQLite 是实验运行状态和操作账本的事实来源；持久指令文件保存在受控工作区，其加载文本和内容摘要进入输入快照。平台 Message 是独立工作记录，完整保留本轮支持的文本、工具调用和结果关联；UI 文本从它投影。工具原文由 ToolOperation.resultRef 指向保存内容，不能仅保存截断展示文本。来源／成果／Skill 引用指向保留的不可变版本内容，不将内核 entry ID 作为平台主键。

Pi 采用内存 SessionManager，从 NativeCheckpoint.payload 中的原生 header、完整 entries、leafId 恢复，不另建独立 Pi JSONL 事实库。相同内核的精确续接仍使用原生快照；ProviderRecord 独立保存必要协议字段。完整字段保留与转换须由 T02／T08 验证，平台工作记录不保证能直接重建所有内核的内部状态。

S4 实现受控的本地读取／导出函数与测试入口，按显式测试主体和任务范围导出版本化工作记录：消息及工具关联、实际操作结果、指令加载快照和 Skill 版本内容、成果／来源引用及其授权内容。导出读回只还原为只读记录，不创建 Run 或重放工具。普通导出不包含凭证、ProviderRecord 内部推理或 Pi payload；原生记录继续受控保存。此函数不新增页面入口、公共下载 API 或完整迁移服务。

Pi 的订阅通知不保证异步数据库提交完成；`message_end` 也不能直接当作原生 entries 已写入的屏障。因此：

1. 接受输入时，用同一事务写消息、Run、输入快照和创建事件，再执行。
2. 工具效果前先登记 Operation；本地成果写入、Operation 结果和效果事件在同一 SQLite 事务提交。模型调用和网络等待不占数据库事务。
3. 在已核验的执行边界或 `await prompt` 完成／中止后导出原生快照；平台完整消息／工具关联、原生协议记录、状态、快照及对应终态／待确认事件同事务提交并对齐边界。写操作可能已先提交，此时以操作账本为准。启动下一轮先校验内核绑定，再从 Session 最近已提交快照恢复，装配新输入与当前获准的指令文件；不跨会话选择“全局最新”快照。
4. 崩溃留下未完成 Run 时标记 interrupted。只恢复已提交边界；不能完整重建的半个模型回合保留审计但不发给模型。账本中已完成的写效果仍保留，不依赖聊天快照回滚。
5. 指令文件更新使用 expectedHash 校验、工作区文件锁与临时文件原子替换，操作账本先保存目标及前后摘要；文件效果与 SQLite 提交不宣称原子，重启后按文件摘要核对未决操作，再决定是否重试。
6. 不自动重放未完成写动作。后续新 Run 读取已有成果／操作结果并明确接续；需读回被中断回合的来源时按引用查询。

## 5. Run 与交互状态

| 原状态 | 触发与校验 | 新状态 |
| --- | --- | --- |
| 无 | 用户消息入库，Session 无活动 Run | queued |
| queued | 领取执行资源，输入仍有效 | running |
| running | 本轮正常答复或询问补充信息 | succeeded；Session 等待输入 |
| running | 产生具体受控操作，保存确认及可恢复边界 | waiting_confirmation；释放执行资源 |
| waiting_confirmation | 当前有权主体批准，版本／参数仍一致 | queued；同 Run 的 segmentNo + 1 |
| waiting_confirmation | 拒绝 | queued；同 Run 接收拒绝结果，Agent 可解释或调整，不执行该动作 |
| queued／running／waiting_confirmation | 用户取消；停止接收新工作并处理在途结果 | cancelled |
| running | 调用／校验失败且无可用恢复路径，或预算耗尽 | failed，附具体错误 |
| queued／running | 进程异常重启且没有可用执行者 | interrupted，保留已完成效果 |

取消是先保存请求、再传播信号、最后确定终态。期间 UI 显示“正在停止”，并禁止新工具调用；已提交写效果不回滚，无法判断的效果标记 unknown，必须查结果。等待确认的 Run 重启后仍待确认；确认后已排队却重启的 Run 按中断处理，不丢确认决定。

同 Run 的确认接续沿用总预算和操作 ID，不能借接续清零。失败／中断／取消后由用户发起新 Run，并保存 `continuedFromRunId`；普通下一轮也是新 Run。没有无限保持 running 的多轮 Session，也不把每轮普通回复记为待确认。

确认决定与取消请求按 Run revision 串行校验。取消先提交时，确认失效；批准先提交后又取消时，保留已完成效果并阻止新的模型／工具工作。两个请求不能各自读取旧状态后重复推进。

### 确认暂停的内核衔接

受控工具先创建确认，返回完整的 `pending_confirmation` 工具结果，不执行效果。宿主置暂停标记；使用公开的 `toolExecution='sequential'`，同批尚未执行的其它工具返回明确的“未执行，等待确认”。组合安装 `shouldStopAfterTurn`，在完整工具回合结束后停止循环；provider wrapper 拦截意外的下一次请求作为兜底。等内核调用收敛后，保存已闭合的工具回合和快照、置 waiting_confirmation，再释放实例。

批准时，宿主使用存下的参数和 operationId 再校验并执行一次，保存效果；经 `sendCustomMessage(..., {triggerTurn:true})` 注入可查询的结果引用，再继续内核。拒绝则注入拒绝结果。控制消息标记 origin=host，不伪造成用户消息或凭空插入模型工具调用。

这一方案必须通过 S3／T04 实测：Pi 单个工具的 terminate 不保证停止整批，不能仅依靠它；公开 hook／stream gate 的接法、批内无额外效果、原生快照恢复均须核验。若不能稳定做到，先停在适配验证，修改设计后再继续，不用永久挂起 Promise 模拟待确认。

## 6. 命令与事件接口

统一返回 `{data, requestId}` 或 `{error:{code,message,retryable,details},requestId}`，details 不含凭证。403 为越权，409 为活动 Run／版本／幂等冲突，422 为 schema 或引用错误；模型异常作为 Run 事件和 error 保存，不能伪装 HTTP 成功即可完成任务。

| 接口 | 用途与约束 |
| --- | --- |
| `GET /api/dev/identities`、`POST /api/dev/session` | 仅本地实验可用，选择服务端预置身份后建立 HttpOnly 开发会话；不属于正式登录接口 |
| `GET /api/tasks`、`GET /api/sessions?taskId=...` | 返回当前测试身份可访问的范围 |
| `POST /api/sessions` | `{taskId}` 创建会话，主体取服务端身份 |
| `GET /api/sessions/:id` | 历史、活动 Run 和 revision；敏感内核快照不返回普通 UI |
| `POST /api/sessions/:id/runs` | `{text,inputRefs,expectedSessionRevision,continuedFromRunId?}`；Idempotency-Key 必填；返回 202 + runId |
| `GET /api/runs/:id` | 状态、公开步骤、用量与效果摘要 |
| `GET /api/runs/:id/events?afterSeq=N` | SSE 回放和增量；Last-Event-ID 为 runId:seq，校验和请求 Run 匹配 |
| `POST /api/runs/:id/cancel` | 幂等取消，返回已保存的请求状态；终态再次取消返回现状 |
| `POST /api/confirmations/:id/decision` | `{decision,expectedVersion}` + Idempotency-Key；以确认记录绑定的参数执行 |
| `GET /api/artifacts/:id/versions/:version` | 成果原文、结构化内容与来源 |
| `GET /api/sources/:id?version=...` | 获取有权阅读的资料、消息或工具原文；不接受任意文件路径 |
| `GET /api/instruction-files?sessionId=...` | 返回当前会话可加载的文件标识、内容、内容摘要及编辑权限 |
| `PUT /api/instruction-files/:id` | `{content,expectedHash}` + Idempotency-Key；获准编辑，冲突返回 409；下一 Run 重载，不创建记忆采纳流程 |


幂等键按主体、路由及 Session／目标限定，保存请求规范化哈希。相同键同参数返回原结果；相同键不同参数报冲突。Session 的活动约束由事务保证，不能只靠前端禁用按钮。

事件类别：`run.created/state_changed`、`message.delta/completed`、`tool.started/completed`、`artifact.version_created`、`confirmation.required/decided`、`instructions.updated`、`context.compacted`、`child.started/completed`、`usage.updated`。运行状态事件中保留失败／取消／中断原因；不透传内核所有调试事件。

SSE 只发送已提交事件。文本增量按小批次持久化后发送，message.completed 给出完整权威正文；客户端用 messageId／偏移与 seq 去重。首次打开获取快照及游标，再读取大于游标的事件；服务端历史与实时均从同一提交日志按序读取，避免“先查历史、后订阅”漏窗口。慢消费者断开后继续回放，不阻塞执行器；浏览器断开不触发取消。

## 7. 工具、Skill 与成果

每个工具声明 name、version、JSON schema、权限／范围、read 或 write、是否需确认、超时和结果上限。执行结果统一含 `operationId,status,data,sourceRefs,error`，status 可为 completed、pending_confirmation、rejected、unknown；模型只能提出参数，不能提供执行身份或批准凭证。

| 验证工具 | 作用 | 控制 |
| --- | --- | --- |
| `source.list/read` | 列出／读取预置资料和原文片段 | ID + 版本，不暴露任意文件系统 |
| `artifact.read/save_draft` | 读取成果、保存 Markdown 与结构化字段 | 新建返回 ID；修改必须 expectedVersion；每个写操作幂等 |
| `artifact.submit` | 将指定版本交给一个测试审阅目标 | 验证人工确认；只记录实验提交效果，不做完整 WorkItem 流转 |
| `instructions.read/update` | 查看或受控修改已登记的 AGENTS.md 式指令文件 | 限授权工作区与文件 ID，检查 expectedHash；子运行只读，无语义检索／候选采纳 |
| `skill.read` | 获取注册表中固定 Skill 正文 | 保存版本；不能加载任意目录或执行 Skill 脚本 |
| `agent.delegate` | 调用固定只读检查配置 | 单层、输入引用子集、预算计入父 Run |

保留两个固定 Skill：资料综合写作、成果检查。Skill 提供步骤指导、输出要求与引用规则，不增加权限；工具调用由宿主再次校验。读取提示词或资料中的“执行某命令”不改变工具集合。

测试成果为通用 draft 类型：标题、内容、来源引用、待确认事项。校验引用存在且有权读取，区分事实来源与模型推断；不把格式合格等同于事实正确。大型原文保存后返回片段与引用，不能把截断输出称作完整结果。W01 不提供任意 Shell、代码执行、网络下载或用户插件安装。

写操作按目标版本与规范化参数查重复：同 Run 接续重复提交同一效果返回原结果；不同参数且版本已变时返回冲突。工具 schema 验证失败可供模型更正，但更正次数计入总工具上限；写超时不自动换 ID 重试。预置工具串行执行，模型返回多调用时由适配器按顺序处理；后续并行优化不进入 W01 后续阶段。

## 8. Memory 与压缩

### Memory：AGENTS.md 式持久指令文件

本节按用户明确含义修订：Memory 保存工作约定、偏好与规则。复用 Pi 的 Context Files／ResourceLoader，而不是另建结构化事实记忆服务。文件持久保存，新会话或重启后仍可加载；这不共享不同 Session 的聊天历史。

S2a 用一个只读通用指令文件和至少两个工作区各自的 AGENTS.md 验证；S3 再绑定正式任务范围复验。任务文件位于受控工作区，文件 ID 由宿主映射，不能由模型提供任意路径。首版统一 AGENTS.md；CLAUDE.md 是同类概念，若兼容该名称，由清单明确选定文件，同目录不重复加载两份互相覆盖的内容。本项目仓库根 AGENTS.md 属于开发流程，不当成产品运行时记忆。

ResourceLoader 只接收本 Run 获准的文件与内容，关闭开发机全局／祖先目录自动发现。每个新 Run 从文件重新装配指令，恢复历史也不能把旧指令当作当前规则；InputSnapshot 保存文件 ID、文本、hash 和加载顺序。普通基准顺序为通用指令在前、任务约定在后，具体约定可细化工作方法，均不能改写宿主权限或批准业务动作。

用户可通过文件详情编辑，或明确要求 Agent 记住／修改某项约定；获准 Agent 通过 instructions.update 写入，无需再设候选采纳卡。文件修改、删除段落及并发编辑都复用工作区写入校验；下一 Run 使用新内容，当前执行段保持输入快照稳定。确认接续同一 Run 时沿用原指令快照，普通下一轮重载；用户需要立即应用新规则时先停止再发起新 Run。

没有指令文件时可继续普通对话；读取失败或文件超限应明确提示，不使用无提示的旧缓存或截断。指令文本始终计入预算，历史压缩只处理旧对话，不能替代或丢掉当前加载的指令。子 Agent 加载父授权内的相关文件且不编辑共享指令。

不建设 MemoryEntry／MemoryRevision、记忆提取、关键词／向量召回、置信度、失效与候选采纳工作流。文件内容更正直接体现为普通编辑；回查使用已有输入快照和文件操作记录。

### 压缩

配置模型窗口 C、输出预留 O、安全余量 S，输入预算 I=C−O−S；另可设较小实验上限以主动触发探针。每次模型请求前统计系统提示、工具 schema、原生协议字段、消息、记忆、资料和子结果，不只估算聊天正文。

超过输入预算的 80% 时先限制非必要资料和可回读工具原文，再尝试压缩完整旧回合；未闭合工具回合不压缩，待确认暂停期间不发起压缩。保留当前目标、用户明确纠正、必要权限约束、近期完整工具块及最新输入；总结旧历史后仍超预算则明确停止，请用户缩小输入。

摘要结构至少包含 goal、constraints、corrections、factsWithRefs、openSteps、artifactRefs、completedOperationRefs。宿主从账本和已保存引用补入权威字段，检查结构和引用存在性；模型摘要只补叙述，不决定授权或操作是否执行。不能声称自动语义校验足以保证没有信息损失，关键纠正须由针对性探针检查。

使用 Pi 压缩扩展点承接上述策略，避免同时运行两套自动压缩。平台记录覆盖的消息 ID 与摘要版本，Pi entries 映射封装在适配器内，原文可回读；恢复时将旧块整体替换为摘要，近期模型要求的 reasoning／tool 字段完整保留。新上下文是否被所选提供方接受必须真实验证。

压缩失败最多重试一次，之后 `COMPACTION_FAILED` 停止；不可压缩的关键输入超限返回 `CONTEXT_TOO_LARGE`。压缩调用也消耗父 Run 的模型调用、token 和耗时预算，不能无限压缩。Memory、历史原文、压缩摘要分别保存，任何一个都不替代操作／确认账本。

## 9. 单层子运行与预算

固定一个 `reviewer` 配置，可读取指定资料／成果／指令文件并输出“发现、依据、建议”，由父 Agent 综合。不具备 artifact 写、instructions 写、确认、委派或工作分派工具。子 Run 使用内部独立 Session、内核实例及原生快照，scope 为父授权与显式输入的交集，parentRunId 固定，不可递归。内部 Session 不进入普通会话列表，通过父运行的子运行视图查询；因此不与父 Session 的单活动 Run 约束冲突。

父 Run 通过 delegate 等待子结果，子失败以结构化结果交回父运行，由父运行说明局限或采用其他处理；不能伪造检查通过。父取消传播给子运行，父级结束前等待子运行停止或记录未决状态；迟到结果只能记入原子 Run，不能污染新会话。

以下为可调整实验默认值，不是性能承诺或已批准费用：主 Run 总模型请求最多 12 次、工具尝试最多 24 次、活跃执行累计 5 分钟；单模型请求超时 90 秒、单本地工具 15 秒。一个主 Run 最多创建 2 个子 Run，子并发 1，每子最多 4 次模型请求。压缩含重试最多 2 次请求；所有子／压缩调用从父总额度扣除，不能额外加算。

实际 token 及 live suite 总调用额度在真实联调前按选定模型配置。每次发出请求前预留输入估算 + max output，完成后按实际 usage 结算；usage 缺失保留保守预留并标记估算。确认等待不占活跃执行时长，但不会恢复已用额度。SDK／HTTP 隐式重试须关闭或纳入同一请求账本。预算耗尽保留已有成果并明确报告。

## 10. 验证页面

```text
┌ 测试任务 / 会话 ┬ 当前会话：等待输入 / 处理中 / 待确认 ┬ 详情 ┐
│ 任务 A         │ 用户目标与引用                       │ 资料 │
│   会话 1       │ 回复、公开步骤、工具结果              │ 成果 │
│   会话 2       │ 成果 v1 → v2，可展开来源              │ 指令 │
│ 任务 B         │ 待确认卡：动作 + 版本 + 批准/拒绝      │ 运行 │
│ 新建会话       │ 输入框                  发送 / 停止   │      │
└────────────────┴─────────────────────────────────────┴──────┘
```

此图是 S3 后的页面建议；首增量只交付会话、对话、只读工具记录与资料查看，具体以主设计为准。指令文件、压缩、确认、成果版本和子运行视图随对应阶段接入。表明“模型未配置”“网络已断开”“正在停止”等真实状态；不要用模拟动画冒充实际工具进展。

完整交互约束见 [交互依据](research/interaction-notes.md)：运行中可编辑下一条草稿，先停止再发送；切会话不取消运行；刷新只回放；中文输入法不误发；流式内容不抢焦点或强制滚动；操作可键盘完成。

## 11. 故障验证与迁移边界

最重要的失败注入点：接受输入但未运行、工具已提交但快照未保存、确认决定重复／过期、SSE 回放转实时、取消与工具提交竞争、压缩失败、父取消与子结果迟到。验收按 [T01～T13](prd.md) 记录可观察结果，而不是只检查内部函数被调用。

实验数据默认位于 Git 忽略的 `config/local/harness-lab/`，密钥在 `.env.local`。只允许明确的数据重置命令清除该实验目录；正常重启不清空历史。每次数据结构变更提升版本，有迁移则执行迁移，无迁移时明确要求备份／重置，不静默读取不兼容快照。

内核快照依赖 SDK 版本；升级先用已保存的 T02／T04／T08 会话验证恢复，禁止一边升级一边宣称旧会话兼容。W01 无外部业务写效果，回滚可还原代码／锁文件并使用对应备份数据。

### 11.1 本期绑定与拒绝行为

Session 创建时绑定选定的内核；每个 Run 固定内核／适配器／协议版本，确认接续不得换内核或重置操作标识。S4 只接纳已验证版本组合；无明确兼容转换时，内核标识或快照版本不匹配返回 `CHECKPOINT_INCOMPATIBLE`，保留消息、成果和操作记录供读取，不静默丢弃快照后继续。更换底层语言以后可通过服务接口实现同一语义，本期不增加跨进程 RPC。

### 11.2 未来完全自研与切换

未来另立任务，逐项接管模型访问、Agent 循环、指令／Skill 装配、上下文压缩和恢复等能力；平台现有工具、授权、任务、成果和文件可继续使用。每个阶段运行相同能力验收，检查实际效果、隔离、故障恢复及用量，不比较逐字输出。

先让新会话使用自研内核；旧会话保留原内核，或在原 Run 已结束、未决操作已核对后，转换完整工作记录／摘要／引用以创建有来源关联的接续会话。真实转换须另测模型协议、上下文限制和历史关联，不能把 T13 的导出读回等同于跨内核恢复。待确认的 Run 先按原绑定处理或明确取消，不直接迁移正在等待的批准动作。

迁移保存原始数据、内核版本和转换映射，已完成写效果只作为记录输入、不重新执行。回退时可停止新内核接收新会话；其已经产生的状态仍按新内核绑定处理，未经反向转换验证不能交给旧内核续跑。全部旧运行完成或迁移通过后，才移除 Pi 运行依赖。完整自研、迁移工具、双内核过渡运行和运行中切换均不在 W01 范围。

进入 M1 时保留验证通过的 contracts、内核适配和探针语料，重新落地正式身份、数据库迁移、API／Worker 分离、可靠作业、协作通知和部署。W01 原型数据不自动迁入生产，W01 结果也不提前勾选 FG／AC。Ubuntu 地址与登录信息到实际部署验证时再请求。
