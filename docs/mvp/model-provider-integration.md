# Berserk 多平台模型接入方案

**状态：已实现并通过离线验证；真实 Kimi 验收待凭证** · 2026-11-19

**基线说明：** 从 `main / d781b34e2fc9680e2c84f0eca599c5d9386f579d` 创建 `codex/model-provider-integration` 实施，Pi 保持 `0.85.1`。用户于 2026-11-19 批准附件修订方案与以下四项补充。原先 `feat/chat-rendering-c` 的未提交变更不带入本分支。

**阅读说明：** 下文“现状”“拟”描述的是附件批准时的设计依据。实施中的实际接口、schema 和使用步骤见 `experiments/harness-lab/README.md` 的“模型设置”及任务验证记录。

## 本轮调整

- Kimi 首批沿用已有 Pi 原生上下文，默认不增加第二份 `host_request_instructions` 提醒，也不为这份提醒创建临时 Context 副本。当前工作区指令及规则生效说明仍然保留。
- DeepSeek 的额外提醒暂作为有历史验证依据的兼容例外保留；首批必须明确限定适用配置与 API，不能让它继续作用于所有平台。
- 通过独立 issue 评估提醒的移除、迁移或必要例外，逐步统一多平台的资源来源、快照时点和上下文组装约定。

## 目标和首批范围

系统管理员集中配置模型平台和凭证，业务席位在现有聊天输入框选择可用的「平台－模型」。首批以 Kimi Code 官方端点验证第二个平台接入，复用现有 Pi Agent SDK、原生会话、工具执行和压缩链路。方舟 DeepSeek 继续作为新会话及后台作业的默认模型。首批覆盖桌面浏览器的文本对话及现有文件工具；原生图片输入和自动选模留待单独评估。

## 管理权限与选择行为

| 角色 | 可执行操作 |
| --- | --- |
| 系统管理员 | 在「设置 → 模型」维护平台、模型、兼容参数及启用状态，查看凭证配置状态；按部署流程在服务端本地配置文件填写或更新 Kimi Key。 |
| 业务席位 | 在对话输入框选择已启用且可用的「平台－模型」，选择随当前会话保存。 |

原稿 main 基线用席位的 `manageModelSettings` 标志控制入口和接口，系统管理员身份的该标志为 `false`。实施时，前端入口和服务端设置接口都改为识别系统管理员身份；旧席位即使曾获授 `--manage-model`，也只保留对话中的选模能力。系统管理员无需绑定业务席位即可管理模型目录。选模接口继续校验会话归属，并在运行或排队期间拒绝切换。[设置接口][permissions] · [管理员身份][administrator] · [会话选模][selection]

## 配置与调用设计

平台配置描述服务地址、API 协议、凭证引用及该端点通用的兼容参数。模型配置关联平台，保存模型 ID、显示名称、输入能力、上下文和最大输出容量、已核实的思考档位，并按字段覆盖平台默认值。两个平台提供同名模型时使用各自的配置 ID；会话继续保存现有模型配置 ID，发送时由服务端解析。[现有模型目录][catalog]

管理接口只返回凭证是否已配置，业务端只接收选模所需信息。沿用启动时已加载的 `.env.local`，拟新增 `KIMI_API_KEY` 供 Kimi Code 平台引用；文件由部署管理员维护并排除在 Git 跟踪之外。已有 DeepSeek 凭证继续通过原配置读取。凭证绑定到对应调用地址，更换服务地址时沿用凭证重新确认规则。[凭证校验][credentials] · [环境文件加载][package]

当前模型注册统一使用 `openai-completions`，推理能力只识别既有 DeepSeek 组合。拟让现有运行时注册层解析平台协议和模型能力，再由 `pi-ai` 发送请求、解析流式结果。新增平台显式声明 API；旧配置缺少 API 字段时兼容为 `openai-completions`。协议和兼容参数按“平台默认值＋模型字段覆盖”解析，避免在各调用入口重复硬编码。[当前运行时][runtime] · [DSH 分层配置参考][dsh]

主回复、工具续轮和压缩沿用同一宿主请求选定的模型配置。输入建议、工作识别等独立调用也复用模型能力和参数解析，保留各自的提示词、超时和失败反馈。保存配置继续保留版本冲突检查与运行期间的写保护。[配置保存][save]

## 上下文组装与协议转换

### 已核实的现状

