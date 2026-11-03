# 评测继续关口：先核对是否需要用户输入

这是评测程序的适配层，不是产品 Agent 新状态机，也不是已获准运行的真实测评入口。

## 改了什么

旧驱动靠问号、关键词推断是否必须追问。这层不再猜自然语言：每个已结束的请求保存原生会话、地图状态和请求身份，然后等待一次明确复核。

- `advance`：本轮已经作答，发送原题中已冻结的下一轮。回答即使错误，也可结束本轮；事实正确性仍单独评分。
- `reply`：确实缺少必需信息，只可选该轮预先列出的固定回复；每条一次，不能临时教模型答案。
- `hold`：无法确认，保留待复核，不自动继续、不猜答案。

决定必须带复核者、理由及当前证据哈希。等待后再读实际会话与地图，若已经变化就拒绝旧决定。发送前记录尝试；网络失败不会重发；原题发送和澄清回复分别计数。

## 怎样接到下一轮 runner

`runReviewedTurns({directory,prompts,replies,ports})` 接收现有 runner 的三个函数：

1. `send(text)`：发送冻结文字到现有会话。流中的结构化 AskUser 仍使用现有 interaction response API 和白名单；等待它真正结束后返回证据。
2. `review(checkpoint)`：把保存在文件中的公开对话、效果及预定题目交给人工或 Codex 离线复核。Promise 未决期间不要关闭 HTTP 服务或原生会话；收到裁决后才继续。
3. `inspect()`：重新获取同一会话和地图状态，验证裁决没有过期。

`http.test.ts` 是真实接入示例：实际本地 HTTP、Pi、ask_user、空间工具和保存工具执行，只有模型输出受控。它先回答中心问题，再生成500米范围，保留会话等待复核，随后只发送一次原定保存轮，将同一个固定几何保存为方案。题目和响应是构造的工程检查，不是模型效果测评。

## 限制必须保留

- 所有普通终态目前都需要明确复核，没有自动语义判别器；适用于下一轮小规模检查，较大批次的人力成本应另行安排。
- `review` Promise 等待期间可在同一进程继续；`hold` 是显式结束本次适配调用，不是自动恢复承诺。调用者保管服务生命周期。
- 不支持进程退出后的自动恢复。已有证据目录拒绝重启，防止重复发送；恢复旧会话需另行核实身份、版本和未发送轮次，不能据此声称已补齐历史 Q20。
- 原生请求仍 pending 或失败时，不能借普通文字回复绕过交互API；返回待复核。实际 AskUser 的已批准固定回复由 `send` 的现有交互处理完成，测试覆盖此链路。
- 预算、模型版本、冻结源校验和关键效果停批由下一轮 runner 原有机制负责，不能只用本模块绕开它们。
- `recorded` 只表示冻结原题已发出且逐轮获准继续；所有返回仍标 `semanticReview: pending`。

## 历史材料与构造材料

`historical-endings.json` 包含 R16 Q20 和标绘 C09 的原始快照副本、来源文件及SHA-256。离线回放只检验控制流程，不重新评分、不冒充重跑旧题。其后的模拟响应及其复核决定均为构造测试数据。

`review-gate.test.ts` 还覆盖必要澄清、未知问题、错误但已答、过期裁决、状态变化、未冻结回答、等待复核不发题、网络失败不重试、重述原文仍记为澄清回复。

运行（项目根目录）：

```sh
experiments/harness-lab/node_modules/.bin/tsc --noEmit -p .trellis/tasks/10-28-agent-spatial-plotting/evaluation/tsconfig.json
experiments/harness-lab/node_modules/.bin/eslint --config experiments/harness-lab/eslint.config.js .trellis/tasks/10-28-agent-spatial-plotting/evaluation/*.ts
```

测试从 `experiments/harness-lab` 执行：

```sh
node --import tsx --test --test-concurrency=1 ../../.trellis/tasks/10-28-agent-spatial-plotting/evaluation/*.test.ts
```

不读取 `.env.local`，不需要真实 API Key，无真实模型调用。
