# PRD：多平台上下文组装对照实验（GitHub Issue #4）

**关联 Issue：** [#4 评估并收敛 DeepSeek 额外指令提醒，统一多平台上下文组装约定](https://github.com/pulpcode/berserk/issues/4)
**基线与分支：** 基于 `main` (`3a991e8`) 新建独立分支 `exp/context-assembly-eval`（独立 worktree：`/Users/lau/workspace/berserk-context-assembly-eval`），保留主仓库 `feat/model-management-ux` 未提交工作原状。
**当前阶段：** `planning`（方案与预算待用户审阅确认；批准前不发起真实付费模型请求，不修改主业务默认行为，不提前删除现有 DeepSeek 补丁）。

---

## 1. 背景与要解决的问题

当前 Berserk（Pi `0.85.1`）在上下文组装与协议转译上存在显式的平台不一致：

1. 所有模型均通过 Pi 原生路径 `agentsFilesOverride → DefaultResourceLoader → Context.systemPrompt` 加载通用与工作区指令（`<project_context>`）。
2. 为解决早期 `deepseek-flash`（关闭 thinking）在同会话规则替换/清空后仍沿用旧历史风格的问题，宿主机在 [lab.ts](../../../experiments/harness-lab/src/pi/lab.ts) 中额外生成了一份 `<host_request_instructions>` 提醒副本，并在传输控制层 [controlled-stream.ts](../../../experiments/harness-lab/src/pi/controlled-stream.ts) 的 `onPayload` 钩子里扫描已编码的 HTTP `messages`，于最后一条 `role: 'user'` 前硬插一条独立的 `role: 'system'` 消息。
3. 首批多平台接入已把该补丁收窄至精确白名单 `isVerifiedDeepSeekModel`（`openai-completions` 下的官方 `deepseek-flash` 与方舟 `deepseek-v4.1-flash`），Kimi 走原生 `systemPrompt`；但这只是过渡止血：
   - `controlledStream.onPayload` 存在分层污染（在协议编码后的 wire JSON 里做业务消息定位），不可跨协议推广（Anthropic 不支持消息流中插入 `system`，且 `tool_result` 编为 `role: 'user'`）；
   - 未变更规则的普通回合也要每轮重复发送全文指令快照；
   - 精确二元组白名单在模型版本升级或换代理后会静默失效；
   - 现役 DeepSeek 与 Kimi 尚未在同一组严格隔离合成规则用例下完成真实对照，无法判断“能否直接走原生路径”或“是否需要统一的协议无关变更提醒”。

本任务的目标是**通过严谨的两层对照实验与客观证据**，回答 Issue #4 的核心决策问题，为后续收敛多平台上下文组装契约提供可复核的实证依据。

---

## 2. 实验范围（两层结构）

### 第 1 层：核心策略对照（强控制变量，直接支撑 Issue #4 决策）
- 在 Berserk + Pi `0.85.1` 隔离实验环境中，固定底座模型、基础系统提示词和同一组隔离合成规则用例，**仅以「工作区指令（`AGENTS.md`）注入与变更提醒策略」作为自变量**，比较四组策略：
  - **A 组（Pi / OpenCode 原生模式）**：仅更新顶部 `systemPrompt` 的 `<project_context>`，尾部零注入。
  - **B 组（Berserk DeepSeek 现状基线）**：顶部更新 + 每轮 `onPayload` 在最后一条 `user` 前硬插 `role: system` 全文快照（仅用于 OpenAI Completions / DeepSeek 回归基准）。
  - **C 组（Claude Code `<system-reminder>` 风格）**：协议无关的尾部 `role: user` `<system-reminder>` 瞬态注入（兼容 OpenAI Completions 与 Anthropic Messages，不落盘、不改原生用户原文）。
  - **D 组（Codex Append-Only / 按变更触发风格）**：规则未变时尾部零注入；仅在同会话检测到 `AGENTS.md` hash 相对上一轮修改或清空时，尾部追加一次协议无关的「规则已更新/已清空」声明（细分为 **D1 顶部同步更新 + 尾部变更声明** 主推子组与 **D2 顶部冻结初始快照保 KV Cache + 尾部变更声明** 专项对照子组）。

### 第 2 层：轻量外部 Harness 参照探针（摸底行业基线，不建重型框架）
- 优先使用 **OpenCode** 接入同一 DeepSeek / Kimi 模型端点（排除底座差异），对比成熟开源 Harness 在「同会话规则替换 / 同会话规则清空续聊」上的行为。
- 可选使用 **Claude Code CLI / Codex CLI** 仅跑上述 2 条最苛刻探针作为行业基线参考。
- **强制前置门禁**：第 2 层必须经过本地脱敏 HTTP 反向代理截获真实 wire payload，先核实新规则是否确实发送给模型，避免将“Harness 不热重载”误判为“模型不遵守”。

### 顺带盘点项
- 梳理并评估 [model-runtime.ts](../../../experiments/harness-lab/src/pi/model-runtime.ts) 中 `providerPayload` 仍按 `config.provider.toLowerCase() === 'deepseek'` 兜底 `thinking: { type: 'disabled' }` 的旧兼容分支，明确是随 Issue #4 收口还是拆出独立承接项。

---

## 3. 强约束与红线

1. **审阅门禁**：本方案、预算、准备清单与隔离措施未经用户明确批准前，**严禁发起任何真实付费模型请求**。
2. **零主业务污染**：实验期不修改主业务默认行为，不提前删除现有 DeepSeek 补丁，不触碰线上 4316 服务及任何真实用户会话/工作区。
3. **复用 Pi 原生边界**：继续复用 Pi `0.85.1` 原生会话、工具循环、压缩和协议适配器；不新建通用上下文框架，不重写 Pi `convertToLlm`；临时提醒不得累计、不得落盘回写原生会话、不得篡改原生用户原文、不得注入摘要压缩调用。
4. **严格断言与诚实记录**：所有行为断言使用确定性严格判定（前缀严格在开头、清空后无继承和无臆造装饰标记等），不做宽松关键词假阳性匹配；保留全部失败样本原文、脱敏 wire payload 结构证据与真实 usage（含 `cacheRead`）；不因失败而临场改提示词刷分。
5. **凭据与隐私安全**：绝不在代码、日志、测试证据、Git 提交或报告中写入、复制或打印任何真实 API Key；绝不污染用户本机既有 CLI 配置目录（`~/.codex`、`~/.cc-switch`、`~/.claude`、`~/.config/opencode` 等）。

---

## 4. 验收与退出条件（对齐 Issue #4）

- [ ] **阶段 0（当前）**：完成分支隔离、本机环境核查、两层实验方案、预算上限与环境/依赖准备清单落盘，并通过用户审阅确认。
- [ ] **阶段 1（离线协议门禁）**：使用真实 Pi `0.85.1` 适配器 + 本地模拟 HTTP，完成 A/B/C/D1/D2 的协议结构验证（合法角色、`system` 位置、工具调用与结果 ID、同 `requestId` 快照不变、`steer/followUp` 行为、不落盘、compaction 隔离、`DeepSeek → Kimi → DeepSeek` 转换）。
- [ ] **阶段 2（第 1 层真实验证）**：在硬预算上限内完成现役 DeepSeek 与 Kimi（及用户确认的其他模型）在 S1–S7 七大合成场景下的 A/B/C/D 对照，产出结构化对比表（通过率、失败全文、脱敏 wire payload、`usage.input`/`output`/`cacheRead`）。
- [ ] **阶段 3（第 2 层外部参照）**：完成 OpenCode（及用户确认的可选 Claude Code / Codex）的 2 条苛刻探针与本地脱敏代理 wire payload 核验。
- [ ] **阶段 4（决策产出）**：基于实证数据形成 Issue #4 收敛建议报告，明确：
  1. 统一上下文契约、各内容进入模型的位置与落盘边界；
  2. 是否移除或迁移 DeepSeek 位置补丁（含不回归证据与回退办法），或若必须保留例外则写明具体原因、适用范围与复评条件；
  3. `providerPayload` 旧 `deepseek` 别名兜底分支的处置结论。