| 对象或环节 | 当前职责 |
| --- | --- |
| Berserk `ResourceSnapshot` | 在本轮固定通用／工作区指令和可用资源，供提示词、工具及审计使用；不是整份 LLM Context。 |
| Pi 原生会话 | 同一 `SessionManager` 保留历史，Pi 负责会话消息转换、工具循环和压缩。 |
| Pi `Context` | 本次模型输入，含 `systemPrompt`、`messages`、`tools`；资源快照中的相关内容经过选择和加工后进入这些字段。 |
| Berserk `controlledStream` | 包装 Pi 调用，承担取消、超时、并发准入、用量和错误处理；目前还包含提醒补丁。 |
| `pi-ai` 适配器 | 将 Context 编成目标 HTTP 请求并解析响应流；`onPayload` 在协议编码后、发送前执行。 |

工作区指令已通过 `agentsFilesOverride → Pi ResourceLoader/buildSystemPrompt → Context.systemPrompt` 进入 `project_context`。资料和 Skill 默认提供目录，正文按显式选择或工具读取路径进入消息。审计 `custom entry` 不自动进入模型，`sendCustomMessage({display:false})` 则仍可进入会话和模型输入。[当前组装][context] · [资源与消息分流][resources] · [Pi 系统提示合并][pi-system] · [Pi Context 与消息类型][pi-types]

当前 `requestReminder` 另含同一份完整指令快照；`controlledStream.onPayload` 在最终请求体中找到最后一条 user，并在其前插入独立 system。历史验证确认过最新规则未在转换中丢失，但 DeepSeek 仍沿用旧规则，因此才加入这项行为补丁。**目前这段提醒插入并未限定为 DeepSeek；同一回调里的 DeepSeek 判断只控制 thinking 参数。**[提醒内容][reminder] · [插入实现][payload] · [历史诊断][validation]

### 首批实施约定

1. **共同的内容来源与生效时点。** 通用、工作区指令继续由同一资源加载路径进入系统提示；宿主请求开始时固定快照，工具续轮沿用。指令保存从下一宿主请求生效；同一 `requestId` 内的 `steer/followUp` 追加输入不自动刷新快照。[追加输入][intake]
2. **Kimi 使用原生路径。** 当前指令照常进入 `Context.systemPrompt`，由 Pi 编成 Anthropic 顶层 `system`。默认不额外复制 `host_request_instructions`，不为此建立附加提醒的 Context 副本，也不在编码后插入独立 system。这是待验证的首批策略，不代表已证明 Kimi 不会受旧规则影响。
3. **保留规则语义，去掉位置依赖。** 基础系统提示继续说明“当前规则优先、空工作区不继承旧规则、编辑从下一请求生效”；将其中“当前用户消息之前的宿主 system 提醒”等位置假设改为与协议无关的描述。[现有基础提示][context]
4. **DeepSeek 暂保留已验证行为。** 保留额外提醒的内容、插入位置和同轮快照，实施时显式限定到已验证的 DeepSeek 模型、端点及 `openai-completions` 组合。未验证的配置和新平台不得自动继承该补丁。范围收窄属于首批必要改动；是否迁移或移除由后述 issue 跟踪。
5. **保持原生历史与摘要边界。** 不把临时提醒写回原生会话，不以改写用户正文或工具结果承载提醒；Pi 仍正常执行消息转换与压缩。压缩使用摘要自己的提示，不额外注入本轮聊天提醒；历史材料本身仍可能含过去的规则文本。
6. **异常按证据处理。** 若 Kimi 原生路径在规则替换、清空或续聊中失败，保存脱敏的请求结构和行为证据，进入 issue 评估最小调整；不能直接复制 DeepSeek 的 payload 插入，也不能仅凭 Anthropic 顶层 system 支持内容块数组就判定问题已解决。

Pi `0.85.1` 的 `Context.messages` 没有可任意插入的 system 类型；Anthropic 还会把工具结果编码成 `role:user` 的 `tool_result` 内容块。因此，现有“编码后找最后一个 user”不具备跨协议的业务定位含义。[Pi 消息类型][pi-types] · [Anthropic 工具结果][pi-tool-results]

### 多平台一致性与独立跟踪

