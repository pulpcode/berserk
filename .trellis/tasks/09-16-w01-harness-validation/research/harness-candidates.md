# Research: W01 Harness 内核候选与恢复边界

- Query: Pi 嵌入式 SDK 与 OpenCode server/SDK 包装路线，哪一条更适合垂直场景通用 Harness 首轮验证？
- Scope: mixed；官方文档和固定标签源码核验，未安装、运行或调用模型。
- Date: 2026-09-16

## Findings

### 建议与版本基线

v0.7 按用户要求先采用 **TypeScript + Pi coding-agent SDK 嵌入** 落地多轮对话与最小工具；首步复用原生会话、流式事件和取消，按 C01～C06 独立验收。完整 Harness 能力、运行控制与可替换性后续逐项验证，不同时建设多套适配。

未来全部自研的约束保持：首步先隔离 Pi 依赖，平台工作记录、版本化快照与 T13 导出检查在 S3／S4 完成。Pi 用于首轮验证不代表 M1 长期路线已经定案；完整证据、宿主补齐与维护成本仍须评估。

此前建议第一小步先做数据库恢复与确认暂停，现按 U10 后移至 S3，不作为对话入口的前置。以下能力与高级恢复研究保留为对应后续阶段的依据，尚无实测结果。

| 项目 | 核验结果 | 使用约束 |
| --- | --- | --- |
| Pi 官方上游 | `earendil-works/pi`；当前包名 `@earendil-works/pi-coding-agent` | 不照搬旧 `@mariozechner/*` 示例；SDK API 已有变化 |
| Pi 版本 | 官方 release 最新链接解析到 `v0.85.1`；该 tag 的包声明 `0.85.1` | 这是调研基线；安装时核对 npm 包、锁定精确版本及 lockfile，不追随 main |
| Pi 运行与许可 | ESM，Node `>=22.19.0`，MIT | Ubuntu 仍需验证选定 Node、架构及依赖安装；不是已完成部署 |
| OpenCode 版本 | 官方 release 最新链接解析到 `v1.18.31` | SDK 与 server 必须匹配；正式复核时锁定相同发布线 |
| OpenCode 形态与许可 | `@opencode-ai/sdk` 是 HTTP server 客户端；服务端 MIT，源码包的 build/dev 使用 Bun | 比嵌入路线多一个 server 进程与自身数据管理；不能把安装 SDK 当成具备独立内核 |

