# 流式回答期间用户引用缺失修复

日期：2026-11-13。用户已明确要求在 `feat/chat-rendering-c` 修复并提交 Git；不新建任务，沿用本分支记录。

## 问题与验收

发送后的临时用户消息只有正文；服务端终态快照才补上 selections / attachments。回答进行中，已加载的 Skill、Agents、地图引用和文件引用应显示在所属用户气泡，并在后续增量、轮询和会话切换后保留。完成和刷新后仍与实际历史一致；普通续聊不继承上轮引用；非法引用在准备阶段失败时不能出现成功加载事件。

## 最小设计与边界

- 复用 `resources.loaded`，增加可选 `selections: LoadedComposerSelection` 和 `attachments: FileRef[]`，只传宿主已经解析、校验的本轮输入。事件在首个模型调用前发送。
- `useChat` 在既有 sessionId / requestId / token / terminal 保护下，将字段合并到 `sending-user` 对应的闭包 messages 中，使后续 text.delta 不覆盖补齐的字段。
- 终态快照继续作为历史依据；轮询不整体覆盖流式 messages。
- 产品改动仅涉及公共事件契约、Pi 既有事件生产位置及前端接收位置。无需新增状态源、持久记录、模型提示词或消息执行机制；不改 C 轮卡片及布局。

## 验证计划

- Pi 实际会话：事件输入与终态用户消息一致，发送发生在模型调用前。
- 地图引用：事件携带真实加载查询，非法引用不发加载成功事件。
- 桌面浏览器：回答进行中可见 Skill / Agents / 地图与文件引用；后续增量、轮询、切换、完成及刷新保持一致；其他请求或会话事件被忽略。
- typecheck、lint、build、受影响单元/集成和聊天、引用、文件、恢复、交互、队列浏览器回归。

## 验证结果

- 修复前新增 Pi 用例因 resources.loaded 缺少 selections 失败；桌面浏览器用例因回答中找不到 Skill 按钮失败，确认复现目标问题。
- 修复后 `npm run typecheck`、`npm run lint`、`npm run build`、`git diff --check` 通过。lint 保留未修改的 InteractionCard.tsx 两条既有 Hooks 警告；build 保留既有大 chunk 提示。
- `npm test -- tests/pi/composer-input.test.ts tests/context-composer-map.test.ts`：2 文件、32 项通过。
- `npm test -- tests/pi/lab.test.ts tests/pi/subagent.test.ts tests/pi/recovery.test.ts tests/pi/annotations.test.ts tests/files/history.test.ts tests/server.test.ts tests/pi/file-integration-review.test.ts tests/web/process-groups.test.ts`：8 文件、137 项通过。
- `npm run test:e2e -- tests/e2e/chat.spec.ts tests/e2e/references.spec.ts tests/e2e/files.spec.ts tests/e2e/recovery.spec.ts tests/e2e/hitl.spec.ts tests/e2e/message-queue.spec.ts --workers=3`：126 项通过。
- 已查看 streaming-input-references.png：停止按钮仍显示时，用户气泡已有 Skill、Agents、H05 地图证据版本入口和文件引用。仅本地确定性验证，未部署或推送远端。