**跟踪 issue：** [#4：评估并收敛 DeepSeek 额外指令提醒，统一多平台上下文组装约定](https://github.com/pulpcode/berserk/issues/4)

一致性目标是：各平台共享资源来源、权限范围、快照时点、指令生效规则和历史处理约定，由 Pi 负责各协议的具体编码。OpenAI 与 Anthropic 的 HTTP 字段仍可不同，模型回答效果分别验证。

该 issue 需比较原生系统提示、通用上下文中的最小规则时效说明与现有 DeepSeek 位置补丁，明确是否能去除重复全文或移除编码后插入。若仍需例外，记录证据、适用范围和再次评估条件。仅将补丁加上 provider/API 判断，不代表组装行为已全面统一。

首批在明确例外且验收通过后可交付，不要求先完成长期统一；issue 保持后续跟踪。未经真实回归，不直接删除 DeepSeek 已验证的补丁，也不另建通用上下文引擎或重写 Pi 消息转换。

## 思考档位

按每个「平台－模型」组合声明可用档位、默认行为和必要映射，区分模型能力与当次用户选择。所有调用入口使用同一套解析，再由 Pi 编成目标协议字段。

对始终思考的模型，界面不提供 `off`，模型注册也必须明确不支持关闭；在 Pi `0.85.1` 的 Anthropic 路径中，应显式表达 `thinkingLevelMap.off = null` 等相应能力，而不能仅依赖省略调用参数。验收核对最终请求，确认没有生成 `thinking: { type: 'disabled' }`。具体档位、预算或 effort 字段按目标端点核实，未验证前保留服务端允许的默认行为。[Pi 参数解析][pi-thinking]

## Kimi Code 接入与开放条件

首批沿用用户指定的 `https://api.kimi.com/coding/`，选择 **Anthropic Messages**，目标请求为 `POST https://api.kimi.com/coding/v1/messages`。Pi `0.85.1` 已有 `kimi-coding` provider 和适配器；优先复用，并按账号实际能力显式登记候选模型 `k3.1-pro`，不将内置目录视为账号可用性的证明。官方文档列明该型号仅支持思考模式、默认 `max`，上下文权益随账号档位变化。凭证交付后确认可用型号、容量和思考参数。[官方接入文档][kimi-docs] · [Pi Kimi provider][pi-kimi]

技术验证与业务开放分别验收。沿用原稿的用途核实要求：Kimi Code 面向个人交互使用，产品集成、团队调用及共享服务端凭证是否由所持凭证覆盖，需在正式开放前确认；若不覆盖，正式入口另行审定。后台作业继续使用 DeepSeek。本轮不修改新部署初始化或账号管理流程。[Kimi Code 使用说明][kimi-use] · [平台用途对比][kimi-docs]

## 验收与回退

1. **权限与凭证。** 核对系统管理员、普通席位、曾获 `--manage-model` 席位的页面与 API。仅系统管理员可管理配置；业务席位可选择可用模型。浏览器响应与日志没有密钥；缺少凭证、容量未确认或开放条件未满足时，Kimi 不进入业务可选列表。
2. **协议正确性。** 使用模拟传输捕获两个真实适配器生成的请求，核对端点、模型、凭证绑定、工具结构、调用／结果 ID、思考字段，以及不同平台同名模型的独立配置。覆盖保存冲突、配置校验和旧配置默认 API。
3. **上下文与例外。** Kimi 当前指令通过原生 systemPrompt 进入顶层 system，没有第二份 `host_request_instructions` 或编码后的 system 插入。DeepSeek 仅在明确适用组合保留原位置；其他组合不误用。验证同一 requestId 的工具续轮和追加输入使用固定快照，下一宿主请求读取新指令，提醒不累计、不落盘，压缩使用自己的提示。
4. **真实规则行为。** 凭证及用途确认后，使用隔离工作区和合成规则，验证规则替换、清空、原会话续聊、同轮工具读写后的行为及压缩后续聊。DeepSeek 以现有补丁为回归基准，Kimi 验证原生路径；格式检查通过不替代这项验收。失败时记录实际请求与回答，进入跟踪 issue 评估。
5. **真实调用链。** 核对流式正文、完整工具调用及结果续轮、压缩后的继续对话，以及同一会话 DeepSeek → Kimi → DeepSeek。检查可获得的用量和跨模型历史转换；原稿 main 中的输入建议与工作识别沿用独立时限，确认结果或失败反馈。
6. **兼容与回退。** 旧配置和会话可读，后台继续原默认模型。停用 Kimi 后既有会话仍可打开并手动改选 DeepSeek，保留历史和草稿。读取兼容失败时使用部署前配对的代码与配置备份回退；本方案不授权在缺少行为证据时移除 DeepSeek 补丁。

## 审阅重点

本轮确认：Kimi 先走原生上下文并验证；DeepSeek 补丁首批收窄范围、后续单独评估；多平台统一以共同语义和生命周期为目标。平台／模型配置、权限与思考能力设计继续沿用上述约定。用户已批准附件修订与四项补充，现于独立 main 分支实施。代码及离线验证状态记录在对应 Trellis 任务中，Kimi 真实验收待凭证；issue #4 保持独立跟踪。

[permissions]: https://github.com/pulpcode/berserk/blob/345bf85a0bab7fbed0d9be7bdf8c5905d77fb84c/experiments/harness-lab/src/server/app.ts#L182
[administrator]: https://github.com/pulpcode/berserk/blob/345bf85a0bab7fbed0d9be7bdf8c5905d77fb84c/experiments/harness-lab/src/access/store.ts#L130
[selection]: https://github.com/pulpcode/berserk/blob/345bf85a0bab7fbed0d9be7bdf8c5905d77fb84c/experiments/harness-lab/src/pi/lab.ts#L431
[catalog]: https://github.com/pulpcode/berserk/blob/345bf85a0bab7fbed0d9be7bdf8c5905d77fb84c/experiments/harness-lab/src/server/model-settings.ts#L126
[credentials]: https://github.com/pulpcode/berserk/blob/345bf85a0bab7fbed0d9be7bdf8c5905d77fb84c/experiments/harness-lab/src/server/model-settings.ts#L149
[package]: https://github.com/pulpcode/berserk/blob/df155ca02203ea8da24cd672b0ab27850ad2ff2b/experiments/harness-lab/package.json#L11
[runtime]: https://github.com/pulpcode/berserk/blob/df155ca02203ea8da24cd672b0ab27850ad2ff2b/experiments/harness-lab/src/pi/model-runtime.ts#L6
[dsh]: https://github.com/deepseek-ai/deepseek-harness/blob/ca33fd6843b205e279c7ccb6cb73a472c78f5760/docs/user/guide/providers.md#request-compatibility
[save]: https://github.com/pulpcode/berserk/blob/345bf85a0bab7fbed0d9be7bdf8c5905d77fb84c/experiments/harness-lab/src/pi/lab.ts#L454
[context]: https://github.com/pulpcode/berserk/blob/df155ca02203ea8da24cd672b0ab27850ad2ff2b/experiments/harness-lab/src/pi/lab.ts#L817
[resources]: https://github.com/pulpcode/berserk/blob/df155ca02203ea8da24cd672b0ab27850ad2ff2b/experiments/harness-lab/src/pi/lab.ts#L1295
[pi-system]: https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/system-prompt.ts#L48
[pi-types]: https://github.com/earendil-works/pi/blob/v0.85.1/packages/ai/src/types.ts#L470
[reminder]: https://github.com/pulpcode/berserk/blob/df155ca02203ea8da24cd672b0ab27850ad2ff2b/experiments/harness-lab/src/pi/lab.ts#L824
[payload]: https://github.com/pulpcode/berserk/blob/df155ca02203ea8da24cd672b0ab27850ad2ff2b/experiments/harness-lab/src/pi/controlled-stream.ts#L70
[validation]: https://github.com/pulpcode/berserk/blob/df155ca02203ea8da24cd672b0ab27850ad2ff2b/.trellis/tasks/archive/2026-09/09-16-w01-2-workspace-memory/research/validation-results.md#L23
[intake]: https://github.com/pulpcode/berserk/blob/df155ca02203ea8da24cd672b0ab27850ad2ff2b/experiments/harness-lab/src/pi/message-intake.ts#L59
[pi-tool-results]: https://github.com/earendil-works/pi/blob/v0.85.1/packages/ai/src/api/anthropic-messages.ts#L1344
[pi-thinking]: https://github.com/earendil-works/pi/blob/v0.85.1/packages/ai/src/api/anthropic-messages.ts#L849
[kimi-docs]: https://www.kimi.com/code/docs/
[pi-kimi]: https://github.com/earendil-works/pi/blob/v0.85.1/packages/ai/src/providers/kimi-coding.ts
[kimi-use]: https://www.kimi.com/en/help/kimi-code/community-guidelines#scope-of-use


## 实施补充（已批准）

1. `requestReminder` 还承载 R4 连接器澄清指引。只限制重复指令补丁，连接器的必需指引迁入原生系统上下文，所有平台保留。
2. 管理权限同时覆盖页面入口、API 路由与认证中间件。管理员无业务席位仍可管理；旧 `--manage-model` 席位不能管理。
3. 扩展现有配置存储与解析，兼容旧版本、稳定配置 ID 和会话选模；所有调用入口共享协议与能力解析。
4. 离线测试捕获真实 Pi 适配器的序列化请求；真实模型行为待凭证后验收。issue #4 保持独立跟踪。