出处：[Pi release](https://github.com/earendil-works/pi/releases/tag/v0.85.1)、[Pi tag package.json](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/package.json)、[OpenCode release](https://github.com/anomalyco/opencode/releases/tag/v1.18.31)、[OpenCode SDK](https://opencode.ai/docs/sdk/)、[OpenCode 源码包](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/package.json)、[OpenCode LICENSE](https://github.com/anomalyco/opencode/blob/dev/LICENSE)。未核验传递依赖许可清单。

### 编程语言与全部自研的兼容性

Pi Agent 核心和 coding-agent SDK 使用 TypeScript，构建为 JavaScript 模块；官方仓库分别提供模型访问、Agent 运行时及上层 Agent 包。[核心包声明](https://github.com/earendil-works/pi/blob/v0.85.1/packages/agent/package.json)、[SDK 包声明](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/package.json)、[组件划分](https://github.com/earendil-works/pi/blob/v0.85.1/README.md#all-packages)。这是源码组织事实，不是可无缝替换的承诺。

项目判断：TypeScript／Node 路线与未来自研兼容，可以先替换执行循环、再接管模型访问等组件，最终移除 Pi 依赖；实际顺序由后续目标和实现成本决定。当前应控制 SDK 依赖范围、保留平台工作记录、为原生快照标明内核版本，并用同一能力验收约束未来实现。

首步有意复用 Pi 原生历史，因此尚未具备独立平台工作记录。v0.6 提出的平台内容／工具关联、原生协议记录与快照保留为 S3／S4 设计；T13 后续验证依赖及导出读回，不测试尚不存在的自研内核。跨内核转换、未决操作核对及切换／回退仍是未来专项工作。首步边界见 [design.md](../design.md)，完整契约见 [design-later.md](../design-later.md)，审阅入口见 [review.md](../review.md)。

### 能力划分

| 能力 | Pi 原生／扩展点 | OpenCode 包装路线 | Berserk 宿主必须负责 |
| --- | --- | --- | --- |
| Tool 循环 | Agent 根据返回结果继续调用；自定义工具 schema、事件、前后置 hook | server 内运行，支持 TS/JS 自定义工具 | 身份、对象权限、参数验证、结果引用、预算、幂等与副作用账本 |
| Skill | 资源加载与技能元数据、按需读取指引 | `skill` 工具和权限规则 | 固定审核清单、版本快照；Skill 不能授予工具权限 |
| 历史 | SessionManager entries、分支、恢复 | 会话／消息／子会话 API 与自身存储 | 平台会话范围、原文保存、恢复映射与可见性 |
| 取消 | abort 与 idle；工具接收 AbortSignal | session abort endpoint | 传播到子运行、收敛执行资源、区分已提交副作用，不能声称撤销 |
| 文件式 Memory | 原生 Context Files 加载 AGENTS.md／CLAUDE.md，SDK 可指定文件内容 | 规则文件接入待按选定版本进一步对照，不沿用旧结构化 Memory 标准判定缺口 | 限定工作区文件清单、编辑权限与重载时机；不需要记忆条目库或召回服务 |
| 压缩 | 自动／手动压缩，原始 entries 留存；可替换摘要、报告失败与 usage | 原生 compaction；需核对所选发布线 API | 关键约束与引用校验、输入预算、失败策略、费用合并、压缩记录 |
| Subagent | SDK 明确可用自定义工具创建独立 agent；不等于现成业务子运行系统 | 原生 subagent、Task 权限、children API | 单层、权限子集、父子预算、并发、取消、回传及无共享指引文件直写 |
| 待确认 | 工具拦截、循环停止与恢复可组合；没有直接等价于平台 waiting_confirmation 的完整工作流 | allow／ask／deny 和确认 API | 持久确认对象、暂停后释放槽位、恢复身份和操作绑定、重复决策处理 |
| Web 事件 | 原生流式事件可映射 | server SSE | 平台顺序号、持久事件、重连、权限过滤、最终状态投影 |

来源分工：[Pi SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)、[Pi Agent core](https://github.com/earendil-works/pi/blob/main/packages/agent/README.md)、[Pi Skills](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/skills.md)、[Pi compaction](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/compaction.md)、[OpenCode server](https://opencode.ai/docs/server/)、[OpenCode agents](https://opencode.ai/docs/agents/)、[OpenCode skills](https://opencode.ai/docs/skills/)、[OpenCode custom tools](https://opencode.ai/docs/custom-tools/)。表中宿主职责来自本项目设计，非上游承诺。

### Memory 含义复核（用户澄清后）

用户指 AGENTS.md／CLAUDE.md 式持久指引文件，不要求自动抽取事实、语义召回或候选采纳。此前以更复杂 Memory 合约判断宿主补齐范围不适用，已从设计和验收撤去。

Pi v0.85.1 官方说明支持加载 AGENTS.md 或 CLAUDE.md，SDK 的 Context Files／ResourceLoader 可以限定文件和内容。可复用这一机制，项目负责工作区映射与受控编辑；新 Run 重载、范围过滤及压缩后当前指引保留仍须实测。[Context Files](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/README.md#context-files)、[SDK Context Files](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/sdk.md#context-files)。这澄清了 Memory 成本，未自动解决 Subagent、确认续接和模型兼容等选型问题。

### 工具白名单与资源发现

Pi 当前 SDK 的 `noTools: "builtin"` 可关闭默认内置工具并保留自定义工具；`tools` 可限定启用名称。首步仅注册 source.read，后续按阶段再加入草稿、指引文件、技能和委派等宿主工具；不暴露内置 bash/read/edit/write。**仅改变 cwd 不构成隔离**；自定义 ResourceLoader 只提供已批准资源，避免自动发现本机／仓库祖先目录的扩展、AGENTS 和 Skills。[SDK 工具与资源说明](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)、[ResourceLoader 源码](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/resource-loader.ts)。

OpenCode 默认权限较宽松；可以全局 deny 后放行自定义工具、skill 和限定 Task 类型。宿主仍须阻止客户端直接调用 shell 等原始 server endpoint，并提供隔离配置目录、工作目录与工具实现。权限配置不是多租户沙箱。其 agent 的 Task 权限也不能直接当平台 API 授权。[OpenCode permissions](https://opencode.ai/docs/permissions/)、[OpenCode agents](https://opencode.ai/docs/agents/)。

### S3／S4 持久化研究：SQLite 与原生快照

S1／S2 使用 Pi 原生会话保存，不应用本节数据库接管方案。进入 S3／S4 时再验证以下 `v0.85.1` 公开入口：

- `SessionManager.inMemory(cwd, options?, entries?: FileEntry[])`：从宿主保存的 entries 恢复，不落 Pi JSONL。
- `getHeader()`、`getEntries()`、`getLeafId()`：分别取得头部、原生记录和当前叶子；`getEntries()` 不含头部且返回浅拷贝，提交前序列化快照。
- 保存 header、entries、leafId、内核版本和平台 checkpoint revision；恢复先校验结构与版本，再传 `[header, ...entries]`，必要时 `branch(savedLeafId)`，空树用 `resetLeaf()`。
- `continueRecent/open` 是文件恢复途径，不适用于这里；未使用或假设不存在的 `fromEntries` API。

出处：[固定标签 SessionManager](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/session-manager.ts#L1216)，关键位置 `getEntries:1228`、`branch:1281`、`inMemory:1492`；原生恢复 `_loadEntries:888` 默认重建最后叶子，所以分支指针须另外记录。

**提交边界必须实测。** `AgentSession.subscribe` 的 listener 同步调用但不等待 Promise，且普通 `message_end` 先通知 listener，后 appendMessage，不能在该回调里异步抓快照并假定已持久化当前消息。`session.agent.subscribe` 则按顺序等待 listener；在 factory 返回后注册的宿主 listener 可作为验证候选，检查它确实位于内置持久化处理之后。最终 settled／await prompt 结束之后仍需统一提交 checkpoint。[AgentSession 源码](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/agent-session.ts#L553)、[Agent 源码](https://github.com/earendil-works/pi/blob/v0.85.1/packages/agent/src/agent.ts#L228)。

宿主建议：同一 SQLite 事务提交平台完整消息／工具关联、原生协议记录、事件、运行状态和原生 checkpoint；每个副作用工具执行前先保存 operation intent，结果提交后再继续。SDK 不提供“外部副作用 + SQLite + 内存 Agent”跨边界原子性；进程在结果提交与新 checkpoint 之间退出时，操作账本用于查询／去重，不能盲目重放工具。原生快照用于同内核续作，平台工作记录独立读取／导出，事件用于审计和显示；三者对齐提交边界，UI 不反向改写原生历史。以上为本项目设计建议，尚无故障注入证据。

### S3 确认暂停与接续的公开扩展点

固定 `v0.85.1` 可核验：`session.agent.toolExecution`、`shouldStopAfterTurn`、`streamFunction` 为公开属性；循环在完整工具结果和 turn_end 后调用 shouldStopAfterTurn，返回 true 则结束，不发下一轮模型请求。`before_provider_request` 扩展返回值用于替换 payload，不能猜测为专用暂停指令。[Agent 公共属性](https://github.com/earendil-works/pi/blob/v0.85.1/packages/agent/src/agent.ts#L169)、[循环停止位置](https://github.com/earendil-works/pi/blob/v0.85.1/packages/agent/src/agent-loop.ts#L226)、[扩展类型](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/extensions/types.ts#L642)。

可验证的宿主方案：

1. 设置顺序工具执行；受控工具先记录 pending_confirmation，返回完整工具结果，并设置宿主 pause flag。同批后续工具返回“未执行”，不产生副作用。
2. 在开始调用前安装并组合 shouldStopAfterTurn handler，由 pause flag 结束循环；不在工具自身内部 await session.abort()，以免等待自身结束。provider wrapper 对意外下一次调用作最后一道拒绝，拒绝后的状态映射须测试。
3. 待调用彻底 settled 后，提交原生快照、确认及 waiting 状态并释放执行槽位；确认期间没有挂起工具 Promise，也不保留占用槽位的 Agent。
4. 批准后先按原 operationId／参数摘要核验并执行一次；重建独立 Agent，通过公开 `sendCustomMessage(message, {triggerTurn:true})` 注入宿主操作结果续作。拒绝也产生明确控制结果，不能伪装为工具成功。内核 custom message 的序列化及 provider 接受情况属于真实模型探针。

`sendCustomMessage` 在空闲时可触发新的 Agent 调用；`session.agent.continue()` 也公开，但末消息为 assistant 时会拒绝，且直接调用是否绕开 session 生命周期需独立核验，优先使用高层 custom message 接续。[AgentSession 自定义消息](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/agent-session.ts#L1371)、[Agent continue](https://github.com/earendil-works/pi/blob/v0.85.1/packages/agent/src/agent.ts#L340)。

不能只依赖某一个 tool result 的 `terminate:true`：当前实现仅在**同批全部最终结果**都设置 terminate 时才停止；混合“读取成功 + 请求确认”会继续循环。必须测试这种混合批次，并验证剩余工具无副作用、后续 provider 调用数为零。[ToolCallEventResult](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/extensions/types.ts#L1048)、[批次判定源码](https://github.com/earendil-works/pi/blob/v0.85.1/packages/agent/src/agent-loop.ts#L553)。

### DeepSeek／Kimi 兼容判断

Pi 的 provider 列表包含 DeepSeek、Moonshot AI（含 China）及 Kimi For Coding，并支持自定义兼容端点；OpenCode 也有 DeepSeek／Moonshot 配置。Moonshot API key 和 Kimi Coding 订阅端点不能互换推定。Pi 已列出 DeepSeek reasoning 相关兼容开关，但这只是适配能力依据。[Pi AI providers／compat](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md)、[OpenCode providers](https://opencode.ai/docs/providers/)。

“OpenAI-compatible”不能证明用户实际模型已可用。真实探针须记录 endpoint、model ID、thinking 开关、tool schema、流式 usage、工具结果后续轮、reasoning_content 保留要求、取消行为和 provider 返回错误。以用户账户可访问的具体型号及当前官方文档为准；此轮未请求密钥，未调用模型，未验证工具质量／费用／延迟。

### 压缩与子运行边界

Pi 压缩 hook 可以接管摘要，接收 AbortSignal，并回传 usage；默认序列化会截断过长工具结果用于摘要。因此原始结果和关键引用必须由宿主保留，不能仅依赖默认 coding 摘要完整承接垂直业务约束。W01 用小预算探针检查纠正、版本、引用与确认仍有效；自定义压缩成本合并父预算。[Pi compaction](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/compaction.md)。

子运行建议通过唯一 `delegate` 宿主工具创建另一独立 AgentSession，只传允许资料与任务目标，不暴露 delegate、编辑共享指引文件或批准工具；父子预算／并发／取消在宿主实现。这是使用成熟循环组合功能，不是再次自研模型工具循环。OpenCode 原生子会话可减少部分创建工作，但平台责任与 scope 仍需映射和验证。

### 淘汰与复核条件

以下条件在所属阶段验证，失败时修正或调整路线，不得跳过验收；高级确认／恢复不作为 S1 首增量的前置，也不能因 C 已通过就推定后续可行。需要替换时对照备选并更新设计：

- 自定义 ResourceLoader + 工具清单仍不能排除环境资源／危险工具的自动暴露。
- 用户确定的 provider/model 无法稳定完成工具后续轮，或必须大改内核才能保留所需字段。
- 混合工具批次无法无副作用暂停，确认等待仍占用执行槽位，或重启后无法按原 operation 恢复。
- 原生 entries 恢复不能保留压缩、工具关联与必要原文，或需要长期维护内核 fork 才能建立可靠提交边界。
- 关键压缩约束、父子权限与预算无法通过公开扩展点保证。

OpenCode 若需作为替代，还须先验证 server 版本和文档路由一致、事件重放、权限默认覆盖、外部工具与宿主账本关联，以及等待确认时是否能真正释放平台执行槽位。其原生 ask 不自动等于本项目所需的可持久暂停。

## Files Found / Related Specs

- `docs/mvp/implement.md:42`：W01 验证范围、框架先行与选型交付。
- `docs/mvp/design.md:99`：确认释放资源与续接关联；本次研究细化可验证实现机制。
- `docs/mvp/design.md:129`：子运行权限、预算与单层边界。
- `docs/mvp/design.md:133`：Memory 与压缩的项目契约。
- `docs/mvp/design.md:207`：Pi 对话优先及后续内核评估。
- `.trellis/spec/backend/index.md`：后端规范索引，目前为待填模板，不能当成已定技术选型。
- `.trellis/spec/guides/cross-layer-thinking-guide.md`：事件边界单一契约、序列号和投影职责。
- `.trellis/tasks/09-16-w01-harness-validation/prd.md`：本任务需求与验收；研究阶段读取种子，主任务随后已收敛。

## Caveats / Not Found

- 项目尚无应用实现，未找到可以复用的应用 Agent adapter／指引文件适配／Run controller；已有 `.opencode` 是开发辅助配置，不能当产品内核。
- GitHub main 与 release tag 的依赖内容已有差异；以上核心控制／恢复结论使用 `v0.85.1` 源码，文档描述使用访问日官方页。实施时必须重新对照已安装包的类型和行为。
- OpenCode 同时存在版本化文档，本文只证明 server/SDK 路线存在，未承诺不同文档版本间 endpoint 可混用。
- 尚未完成包安装、Ubuntu、许可证传递清单、内存占用、恢复故障注入、真实模型或多会话隔离实测。
