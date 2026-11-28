# 多平台上下文组装对照实验最终报告（GitHub Issue #4）

**日期：** 2026-11-28
**关联 Issue：** [GitHub Issue #4：评估并收敛 DeepSeek 额外指令提醒，统一多平台上下文组装约定](https://github.com/pulpcode/berserk/issues/4)
**代码基线：** `main` (`3a991e8`) · Pi `0.85.1` · 实验分支 `exp/context-assembly-eval`
**隔离环境：** 本机 macOS 独立 worktree（`/Users/lau/workspace/berserk-context-assembly-eval`），Node `v24.22.3`，全合成临时工作区，无真实用户数据、无密钥泄露。

---

## 1. 执行总览与成本审计

全部真实模型请求均走 **火山方舟 AgentPlan** 官方协议端点（未触碰按量 `/api/v3`）：
- **DeepSeek（OpenAI Completions）**：`https://ark.cn-beijing.volces.com/api/plan/v3` · `deepseek-v4.1-flash`（`thinkingMode=off`，对齐历史基线）
- **Kimi（Anthropic Messages）**：`https://ark.cn-beijing.volces.com/api/plan` · `kimi-k2.8-preview`（服务端默认 thinking）

| 阶段 | 真实请求数 | 缺失 usage | Input Tokens | CacheRead Tokens | Output Tokens | 原始脱敏证据 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Stage 1 离线协议门禁（5 文件 / 53 用例） | 0 | 0 | 0 | 0 | 0 | `tests/pi/context-assembly-eval.test.ts` |
| Stage 2 第 1 层：DeepSeek (A/B/C/D1/D2) + 跨模型 S7 | 144 | 0 | 233,887 | 424,192 | 17,041 | [layer1-results.md](layer1-out/layer1-results.md) |
| Stage 2 第 1 层：Kimi (A/C/D1) | 78 | 0 | 128,663 | 218,880 | 25,063 | [layer1-results.md](layer1-kimi-out/layer1-results.md) |
| Stage 3 第 2 层：OpenCode (DS/Kimi) + Claude Code (Kimi) | 11 | 0 | 32,744 | 37,632 | 1,648 | [layer2-probes.md](layer2-out/layer2-probes.md) |
| **总计** | **233** | **0** | **395,294** | **680,704** | **43,752** | 低于批准上限（276 + 48 次） |

所有第 1 层参测场景均完成原生 `SessionManager` JSONL 洁净度核验：**100% 未将 `<host_request_instructions>` 或 `<system-reminder>` 写回原生会话，未改写持久化用户原文，未将回复提醒注入 compaction 流**。

---

## 2. 核心实证结果对比

### 2.1 第 1 层核心策略对比矩阵（强控制变量）

> **关于「机检」与「人工复核实质通过」的透明说明（严禁隐藏原始断言结果）：**
> 自动化严格断言将「正文解释中客观提及旧前缀名」（如清空后回答“此前回答里的【赤松】并非工作区要求”，或 S4-T1 回答“【赤松】已按要求将前缀改为【雪松】，下轮生效”）也判为 FAIL。下表同时列明 **严格机检结果** 与 **逐条核验失败全文后的实质通过率**，原始失败样本全文保留在 [layer1-out/layer1-results.md](layer1-out/layer1-results.md) 和 [layer1-kimi-out/layer1-results.md](layer1-kimi-out/layer1-results.md)。

#### A. DeepSeek (`deepseek-v4.1-flash`, OpenAI Completions, `thinking=off`)

| 策略 | 机检通过 | 实质通过（复核原文） | S2 规则替换 | S3 清空问答 | S4 工具写入（当轮/下轮） | S5 工具+下轮切换 | S6 压缩后续聊 | 总 Input (未命中) | 总 CacheRead | 缓存率 `C/(I+C)` |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | ---: | ---: | ---: |
| **A 组（纯原生）** | 0/6 | **0/6 (0%)** | ❌ 0/2（仍用赤松） | ❌ 0/2（仍用赤松） | ✅ 当轮 / ❌ 下轮 | ❌ 下轮仍青竹 | ❌ 0/2（仍用赤松） | 48,325 | 70,016 | 59.2% |
| **B 组（现状 onPayload system）** | 4/6 | **6/6 (100%)** | ✅ 2/2 | ✅ 2/2 | ✅ 当轮 / ✅ 下轮 | ✅ | ✅ 2/2 | 51,413 | 71,424 | 58.1% |
| **C 组（协议无关 user reminder）** | 4/6 | **6/6 (100%)** | ✅ 2/2 | ✅ 2/2 | ✅ 当轮 / ✅ 下轮 | ✅ | ✅ 2/2 | 52,215 | 71,936 | 57.9% |
| **D1 组（顶部同步 + 变更触发）** | 3/6 | **5/6 (83%)** | ✅ 2/2 | ✅ 2/2 | ❌ 当轮抢跑雪松 / ✅ 下轮 | ✅ | ✅ 2/2 | **40,298 (-22%)** | **76,928** | **65.6%** |
| **D2 组（顶部冻结 + 变更触发）** | 0/4 | **0/4 (0%)** | ❌ 次轮退回赤松并“自我纠错” | ❌ 翻供称赤松仍有效 | —（未测） | —（未测） | ❌ 0/2（100%复活赤松） | 26,491 *(仅4项)* | 70,784 *(仅4项)* | **72.8%** |

#### B. Kimi (`kimi-k2.8-preview`, Anthropic Messages)

| 策略 | 机检通过 | 实质通过（复核原文） | S2 规则替换 | S3 清空问答 | S4 工具写入（当轮/下轮） | S5 工具+下轮切换 | S6 压缩后续聊 | 总 Input (未命中) | 总 CacheRead | 缓存率 `C/(I+C)` |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | ---: | ---: | ---: |
| **A 组（纯原生）** | 0/6 | **1/6 (17%)** | ❌ 0/2（仍用赤松） | ❌ 0/2（#1 追问也咬定赤松有效） | ✅ 当轮 / ✅ 下轮 | ❌ 下轮仍青竹 | ❌ 1/2（#2 压缩后仍用赤松） | 43,314 | 68,608 | 61.3% |
| **B 组** | N/A | N/A | — | — | — | — | — | — | — | 不适用（Anthropic 非法） |
| **C 组（协议无关 user reminder）** | **6/6** | **6/6 (100%)** | ✅ 2/2 | ✅ 2/2 | ✅ 当轮 / ✅ 下轮 | ✅ | ✅ 2/2 | 46,610 | 73,984 | 61.3% |
| **D1 组（顶部同步 + 变更触发）** | 3/6 | **5/6 (83%)** | ✅ 2/2 | ✅ 2/2 | ⚠️ 当轮思考外泄但用赤松 / ✅ 下轮 | ✅ | ✅ 2/2 | **38,739 (-17%)** | **76,288** | **66.3%** |

#### C. 跨模型 S7（同会话 `DeepSeek → Kimi → DeepSeek`）

| 策略 | 切换 Kimi（R2 替换） | 切回 DeepSeek（R3 清空 + 记忆保留） | 说明 |
| --- | :---: | :---: | --- |
| **A 组（纯原生）** | ✅ 2/2 | ❌ 0/2（切回 DeepSeek 清空后分别沿用 `【青竹】` 与 `【赤松】`） | 清空规则跨模型回切必败 |
| **C 组（user reminder）** | ✅ 2/2（#1 偶发漏右括号 `【青竹`） | ✅ 2/2（清空后均零前缀且保留代号 `北极星-77`） | 跨协议规则替换与清空均有效 |
| **D1 组（按变更触发）** | ✅ 2/2 | ✅ 2/2（清空后均零前缀且保留代号 `北极星-77`） | 跨协议规则替换与清空均有效 |

---

### 2.2 第 2 层外部 Harness 参照探针结果（经本地脱敏代理实证）

| Harness × 模型 | 上下文策略（代理抓包实证） | P0 初始 R1 | P1 同会话替换 R2 | P2 同会话清空 | CacheRead 表现（P1 / P2） |
| --- | --- | :---: | :---: | :---: | --- |
| **OpenCode 1.19.6** × `deepseek-v4.1-flash` | 仅更新顶部 `messages[0]:system`，无尾部提醒 | ✅ PASS | ❌ FAIL（新规则已发，仍输出 `【赤松】`） | ❌ FAIL（规则已清空，仍输出 `【赤松】`） | P1 `0`（改顶部缓存归零） / P2 `1,792` |
| **OpenCode 1.19.6** × `kimi-k2.8-preview` | 仅更新顶部 `system`，无尾部提醒 | ✅ PASS | ✅ PASS | ❌ FAIL（规则已清空，**退回输出 `【赤松】`**） | P1 `6,656` / P2 `6,400` |
| **Claude Code 2.1.332** × `kimi-k2.8-preview` | 顶部 `system` 恒定 `7,044` 字符不变，每轮规则以 `<system-reminder>` 放入尾部 `role: user` | ✅ PASS | ✅ PASS | ✅ PASS | P1 **`11,008`** / P2 **`11,264`**（>97% 命中） |

---

## 3. 五大核心结论（直接回答 Issue #4 全部问题）

1. **「同会话规则替换/清空的近因惯性」不是 DeepSeek 独有，而是多平台共性缺陷；A 组纯原生路径在 DeepSeek 和 Kimi 上均不可用。**
   - 不仅是 `deepseek-v4.1-flash`（A 组 0/6 全败），开启推理的 `kimi-k2.8-preview` 在 A 组也仅 1/6 实质通过（S2/S3/S5/S6 全面失守，甚至追问时直接宣称旧规则仍有效）；外部参照 OpenCode 接 Kimi 同样在 P2 清空时退回旧前缀。
   - **推翻过渡假设**：不能简单删除 DeepSeek 补丁退回纯原生，也不能让 Kimi 继续停留在无尾部强化机制的纯原生路径。

2. **B 组现状的 `controlledStream.onPayload` 硬插 `role: system` 可以安全淘汰，由协议无关的 `Context` 层尾部 `role: user` `<system-reminder>` 完全替代。**
   - 在 DeepSeek 上，C 组与 B 组行为 **100% 实质等价**（均 6/6，S1–S6 全部通过），且在 Kimi 上 C 组达成 **6/6 严格机检 100% 全绿**，与第 2 层 Claude Code 3/3 全绿相互印证。
   - 迁移到 Pi 协议编码前的瞬态 `Context` 副本层后：
     - **零协议限制**：同时原生兼容 OpenAI Completions 与 Anthropic Messages，不挂到 `tool_result`；
     - **恢复分层纯净**：`controlledStream` 不再解析/改写已编码的 wire JSON，彻底移除 `isVerifiedDeepSeekModel` 硬编码白名单（不再因模型升版/换代理静默失效）；
     - **守住原生边界**：不写回 `SessionManager` JSONL、不修改持久化用户原文、不注入 compaction。

3. **D1 组（顶部同步 + 按 hash 变更触发）显著降低未命中输入 Token（-17%～-22%）并提升 Cache 命中率（~66%），但暴露出 1 个明确边界点（S4 同轮工具写入抢跑）。**
   - 未变更回合零尾部注入，在 S1/S2/S3/S5/S6 上表现优异（压缩后 4/4 全过）；
   - 唯一失分点在 S4-T1：当模型在**未变更开场的回合内**调用 `instructions_update` 写入新规则时，由于本轮没有尾部快照锚定，DeepSeek 在同轮续轮回复中提前使用了刚写入的 `【雪松】`。
   - **收敛选型建议（供决策二选一）**：
     - **方案一（最稳健零状态，推荐优先）：全平台统一采用 C 组（精简版协议无关瞬态 `<system-reminder>`）**——实现极简、无状态依赖、DeepSeek 与 Kimi 均 100% 实质通过、完美覆盖 S4 同轮写入与跨模型切换；未命中输入开销相对 D1 多约 17%–22%，但总绝对成本极低。
     - **方案二（极致缓存优化）：采用 D1+（按 hash 变更触发 + 本轮发生 `instructions_update` 后同轮续轮补发一次极短快照锁定提醒）**——兼得 D1 的 66% 缓存命中与 S4 防抢跑，只需在 `openSession` 里多判断 `active.changes.length > 0` 即可，同样零新增持久状态。

4. **D2 组（顶部冻结初始快照保 KV Cache）被彻底证伪，正式排除。**
   - 虽然 D2 的 `cacheRead` 最高（S6 达 72.8%），但在 S2 次轮即退回旧规则、S3 翻供否定清空、**S6 压缩后 2/2 100% 复活旧规则 `【赤松】`**，且需额外持久化会话初始快照，工程上不可接受。

5. **顺带盘点结论：`model-runtime.ts` 中 `providerPayload` 旧 `deepseek` 别名兜底应一并收口。**
   - 离线测试证实 `config.provider.toLowerCase() === 'deepseek'` 会向非白名单兼容网关误注入 `thinking: { type: 'disabled' }`。建议在 Issue #4 最终落地 PR 中，将其同步收窄为 `isVerifiedDeepSeekModel(config)`，待存量 schema 1–6 配置显式声明 thinking 能力后彻底移除。

---

## 4. 下一步建议（等待用户拍板后再改动主业务代码）

本实验分支未改动主业务默认行为，也未提前删除现有 DeepSeek 补丁。请审阅上述实证数据后确认采纳哪一收敛方案：
- **选项 1（推荐，最稳健）**：全平台统一迁移至 **C 组**（Pi `Context` 层瞬态 `role: user` `<system-reminder>`，可精简去重仅放工作区变更边界/当前正文），删除 `controlledStream.onPayload` 的 mid-stream `role: system` 插队与 `isVerifiedDeepSeekModel` 提醒白名单，顺手收窄 `providerPayload`。
- **选项 2（省 Token / 高缓存）**：全平台统一迁移至 **D1+**（未变更回合零尾部注入；仅在 `AGENTS.md` hash 相对上一轮变化/清空，或本轮刚执行 `instructions_update` 时注入瞬态 `<system-reminder>`），删除 `onPayload` 插队并补一轮 S4 回归验证。
