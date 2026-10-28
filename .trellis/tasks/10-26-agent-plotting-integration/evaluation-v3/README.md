# 标绘整合测评驱动 v3

本版仅修正测评器的代答和轮次口径；不修改产品 Skill、工具或既有模型成绩。`evaluation/` 与 `evaluation-v2/` 保持不变。运行入口为 `run.ts`，版本为 `recurring-errors-v3`。

## 改动与边界

- 取消“把原题再次发给模型”的兜底。说明证据不足不能触发自动续跑；确实要求当前输入但无法安全代答时记 `waiting_user`，范围不明确时记 `needs_review`。
- C02/C08 只保留冻结题目允许的两种答案。必须匹配实际请求车型选择、方向冲突确认的窄句式；只出现消防车、90°或候选选项不能触发代答。每个原题首轮最多一次，其他措辞宁可待复核。选项不会补充问题正文的语义。
- `finished` 仍只是未检测到阻塞问句，`recorded` 仍只是协议结束；两者都不是语义通过。每槽始终需要独立证据复核。
- 复用不可变 v2 的题目、准备器、预算、provider、统计、评分模块，冻结清单另包含整个 v2 目录及原辅助依赖。保留模型一致性、完整30槽评分分母、预算、一次性claim、禁止自动重试、关键效果错误停批等原保护。

## 轮次口径

| 字段 | 含义 |
| --- | --- |
| `messageSendAttempts` | 完成认证准备后，尝试调用消息 POST 的次数；网络失败也计入。 |
| `sentTurns` | 收到消息 POST 成功HTTP响应且带响应体的次数。网络错误无法确认是否已送达时不推定成功。 |
| `successfulResponseTurns` | 结束快照中宿主请求状态为 `succeeded` 的响应数，包含脚本追问响应。即便效果错误而停批仍计入。 |
| `respondedUserTurns` | 至少得到一次上述成功响应的原始用户轮次，按原题轮次去重。未判断是否答对。 |
| `completedTurns` | 保留旧字段：被协议结束语分类器接受的原始轮次。不得解释为实际发送次数、回答次数或业务完成数。 |
| `requests` | provider模型请求数，沿用ledger与原始attempts核对。不是用户轮次。 |

例如 C09 收到一轮“资料不足”的解释，记发送1、成功响应1、原题已响应1；若结束语需要复核，`completedTurns=0`、`status=needs_review`。重复写造成关键错误时也可以是成功响应1且业务失败。

## 验证与运行

在 `experiments/harness-lab` 执行：

```sh
node --import tsx --test --test-concurrency=1 ../../.trellis/tasks/10-26-agent-plotting-integration/evaluation-v3/*.test.ts
node_modules/.bin/tsc --noEmit -p ../../.trellis/tasks/10-26-agent-plotting-integration/evaluation-v3/tsconfig.json
node_modules/.bin/eslint --config eslint.config.js ../../.trellis/tasks/10-26-agent-plotting-integration/evaluation-v3/*.ts
```

HTTP测试使用本机5279隔离数据，受控provider不调用真实模型。不与其他测试并发占用该端口；执行中保持产品、驱动及冻结依赖不变。结果详见 [检查记录](../verification/recurring-errors-20261028/evaluator-checks.md)。

默认仍为准备夹具。真实批次需要新freezeHash、独立额度/范围授权及尚未存在的证据目录；旧授权不能用于v3。具体额度和进入条件沿用 [v2说明](../evaluation-v2/README.md)。本次未发起真实模型测评，不宣称业务失败已修复。本目录驱动是原30槽的版本化基础，并非本轮小样本A/B诊断的自动执行授权。
