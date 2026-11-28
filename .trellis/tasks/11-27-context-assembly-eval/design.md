# 多平台上下文组装对照实验设计方案（Issue #4）

**状态：** `approved · Stage 1 实现中（离线协议门禁前不发起真实付费请求）` · 2026-11-28
**已确认范围：**
- 凭证来源：统一使用用户提供的**火山方舟（Volcengine Ark）Key** 覆盖 DeepSeek 与 Kimi 两个模型（待 Stage 1 离线门禁通过后暂停请用户提供 Key 并确认方舟端点与模型 ID）；
- 第 1 层策略：完整保留 **A / B / C / D1（全场景 S1–S7）+ D2（S2/S3/S6 专项对照）**；
- 第 2 层外部 Harness：**OpenCode（接方舟 DeepSeek + Kimi）+ Claude Code CLI（接方舟 Kimi Anthropic 兼容端点）**，跳过 Codex CLI；
- 运行环境：本机 macOS 独立 worktree（Node `v24.22.3` 已安装，外部 CLI 隔离安装于系统 `/tmp/ctx-eval-tools`）。
**基线提交：** `main` (`3a991e8`) · Pi `0.85.1`
**工作分支与隔离工作区：** `exp/context-assembly-eval`（`/Users/lau/workspace/berserk-context-assembly-eval`；主目录 `/Users/lau/workspace/berserk` 的 `feat/model-management-ux` 及 27 处未提交改动保持原状）
**关联 Issue：** [GitHub Issue #4](https://github.com/pulpcode/berserk/issues/4)

> **执行前门禁：** 未通过 Stage 1 离线门禁且未获得用户提供真实 Key 之前，**不发起任何真实付费模型请求**，不修改主业务默认行为，不提前删除现有 DeepSeek 补丁。

---

## 0. 现状核对与综合诊断

### 0.1 已核实的 `main` 基线代码现状

| 环节 | 源码位置 | 当前行为 |
| --- | --- | --- |
| 原生规则注入 | `experiments/harness-lab/src/pi/lab.ts#L1328-L1337` | 通过 `agentsFilesOverride` 将非空通用/工作区指令注入 Pi `Context.systemPrompt` 的 `<project_context>`；基础系统提示词声明“当前 `<project_context>` 是本请求完整且固定的指令快照，空工作区表示没有约定，保存只影响下一请求”。 |
| DeepSeek 额外提醒生成 | `experiments/harness-lab/src/pi/lab.ts#L1287-L1290` | 仅当 `isVerifiedDeepSeekModel(config)` 为真时，生成包含 `snapshot.instructions` 全文 JSON 的 `<host_request_instructions>` 字符串；其他模型为空串。 |
| 协议编码后插队 | `experiments/harness-lab/src/pi/controlled-stream.ts#L70-L78` | 在 Pi 完成协议转译后的 `onPayload` 中，非 compaction 且命中 `isVerifiedDeepSeekModel` 时，扫描最终 wire `messages` 的最后一条 `role: 'user'`，并在其前硬插 `{ role: 'system', content: reminder }`。 |
| 精确白名单 | `experiments/harness-lab/src/server/config.ts#L52-L57` | `isVerifiedDeepSeekModel` 仅匹配 `openai-completions`（或未填 `api`）且为官方 `deepseek-flash` (`https://api.deepseek.com[/v1]`) 或方舟 `deepseek-v4.1-flash` (`https://ark.cn-beijing.volces.com/api/plan/v3`)。 |
| 旧版思考兜底 | `experiments/harness-lab/src/pi/model-runtime.ts#L29-L31`, `#L45-L52` | `configuredRuntime` 对 `isVerifiedDeepSeekModel` 附加 `thinkingFormat: 'deepseek'`；但 `providerPayload` 仍用 `config.provider.toLowerCase() === 'deepseek'` 在未声明 thinking 能力时注入 `thinking: { type: 'disabled' }`。 |
| 历史指令快照审计 | `experiments/harness-lab/src/pi/lab.ts#L1261-L1275` | 原生会话已持久化 `berserk.request-resources.v1` custom entry，记录每轮请求的指令快照及 `hash`（不直接进入模型上下文，可供宿主对比上一轮 hash）。 |

### 0.2 综合问题诊断（为什么要做本次双层对照）

1. **问题本质是「同会话规则变更/清空时的近因惯性」，而非协议丢失**
   - W01-2 五轮历史验证（`.trellis/tasks/archive/2026-09/09-16-w01-2-workspace-memory/research/validation-results.md`）已证实 Pi 从未丢失新规则；真正导致旧版 `deepseek-flash`（thinking 关闭）失败的，是旧规则回复与旧工具结果停留在消息尾部，其 few-shot 惯性压过了顶部 `systemPrompt`。
   - 这本质上是所有大模型在长对话中都会面临的共性现象，只是严重程度随模型代际与思考模式不同而变化。
2. **现行 DeepSeek 补丁的四个结构性代价**
   - **分层污染与跨协议不兼容**：传输控制层 `controlledStream.onPayload` 越权解析已编码的 wire JSON 并按 `findLastIndex(role === 'user')` 插 `role: 'system'`。这在 Anthropic Messages 上直接非法（不支持 mid-stream `system`，且 `tool_result` 被编码为 `role: 'user'`）；即使在 OpenAI 协议下，若同请求内出现 `steer`/`followUp` 追加新 `user`，插入点也会在请求中途发生位移。
   - **触发粒度过粗与缓存/Token 代价**：真实业务中绝大多数回合工作区指令并未变化，但现状每轮仍在尾部重复注入整份 `instructions` 全文 JSON，既消耗冗余 token，也在每轮尾部制造动态插入点。
   - **白名单升级静默失效**：精确绑定 `deepseek-flash` / `deepseek-v4.1-flash` 与特定 URL，未来升级 `deepseek-v4.2-flash`、`deepseek-v4-pro` 或切换代理时不会报错，而是静默退化为无补丁路径。
   - **多平台未真正收敛**：Kimi 走原生路径尚未经过与 DeepSeek 同等苛刻的规则替换/清空/压缩回归检验；一旦其他平台也出现惯性，现状机制无法复用。

---

## 1. 第 1 层设计：核心策略对照（强控制变量）

### 1.1 控制变量（严格固定）

- **运行时**：统一基于本分支 `experiments/harness-lab` + Pi `0.85.1` 原生 `AgentSession` / `SessionManager` / `DefaultResourceLoader` / `resourceTools` / `controlledStream`。
- **隔离方式**：每个「模型 × 策略组 × 重复轮次」使用独立临时目录（`mkdtemp`）、独立 `SessionManager`、独立合成工作区与固定合成指令/资料，**绝不复用任何历史会话或用户数据**。
- **底座模型矩阵**（均需先由用户确认凭证与可用型号）：
  1. **必测模型 1（默认 DeepSeek）**：现役方舟 `deepseek-v4.1-flash`（`https://ark.cn-beijing.volces.com/api/plan/v3`，`openai-completions`）和/或 DeepSeek 官方 `deepseek-flash`（`https://api.deepseek.com`，`openai-completions`）。默认按两档观察：**thinking 关闭（对齐历史失败基线）**；如用户需要，可追加一档 **thinking 开启（`high`）** 检验推理模式是否天然消除近因惯性。
  2. **必测模型 2（第二平台 Kimi）**：Kimi Code `kimi-for-coding`（K2.8 Preview，`https://api.kimi.com/coding`，`anthropic-messages`，默认 `low` adaptive thinking，与 `model-presets.ts` 对齐；若账号实际使用 `k3.1-pro` 则在运行前配置锁定）。
  3. **可选模型 3（跨模型/同协议对照）**：如用户有现成 Key，可增选 1 个 OpenAI Completions 非 DeepSeek 模型或更高代 DeepSeek（如 `deepseek-v4-pro`），检验白名单外模型的行为基线。
- **基础系统提示词与断言**：所有组共享同一套协议无关的基础系统提示词（沿用 `main` 上 `lab.ts#L1328-L1329`，不含位置假设）与同一套确定性严格评分器。
- **实验开关实现边界**：实验策略通过独立实验 harness（位于任务脚本/测试入口，仅接受注入的策略回调或只读包装，**不修改 `main` 生产默认行为、不删除现有 `isVerifiedDeepSeekModel` 补丁**）控制。

### 1.2 自变量：A / B / C / D 四组策略定义

| 组别 | 命名与灵感来源 | 顶部 `systemPrompt` (`<project_context>`) | 尾部注入内容与位置 | 协议兼容性 | 落盘与历史边界 |
| --- | --- | --- | --- | --- | --- |
| **A 组** | Pi / OpenCode 原生模式 | 每请求按当前快照更新 | **无**（零尾部注入） | OpenAI & Anthropic 原生兼容 | 原生无侵入 |
| **B 组** | Berserk DeepSeek 现状基线 | 每请求按当前快照更新 | 每轮回复在 `onPayload` 的最后一条 `role: 'user'` 前硬插独立 `role: 'system'` 全文 JSON（压缩跳过） | **仅 OpenAI Completions**（仅作 DeepSeek 回归基准，不对 Anthropic 运行） | 瞬态不落盘；但污染 `controlledStream` |
| **C 组** | Claude Code `<system-reminder>` 风格 | 每请求按当前快照更新 | 每轮回复通过协议无关方式，在**当前宿主请求的输入消息边界**附加瞬态 `<system-reminder>`（含现行规则或空文件声明），采用 `role: 'user'` 内容块承载；压缩跳过 | OpenAI & Anthropic **全兼容** | 瞬态注入（仅在发送给模型前构造瞬态视图，**绝不写入 `SessionManager`，不改写持久化用户原文**） |
| **D1 组** | Codex Append-Only / 按变更触发（主推） | **同步更新**为当前请求快照 | **未变更回合零注入**；仅当同会话本轮 `AGENTS.md` hash 相对上一轮已成功请求发生变化（新增/修改/清空）时，在该轮尾部追加一次协议无关的 `role: 'user'` `<system-reminder>` 变更声明（含新规则摘要/全文或显式“已清空”声明）；压缩跳过 | OpenAI & Anthropic **全兼容** | 变更检测复用已有 `berserk.request-resources.v1` hash；声明瞬态注入不落盘 |
| **D2 组** | 顶部冻结保 KV Cache + 尾部按变更声明（专项对照） | **冻结为会话首轮快照**（模拟极限 prefix cache 稳定） | 同 D1，但因顶部保持旧快照，变更声明需在后续回合维持可见（本实验评估“仅变更首轮追加”与“变更后持续附带最小现行规则”对压缩后行为的影响） | OpenAI & Anthropic **全兼容** | 需额外维护“会话初始快照”状态（见下方评估） |

> **C 组 / D 组“如何做到协议无关且不改原生历史、不重写 Pi `convertToLlm`”的技术要点：**
> - 绝不在 `SessionManager` 写入临时提醒，也不拼接进用户落盘正文。
> - 在 `AgentSession` 的 `streamSimple` 包装入口（即传给 Pi 协议适配器编码**之前**的 `Context` 层，而非编码后的 HTTP JSON `onPayload`），对非 `compaction` 调用浅拷贝 `context.messages`，仅在本次发送的 `Context` 副本中于本轮对应的用户 `UserMessage` 内容块数组追加一个瞬态文本块 `<system-reminder>...</system-reminder>`（或在最后一条真实用户消息后追加独立瞬态 `UserMessage`，需在阶段 1 离线测试中验证 OpenAI 与 Anthropic 适配器对连续 `user` vs 单 `user` 多 `TextContent` block 的合并行为——**优先采用“在当前真实 `UserMessage` 的 `content` 数组中追加独立 `TextContent` 块”**，避免 Anthropic 拒绝或合并相邻 `role: user`，且在多步工具续轮中精确锚定在原始用户意图上、绝不会误挂到 Anthropic 编码后的 `tool_result` 上！）。
> - 这同时彻底解耦了 `controlledStream` 对协议 JSON 的依赖：传输层只管超时、并发、重试、用量和脱敏错误，不再做消息定位。

### 1.3 对 D 组拆分 D1 vs D2 的架构与实验评估

| 维度 | D1（顶部同步更新 + 尾部按变更声明） | D2（顶部冻结初始快照 + 尾部变更声明） |
| --- | --- | --- |
| **未变更回合 KV Cache** | 顶部完全不变 + 尾部零注入 → **最优前缀命中** | 顶部完全不变 + 尾部零注入 → 相同 |
| **变更当轮 KV Cache** | 顶部更新导致前缀缓存失效一次（但规则修改属低频事件，下一轮即重新稳定） | 顶部不变，变更当轮可继续复用旧前缀缓存 |
| **压缩（Compaction）安全性** | **高**：压缩切掉旧对话后，顶部仍是最新规则，重启续聊天然权威 | **存在显著风险**：若压缩丢弃早期变更声明而顶部仍是旧快照，**旧规则会“诈尸”复活** |
| **Pi 集成复杂度** | **极低**：零新增持久状态，直接复用现有 `DefaultResourceLoader` 与 `berserk.request-resources.v1` hash | **高**：需在会话中新增持久化“初始快照”字段与跨重启恢复逻辑，违背 AGENTS.md“不为假设需求新增持久状态”的 Pi 集成约定 |
| **实验定位结论** | **主推候选方案**，全场景（S1–S7）完整参测 | **专项对照子组**：仅在核心变长对话 + 规则变更 + 压缩场景（S2/S3/S6）小样本参测，用于量化两件事：① 规则变更当轮 `cacheRead` 到底省下多少 token；② D2 在 compaction 后是否如预期触发旧规则复活。**如预算需压缩，优先裁减 D2、完整保留 A/B/C/D1。** |

---

## 2. 第 2 层设计：轻量外部 Harness 参照探针

### 2.1 定位与边界

- **目标**：不做重型外部评测框架，仅做轻量“行业基线摸底”，回答一个问题——*当成熟外部 Harness 面对同样的「同会话规则替换」与「同会话规则清空续聊」时，模型是否同样出现近因惯性？*
- **严格隔离**：第 2 层只测最苛刻的 **2 条探针（P1 规则替换、P2 规则清空续聊）**，不展开全套 S1–S7。
- **归因原则**：
  - **OpenCode**（优先）：可配置直连**同一 DeepSeek / Kimi 模型端点**，真正控制住了底座模型变量，能直接对比 OpenCode 与 Pi 原生的上下文策略差异。
  - **Claude Code CLI / Codex CLI**（可选）：底层模型不同（Claude / OpenAI GPT），且各家 CLI 对热重载规则文件的机制不同（例如 Codex CLI 默认在会话启动时读取 `AGENTS.md`，中途修改可能不会重新注入），因此仅作为行业参照，绝不拿来和第 1 层做直接分数高低比较。

### 2.2 强制前置门禁：本地脱敏 HTTP Wire Proxy

为避免把“外部 CLI 根本没把新规则发给模型”误判为“模型不遵守新规则”，第 2 层所有探针**必须经过本地脱敏透明代理**：

```
外部 CLI (OpenCode / Claude Code / Codex)
   │  (通过 OPENAI_BASE_URL / ANTHROPIC_BASE_URL / provider.baseURL 指向 127.0.0.1:<port>)
   ▼
本地脱敏代理 (Node/Python 轻量脚本, 仅监听 127.0.0.1)
   ├─ 落盘：脱敏请求头(剔除 Authorization / x-api-key / api-key / cookie)
   ├─ 落盘：完整请求体 JSON(system, messages 角色序列, 是否包含旧/新规则指纹, 规则出现位置)
   ├─ 落盘：响应 usage(input/output/cacheRead) 与 HTTP 状态码
   ▼
上游真实模型端点 (HTTPS)
```

- **强判定规则**：
  1. 若某回合的 wire payload 中**已证实包含新规则（或确认旧规则已从 system/指令区移除）**，但模型回复仍沿用旧规则 → 判定为 **模型近因惯性 / 上下文策略不足**；
  2. 若 wire payload 中**仍发送旧规则、未包含新规则** → 判定为 **外部 Harness 机制不支持同会话热重载**，单独记录机制现象，不计入模型遵守失败。

---

## 3. 必测合成场景、严格断言与离线门禁

### 3.1 阶段 1：离线确定性协议门禁（零付费，先于真实验证跑通）

复用项目已有模式（参考 `tests/pi/model-platforms.test.ts`），用本地 fake HTTP 截获真实 Pi `0.85.1` 适配器序列化后的完整请求体，逐组断言：
1. **角色与协议合法性**：OpenAI Completions 与 Anthropic Messages 均无非法角色；Anthropic 请求绝对不出现 mid-stream `role: 'system'`；工具调用与 `tool_result` ID 严格匹配。
2. **位置与非污染校验**：
   - A 组：仅顶部 `system` 含 `<project_context>`，无任何尾部注入；
   - B 组：仅 `isVerifiedDeepSeekModel` 生效，且 `compaction` 跳过；
   - C 组：`<system-reminder>` 仅出现在瞬态 `Context`，**原生 `SessionManager` 落盘 JSONL 中用户消息原文 100% 未被改写**，且在工具续轮中不重复累计、不误挂到 `tool_result` 上；
   - D1/D2 组：未变更回合 wire payload 中**零尾部注入**；hash 变化首轮精准触发一次声明；同 `requestId` 的工具续轮与 `steer`/`followUp` 保持固定快照，不刷新、不累计。
3. **跨模型历史转换**：同一会话内模拟 `DeepSeek → Kimi → DeepSeek`，核对工具调用/结果与历史消息跨协议序列化合法。

### 3.2 阶段 2：第 1 层 7 大必测合成场景与严格断言

所有合成规则使用无业务语义的**正交可机检标记**（避免测试语义污染，同时杜绝宽松关键词假阳性），例如：
- 规则 R1（初始）：`所有中文正式回答的第一行必须严格以【赤松】开头，且全文不要使用其他方括号装饰前缀。`
- 规则 R2（替换）：`所有中文正式回答的第一行必须严格以【青竹】开头，禁止再使用【赤松】或其他旧前缀。`
- 规则 R3（清空）：工作区 `AGENTS.md` 写入空字符串（`content: ""`，`hash: null` 或空内容语义）。
- 规则 R4（工具写入）：`所有中文正式回答的第一行必须严格以【雪松】开头。`

| 编号 | 场景名称 | 步骤设计 | 严格机检断言（不靠宽松关键词） |
| --- | --- | --- | --- |
| **S1** | 初始规则遵循 | 写入 R1 → 首轮回答普通事实问题（2 轮续聊建立历史惯性） | 每轮回复 `trimStart().startsWith('【赤松】')` 为真；回复不复述内部提醒、hash 或加载机制。 |
| **S2** | 同会话规则替换 | 紧接 S1 同一会话 → 宿主更新 `AGENTS.md` 为 R2 → 连续追问 2 轮 | 替换后首轮与次轮均严格 `startsWith('【青竹】')`；**禁止包含 `【赤松】`**；前缀必须位于回答开头而非句末。 |
| **S3** | 同会话规则清空续聊 | 紧接 S2 同一会话 → 宿主清空 `AGENTS.md` 为 R3 → 追问 2 轮（第 1 轮普通问答，第 2 轮直接询问“当前工作区还有没有格式前缀约定？”） | 第 1 轮禁止包含 `【赤松】`、`【青竹】`，且**禁止以任意 `【...】` / `[...]` 装饰标记开头**；第 2 轮必须明确说明当前无工作区格式约定，不得声称旧规则仍有效。 |
| **S4** | 同轮 `instructions_update` 写入语义 | 新会话（初始为 R1，通用指令含固定只读内容）→ 用户明确要求“把工作区规则改成 R4（以【雪松】开头）” → 紧接下一请求普通提问 | ① 写入当轮调用 `instructions_read` + `instructions_update` 成功；② 磁盘工作区仅做最小修改，**严禁把通用只读指令正文复制进工作区**；③ 写入当轮的最终回复**仍须遵守本轮快照 R1（`startsWith('【赤松】')`）**并说明下次请求生效；④ **下一请求**严格 `startsWith('【雪松】')` 且不含 `【赤松】`。 |
| **S5** | 多步工具续轮 + 同请求 `steer`/`followUp` | 启用合成资料（2 份 `source_read`）与 R2 → 用户要求先读两份资料再汇总；请求运行中注入 1 条 `followUp`（且此时磁盘后台已把 `AGENTS.md` 改为 R1，测试快照锁定） | ① 多步工具续轮正常完成；② 同 `requestId` 内（含 `followUp` 产生的回复）**全程锁定 R2（`startsWith('【青竹】')`）**，不被磁盘中途修改击穿；③ wire payload 核对提醒不随工具循环翻倍累计；④ 下一独立请求才切换到磁盘的新规则 R1。 |
| **S6** | 压缩（Compaction）后续聊 | 使用隔离低 `compaction` 阈值配置：先以 R1 多轮对话积累上下文（含工具读出较长合成文本）→ 切换为 R2（或清空 R3）→ 触发真实 Pi 原生自动 compaction → 压缩后在同会话继续追问 2 轮 | ① wire 核对 `purpose === 'compaction'` 请求**不含任何回复提醒/变更声明**，保留 Pi 原生摘要提示；② 压缩完成后续聊严格遵守**当前现行规则（R2 或清空 R3）**，不被摘要文本中残留的旧规则 R1 带偏（重点检验 D2 是否复活旧规则）。 |
| **S7** | 同会话跨模型切换 | 同一会话中：`DeepSeek`（R1 首轮 + 工具读取）→ 切换 `Kimi`（宿主更新为 R2，续聊并调用工具）→ 切回 `DeepSeek`（宿主清空为 R3，续聊） | ① 全部请求 HTTP 200，工具调用/结果跨协议无 schema 错误；② 切 Kimi 后严格 `startsWith('【青竹】')` 且不含 `【赤松】`；③ 切回 DeepSeek 清空后无任何 `【...】` 装饰前缀且能准确引用前两轮历史事实。 |

> **重复度设计**：核心痛点场景（S2 规则替换、S3 规则清空、S6 压缩后续聊）每组建议跑 **2 次独立随机种子会话**以降低单次采样偶然性；其余场景（S1、S4、S5、S7）每组跑 **1 次**（若出现首次失败则记录为失败，不私自重跑覆盖分母）。

---

## 4. 观测指标、输出产物与预算上限

### 4.1 强制记录的 4 类对比维度

实验脚本对每组自动落盘结构化 JSON 报告与可读 Markdown 汇总，包含：
1. **行为通过率与失败样本全文**：分场景通过/失败矩阵 + 严格断言明细 + **全部失败轮次的完整提问与模型原始回复**（不截断、不隐藏）。
2. **脱敏 Wire Payload 结构核对**：每轮出站请求的 `api`、脱敏 `endpoint`、`system` 长度与是否含新/旧规则指纹、`messages` 角色序列（如 `[S, U, A(tc), T, A, U]`）、尾部提醒插入位置与字符数、原生 `SessionManager` JSONL 对比（证明未篡改用户原文/未落盘提醒）。
3. **Token 与 Prompt Cache 命中指标**：逐请求及按组汇总 `usage.input`、`usage.output`、`usage.cacheRead`、`usage.cacheWrite`、`usage.totalTokens`、首字/整轮延迟、以及 **Cache 命中率**（明确标注各 provider 口径：OpenAI/DeepSeek 通常 `input` 含或不含 cached tokens 需按 Pi `tokenUsage` 实际字段原样记录，同时计算 `cacheRead / (input + cacheRead)` 与 `cacheRead / totalInput` 避免口径混淆）。
4. **成本与熔断审计**：累计真实请求数、总输入/输出/缓存命中 token、是否有 `unknownUsageAttempts`。

### 4.2 请求数与成本预算上限（硬熔断）

#### 第 1 层预算估算（按每条完整场景链平均 3–5 次 provider 请求估算）

| 参测单元 | 包含场景 | 预计请求数 | 硬上限请求数 | 预计 Input / Cache / Output Tokens | 估算费用（按公开参考价粗估） |
| --- | --- | ---: | ---: | ---: | ---: |
| **DeepSeek（thinking off）× A / B / C / D1**（4 组完整） | S1–S6（S2/S3/S6 ×2） | ~88 次 | 120 次 | ~350K in / ~200K cache / ~35K out | 极低（约 ¥1–¥5 / 次全量） |
| **DeepSeek × D2**（专项对照，可选） | S2 / S3 / S6（×2） | ~18 次 | 30 次 | ~80K in / ~50K cache / ~8K out | 极低（< ¥1） |
| **Kimi（Anthropic Messages）× A / C / D1**（3 组，B 不适用） | S1–S6（S2/S3/S6 ×2） | ~66 次 | 90 次 | ~260K in / ~120K cache / ~30K out | 随 Kimi Code 订阅额度计（按 API 折算约 ¥3–¥12） |
| **跨模型 S7（DeepSeek ↔ Kimi）× A / C / D1**（3 组） | S7（×2） | ~24 次 | 36 次 | ~90K in / ~30K cache / ~10K out | 约 ¥1–¥3 |
| **第 1 层合计（含 D2）** | — | **~196 次** | **276 次** | **~0.78M in / ~0.40M cache / ~83K out** | **总计约 ¥5–¥20（折合 < \$3）** |

> 若额外追加一档 **DeepSeek thinking 开启 (`high`)**（仅跑 A / D1 对比，约 44 次请求，上限 60 次），预计多增 ~¥2–¥5。

#### 第 2 层轻量参照预算估算

| 外部 Harness | 探针范围 | 预计请求数 | 硬上限请求数 | 费用归属 |
| --- | --- | ---: | ---: | --- |
| **OpenCode**（接 DeepSeek & Kimi） | P1 规则替换 + P2 规则清空（各 2 模型） | ~16–20 次 | 32 次 | 复用同套 DeepSeek / Kimi Key，约 ¥1–¥3 |
| **Claude Code CLI**（可选） | P1 + P2（2 条探针） | ~6–10 次 | 16 次 | 消耗用户 Anthropic API Key 或 Claude 订阅额度（约 \$0.2–\$0.8） |
| **Codex CLI**（可选） | P1 + P2（2 条探针） | ~6–10 次 | 16 次 | 消耗用户 OpenAI API Key 或 ChatGPT/Codex 订阅额度（约 \$0.1–\$0.5） |

#### 自动熔断规则（写入实验执行器）
- **全局硬上限**：第 1 层总计不超过 **300 次**真实请求 / **2M input** / **150K output**；单场景不超过 **10 次**请求或 **300 秒**。
- **立即停机条件**：任一请求出现 401/403 鉴权失败、402/余额不足、连续 2 次缺 `usage`、本地代理写入失败、或检测到疑似触碰非临时目录路径，立即中止批次并保留已采集分母。

---

## 5. 顺带盘点：`model-runtime.ts` 中 `providerPayload` 的旧 DeepSeek 兜底分支

核对 `experiments/harness-lab/src/pi/model-runtime.ts#L44-L52`：

```ts
/** Preserve legacy DeepSeek payloads only on their original protocol. */
export function providerPayload(config: Readonly<LabConfig>, payload: unknown): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null) throw new Error('Provider message payload unavailable');
  const thinking = resolveModelThinking(config, config.thinkingMode);
  const declaredThinking = Boolean(config.thinkingLevels?.length || Object.keys(config.thinkingLevelMap ?? {}).length) || config.defaultThinkingLevel !== undefined;
  const legacy = (config.api === undefined || config.api === 'openai-completions') && !declaredThinking
    && (!thinking.thinkingSupported || config.thinkingMode === undefined) && config.provider.toLowerCase() === 'deepseek';
  return { ...payload, ...(legacy ? { thinking: { type: 'disabled' } } : {}) };
}
```

### 盘点发现
1. **存在两套 DeepSeek 判断口径**：
   - `isVerifiedDeepSeekModel`（[config.ts](../../../experiments/harness-lab/src/server/config.ts#L52-L57)）采用严格的 `api + baseUrl + model` 三元组白名单，用于 `requestReminder` 和 `thinkingFormat: 'deepseek'`；
   - `providerPayload` 仍用 `config.provider.toLowerCase() === 'deepseek'` 字符串别名判断是否补 `thinking: { type: 'disabled' }`，与 `.trellis/spec/backend/model-thinking.md` 第 40/73 行“Never select exceptions by provider alias alone”存在口径不一致。
2. **潜在副作用**：若管理员新增一个 `provider: 'deepseek'` 但指向第三方兼容网关（如 OpenRouter / 自建 vLLM / 不识别 `thinking: { type: 'disabled' }` 字段的端点）且未显式配置 `thinkingLevels`，该分支会自动注入非标准字段 `thinking: { type: 'disabled' }`，可能导致上游 400 报错。
3. **处置建议（不越界改动）**：
   - **实验期间不修改主业务代码**，在阶段 1 离线测试中记录该分支对不同配置的 wire payload 影响；
   - **收敛建议**：在 Issue #4 的最终收口 PR 中评估同步收窄——将 `legacy` 条件中的 `config.provider.toLowerCase() === 'deepseek'` 替换为 `isVerifiedDeepSeekModel(config)`（仅保护已验证的历史官方/方舟端点），或者在确认所有存量 `model-settings.json` 均已显式声明 `thinkingLevels`/`thinkingLevelMap` 后，拆出独立小 Issue 彻底移除 `providerPayload` 兜底，改由 `configuredRuntime` 与模型能力配置统一表达。

---

## 6. 准备工作、运行环境与零副作用隔离清单

本节基于 2026-11-27 对本机环境的实测核查结果（完整记录见 [research/local-env-audit.md](research/local-env-audit.md)）。

### 6.1 需要预先准备哪些模型的 Key？

所有 Key **严禁写入仓库或覆盖现有 `.env.local`**，执行实验时仅通过临时隔离环境变量文件（如 `/tmp/berserk-ctx-eval-secrets.env`，权限 `0600`，用完即删）或交互式终端 `export` 临时传入实验进程。

| 级别 | 平台 / 模型 | 协议与端点 | 所需凭证 | 用途 |
| --- | --- | --- | --- | --- |
| **必选 1** | **默认 DeepSeek**（方舟 `deepseek-v4.1-flash` 或 DeepSeek 官方 `deepseek-flash`） | `openai-completions`<br>方舟：`https://ark.cn-beijing.volces.com/api/plan/v3`<br>官方：`https://api.deepseek.com` | 火山方舟 API Key 或 DeepSeek 官方 API Key | 第 1 层 A/B/C/D1/D2 核心对照 + 第 2 层 OpenCode 参照（如两者皆有，优先以线上 4316 现役默认的方舟 `deepseek-v4.1-flash` 为主基准） |
| **必选 2** | **Kimi Code**（`kimi-for-coding` / K2.8 Preview，或账号实际可用型号） | `anthropic-messages`<br>`https://api.kimi.com/coding` | Kimi Code API Key（需确认账号允许本次隔离技术验收调用） | 第 1 层 Anthropic 协议对照（A/C/D1）+ 跨模型 S7（`DeepSeek → Kimi → DeepSeek`）+ 第 2 层 OpenCode 参照 |
| **可选 3** | **Anthropic / Claude**（仅当跑第 2 层 Claude Code CLI 探针） | Anthropic Messages | `ANTHROPIC_API_KEY`（或独立账号登录，见隔离说明） | 第 2 层 Claude Code CLI 2 条行业参照探针 |
| **可选 4** | **OpenAI / Codex**（仅当跑第 2 层 Codex CLI 探针） | OpenAI Responses / Chat | `OPENAI_API_KEY`（推荐 API Key 而非复用个人登录态，便于走本地代理） | 第 2 层 Codex CLI 2 条行业参照探针 |

### 6.2 需要什么运行环境：本机 macOS vs Ubuntu 服务器？

先说明本机实测状态（2026-11-27）：
- 本机为新初始化的 macOS Mac Mini，已安装 `/opt/homebrew/bin/brew` 和系统 `python3` (3.9.6)，**尚未在系统 PATH 安装 `node` (要求 Node 24)、`npm`、`docker`、`opencode`、`claude`、`codex`**；
- 本机装有 `Clash Verge.app`（具备海外端点网络代理条件），`~/.codex` 与 `~/.cc-switch` 已存在，`~/.config/opencode` 与 `~/.claude` 不存在；
- **不需要 Docker**：本次实验测试的是 Pi 上下文组装、工作区指令工具（`instructions_read`/`instructions_update`）、资料工具（`source_read`）与原生压缩，**不涉及容器沙盒文件工具**，因此无论本机还是服务器都无需 Docker。

| 对比维度 | 方案一：本机 macOS 独立 worktree（**推荐**） | 方案二：Ubuntu 服务器（`tencent-server` 独立临时目录） |
| --- | --- | --- |
| **Node 24 运行时** | 需安装 `node@24`（`brew install node@24`，约 1 分钟） | 已有 Node `v24.14.0`（开箱即用） |
| **网络连通性** | 直连国内 DeepSeek/方舟/Kimi，且可借 Clash Verge 访问 Anthropic/OpenAI（**适合同时跑第 1 层 + 第 2 层全部探针**） | 国内直连 DeepSeek/方舟/Kimi 稳定；但访问海外 Claude/OpenAI 官方端点及下载部分 CLI 可能受限 |
| **业务隔离风险** | **零线上风险**：独立 worktree + `/tmp` 临时数据目录，完全不触及 4316 生产机 | 服务器上运行着 `axon-4316.service` 生产服务；虽可用独立 `/tmp` 目录隔离，但仍需额外核对进程/端口与凭证安全 |
| **推荐结论** | **首选在本机 macOS 运行全套第 1 层 + 第 2 层**（仅需装 Node 24，且方便本地代理抓包和人工审阅结果） | 仅当你**明确不希望在本机安装 Node 24** 且**只跑国内 DeepSeek / Kimi（第 1 层 + OpenCode）**时，再考虑放 Ubuntu 服务器独立临时目录 |

### 6.3 额外依赖清单、准备方式与「零配置污染」隔离保证

> **核心承诺：本次实验绝不修改用户既有 CLI 配置、绝不影响其他项目、绝不写入用户真实 `$HOME` 下的配置目录。**

| 依赖 | 本机现状 | 是否必需 | 推荐准备方式（最小侵入） | 实验期隔离方式（如何保证不影响原软件/其他项目） | 测试后清理 |
| --- | --- | --- | --- | --- | --- |
| **Node.js 24** (`>=24 <25`) | 未在系统 PATH 安装 | **第 1 层必需**（`package.json` 要求） | 方式 A：`brew install node@24`（并仅在实验终端临时 `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"`，不强制改 `~/.zshrc`）；<br>方式 B：若只作一次性运行，也可使用独立目录解压官方 macOS arm64 Node 24 tarball，实验完直接删目录。 | 仅提供 JS 运行时，不写入全局项目配置；`npm ci` 仅在独立 worktree `/Users/lau/workspace/berserk-context-assembly-eval/experiments/harness-lab/node_modules` 内执行，不影响主仓库 `/Users/lau/workspace/berserk`。 | 方式 B 删目录即零残留；方式 A 如保留 Node 24 亦为本仓库常规开发必需环境，不会破坏其他软件。 |
| **OpenCode CLI** | 未安装（`~/.config/opencode` 不存在） | **第 2 层优先推荐** | 使用**实验专用隔离前缀**安装，不装到全局：例如 `npm_config_prefix=/tmp/ctx-eval-tools npm install -g opencode-ai`（或官方单文件二进制放到 `/tmp/ctx-eval-tools/bin/opencode`），通过绝对路径调用。 | 运行时强制覆盖全部环境目录：<br>`HOME="$EVAL_HOME"`<br>`XDG_CONFIG_HOME="$EVAL_HOME/.config"`<br>`XDG_DATA_HOME="$EVAL_HOME/.local/share"`<br>`XDG_CACHE_HOME="$EVAL_HOME/.cache"`<br>`OPENCODE_CONFIG="$EVAL_HOME/opencode.json"`<br>工作目录设为 `mkdtemp` 临时目录，不触碰真实 `~/.config/opencode` 或任何业务仓库。 | 删除 `/tmp/ctx-eval-tools` 与 `$EVAL_HOME` 即 100% 清除，系统零残留。 |
| **Claude Code CLI** (`claude`) | 未安装（`~/.claude` 不存在） | **第 2 层可选** | 同上，装在 `/tmp/ctx-eval-tools` 独立前缀（`npm_config_prefix=/tmp/ctx-eval-tools npm install -g @anthropic-ai/claude-code`）或按需 `npx --yes --cache /tmp/ctx-eval-npm-cache`。 | 运行时强制指定：<br>`CLAUDE_CONFIG_DIR="$EVAL_HOME/.claude"`<br>`HOME="$EVAL_HOME"`<br>`ANTHROPIC_BASE_URL="http://127.0.0.1:<proxyPort>"`<br>`ANTHROPIC_API_KEY="$EVAL_ANTHROPIC_KEY"`<br>使用 `--no-session-persistence`（若版本支持）+ 临时工作目录，**绝不读取/写入 `~/.claude` 或 `~/.cc-switch`**。 | 删除 `/tmp/ctx-eval-tools`、`/tmp/ctx-eval-npm-cache` 与 `$EVAL_HOME` 即完全还原。 |
| **Codex CLI** (`codex`) | 未在 PATH 找到（但 **`~/.codex` 已存在**，必须严防污染！） | **第 2 层可选** | 同上，独立前缀安装 `@openai/codex` 至 `/tmp/ctx-eval-tools`，不覆盖系统已有的 Codex 应用/运行时。 | 运行时强制指定：<br>`CODEX_HOME="$EVAL_HOME/.codex"`<br>`HOME="$EVAL_HOME"`<br>`OPENAI_BASE_URL="http://127.0.0.1:<proxyPort>/v1"`<br>`OPENAI_API_KEY="$EVAL_OPENAI_KEY"`<br>**严禁读取、复制或修改用户真实的 `/Users/lau/.codex`**（保留用户原有认证、会话、配置与 worktree 原封不动）。 | 删除 `/tmp/ctx-eval-tools` 与 `$EVAL_HOME` 即完全还原；用户真实的 `~/.codex` 从未被打开或写入。 |
| **本地脱敏 HTTP 代理** | 无需第三方依赖 | **第 2 层必需** | 用 Node 24 内置 `node:http` + `fetch` 写 ~120 行轻量脚本放在本任务目录内，零额外 npm 依赖。 | 仅监听 `127.0.0.1:0`（随机空闲端口），实验进程退出即关闭；不改系统代理，不影响 `Clash Verge.app` 与浏览器。 | 随进程结束自动释放端口。 |

### 6.4 对其他项目与用户日常使用的完整影响评估

1. **主仓库 `/Users/lau/workspace/berserk`（`feat/model-management-ux`）**：**零影响**。所有实验代码、设计文档与分支操作都在独立的 git worktree `/Users/lau/workspace/berserk-context-assembly-eval` 进行；实验结束后可用 `git worktree remove` 干净移除工作区。
2. **线上 4316 服务与用户会话数据**：**零影响**。实验不连接 4316，不读取真实 `LAB_DATA_DIR` 或生产 `.env.local`。
3. **本机既有工具配置（`~/.codex`、`~/.cc-switch`、`~/.gemini`、浏览器、`Clash Verge`）**：**零影响**。第 2 层所有外部 CLI 均安装在 `/tmp/ctx-eval-tools` 并在独立 `$EVAL_HOME` 沙箱环境变量下运行，执行完毕删除临时目录后，系统环境与实验前完全一致（除若你选择通过 Homebrew 永久保留 `node@24` 供日常开发使用外）。

---

## 7. 待用户确认的决策项（确认后才进入 Phase 2 实现与跑测）

请审阅上述方案并确认以下 5 项，确认后我将执行 `task.py start` 进入实现与离线门禁验证：

1. **模型组合**：第 1 层默认跑 **方舟 `deepseek-v4.1-flash`（thinking off）+ Kimi Code `kimi-for-coding`**；是否需要同时加跑 **DeepSeek 官方 `deepseek-flash`** 或 **DeepSeek thinking 开启 (`high`)** 档位？
2. **D 组拆分**：是否同意 **D1 全场景主测 + D2 仅跑 S2/S3/S6 专项验证 KV Cache 与压缩后旧规则复活**？（若想进一步压缩成本可先跳过 D2）
3. **第 2 层外部 Harness 范围**：是否确认 **必跑 OpenCode（接 DeepSeek/Kimi）**，以及是否需要追加 **Claude Code CLI** 和/或 **Codex CLI** 的 2 条苛刻探针？
4. **运行环境选择**：是否同意在**本机 macOS 独立 worktree** 运行（安装 `node@24`，外部 CLI 装在 `/tmp/ctx-eval-tools` 用完即删），还是希望放 Ubuntu 服务器跑国内端点部分？
5. **预算上限**：是否批准第 1 层硬上限 **276 次请求（预计 ~196 次，约 ¥5–¥20）** + 第 2 层按所选 CLI 增加 **16–64 次请求**？
