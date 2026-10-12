# 实施与验证记录

日期：2026-10-12。本次仅实现与验证，未操作线上、提交或推送 Git。

## 实际实现

- 公开 Pi Agent 原生双队列与同步事件消费门禁；独立 submissionId、请求目标检查、回执查询及逐条操作。
- 用户文字消费后由原 SSE 插入普通对话；同一 host request 的不同用户输入形成展示边界。
- 输入框上沿 Queue：默认三行、引导、删除/短暂撤销、取回编辑。Enter 排队、Ctrl/Cmd+Enter 与发送菜单引导；独立停止图标。
- 停止/失败后只恢复未消费文字，追加到既有草稿。回执丢失保留发送标识，查询而不自动重发。草稿版本保护相同文字重新编辑。
- 原生压缩、重试与截断工具输出同 run 续跑均保持队列。HTTP 环境复用 random-uuid helper。

## 验证结果

在 `experiments/harness-lab`：

- `npm test -- tests/pi tests/server.test.ts tests/seat-api.test.ts tests/web tests/random-uuid.test.ts`：30 文件、335 项通过。
- `npm run typecheck`、`npm run lint`（含 Pi/browser dependency boundaries）：通过。
- `npm run build`：通过；Vite 保留既有的大 chunk 提醒。
- `AXON_E2E_PORT=5294 npm run test:e2e -- message-queue.spec.ts chat.spec.ts --workers=3`：当时 49 项通过（46 项既有聊天 + 3 项新 Queue）。
- `AXON_E2E_PORT=5294 npm run test:e2e -- references.spec.ts message-queue.spec.ts --workers=3`：14 项通过（11 项引用输入 + 3 项 Queue 复验）。
- `AXON_E2E_PORT=5294 npm run test:e2e -- chat.spec.ts -g 追加消息消费事件`：新增 SSE 分段 1 项通过。
- 去重统计：61 项浏览器测试通过。最后的改动后 typecheck 与 lint 再次通过。

浏览器使用独立 5294 端口，避免复用另一个工作区已占用的默认 5187 服务。测试使用真实 PiLab/API 和假 provider；没有调用线上模型或将模拟结果声称为线上验收。

## 审阅及修复

独立 trellis-check 审阅见 review.md。已修复 length + tool calls 原生同 run 延续、HTTP UUID、晚回执误清同文草稿、同 host request 回复分段。

引用输入旧测试原先允许执行中更改 Skill；现根据已批准“运行中只追加纯文字、暂不改变引用”行为，断言忙碌按钮禁用、文字继续可编辑、失败收敛后可显式修改并恢复原始选择。

## 范围与限制

原生队列和回执属于当前进程，不保证服务重启后的待发送恢复。多人管理、附件追加、后台作业消息注入不在本期。线上与 Git 尚未更新。
