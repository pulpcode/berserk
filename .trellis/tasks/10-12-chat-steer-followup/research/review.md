# Queue 实现独立审阅（2026-10-12）

## 已修复

- `src/pi/message-intake.ts`：`length` 工具输出后 Pi 可以在同一次 native run 继续生成，未必再次触发 `agent_start`。原实现仅在后者恢复 parked 队列，导致已经接收的消息未随正常后续执行消费。真实 Pi 回归先复现（模型调用只有 2 次，后续消息未消费），再修为 Pi 后续 assistant `message_start` 也可恢复。没有宿主主动 prompt/continue，停止后的队列仍不恢复。
- `tests/pi/fake-runtime.ts`：测试模型同时声明 `length` 和工具调用时应输出 length stopReason，原工具分支覆盖了它；调整优先级以模拟真实截断工具输出。
- `tests/pi/message-intake.test.ts`：新增截断工具输出同 run 延续的回归，断言只有 1 次 agent_start、3 次模型调用、追加消息只消费 1 次。
- 已同步 `.trellis/spec/backend/harness-lab.md` 和 `research/queue-spike.md` 的 native 恢复边界。

## 已由主会话修复

- `src/web/useInputQueue.ts` 直接调用浏览器 crypto.randomUUID，在当前公网 HTTP origin 不可用；主会话已改为既有 `random-uuid.ts` helper，并安排浏览器测试模拟缺少原生 randomUUID。
- 同一文本重写后的较晚提交回执不能仅按文本相等清除新草稿；主会话已增加草稿版本以区分编辑，并安排延迟回执回归。
- 同 host request 中多条追加用户输入的历史展示分段由主会话修复 `processGroups.ts`；审阅者未重叠编辑该模块。

## 审阅结论与边界

- 检查实际 Pi 0.85.1 public Agent dispatch：按订阅顺序 await listener。AgentSession 的持久化先完成，随后本模块才按原消息对象标记 consumed；不是依赖纯文本匹配或单纯看到 message_start。
- turn_end 门禁先于 native 队列 drain；claimed input 在准备阶段不能删除或重排。停止先清尚在队列的内容，待 native settle 后仅退回仍未发出用户事件的内容。现有真实 Pi 测试覆盖这些竞态。
- 两种队列仍由 Pi 调度，宿主 clear/requeue 为同步操作；转换与撤销进入对应通道队尾。同文独立对象、同提交重试、跨席位授权、纯文本 schema 均已有测试。
- 回执按新 bind 清理已终结记录，保留未取回文本；旧 expectedRequestId 不能投向新执行。重启回执未知并不触发重发。此内存边界与本期设计一致。
- 未发现需要更改公共接口或模块边界的阻断项。最终浏览器覆盖和整合后的全套验证由主会话负责；本审阅未执行部署或 Git 提交。

## 本审阅实际验证

在 `experiments/harness-lab` 执行：

- `npm run typecheck`：通过。
- `npm run lint`：通过，包含 Pi/browser import boundary 检查。
- `npm test -- tests/pi/message-intake.test.ts tests/pi/message-intake-lab.test.ts tests/pi/compaction.test.ts tests/server.test.ts tests/seat-api.test.ts`：5 文件、52 测试通过。

上述命令在本地修复后重跑。更晚的主会话前端改动仍应纳入最终验证。

整合补充：公网 HTTP UUID fallback 与同文重写晚回执浏览器回归均已通过；processGroups 单元测试通过。主会话以真实 PiLab 的队列浏览器测试及独立 SSE 分段浏览器测试完成覆盖，见 validation.md。
