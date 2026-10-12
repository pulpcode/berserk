# 实施清单（2026-10-12 已获授权）

## 0. 审阅与技术验证

- 用户审阅默认排队、截图式紧凑 Queue UI、纯文本首期、逐条 Steer/删除/取回、停止恢复草稿及恢复边界。
- 已收到明确实施指令，已执行 task.py start 并加载 trellis-before-dev。
- 实现临时/隔离的真实 Pi + 假模型技术测试：双队列时机、同文身份、临近结束、abort/clearQueue 竞态、压缩与重试。发现公共 SDK 无法支撑约定则报告并修订方案，不能扩大机制后自行实施。

## 1. 合同与 Pi 接入

- src/contracts：提交意图、接收回执、pending 投影与事件；沿用现有错误和 ID 风格。
- src/pi/lab.ts 及必要的小模块：前台纯文本接收、原生队列调用、公开 SDK 下逐条操作的原子性验证、消费关联、目标校验、去重、结束残留与取回。
- 保留 request-scoped snapshots/tools/sandbox；不制造新的业务 Task/Run 表。
- 先为后端行为加有意义的测试，再接 UI；不是测试某个字段存在，而是断言真正进入模型的消息和顺序。

## 2. API 与状态投影

- src/server/app.ts：intake-only POST、回执查询/快照及单条队列操作；复用权限和 CSRF。
- 原消息 POST SSE 增加用户消费事件；GET 可恢复当前运行投影。
- 拒绝非法状态、字段、跨席位输入、重复 ID 不同内容；校验失效与回执未知不可混同。

## 3. 简洁 UI

- src/web/useChat.ts：将普通启动和追加接收分开；不为追加创建第二条 SSE。稳定 submissionId、晚回执、非空草稿保留、按原 owner 恢复。
- src/web/main.tsx 与 styles.css：轻量文字行、发送菜单、独立停止、Enter 排队 / Shift+Enter 换行 / Ctrl或Cmd+Enter 补充、IME 与焦点；可抽取局部 Composer 组件但不做无关重构。
- pending native user 消费后插入正文；不把助手连续响应拼接成同一条，不提前声称已消费。
- 含附件/引用时保留草稿并清楚提示，空闲流程不变。

## 4. 验证

在 experiments/harness-lab 中运行：

```sh
npm run typecheck
npm run lint
npm test -- tests/pi/message-intake.test.ts tests/server.test.ts tests/web/api.test.ts
npm run build
```

实际新增 message-intake.test.ts、message-intake-lab.test.ts 和 tests/e2e/message-queue.spec.ts；扩充 server、seat-api、compaction、process-groups、chat 和 references 测试。Pi/HITL/recovery 现有回归纳入验证。完整命令与结果见 research/validation.md。

关键验收：同文两次/同提交重试；接收前结束/接收后结束；消费与停止竞态；回执丢失；单条 Steer/删除/取回与消费竞态；刷新/切换不重发；工具执行中的 Steer；纯文本与附件边界；人为确认不绕过；375px 与键盘、中文输入。

## 5. 审阅与发布

- trellis-check 全范围检查和代码审阅；补齐有证据的 spec 变更。
- 只有用户授权部署/提交后再开展；中文 Git 提交信息，Trellis 自动提交保持关闭。
- 发布前等待/排空运行中待发送，备份并验证线上基础会话 + 追加/停止；回退不向旧代码暴露活跃队列。

## 当前状态

产品实现与公开 SDK 技术验证已完成，独立审阅发现均已修复。工程验证结果见 research/validation.md。用户已于 2026-10-12 明确授权中文 Git 提交及线上发布；按当前服务停止、备份、更新和健康验证流程执行。
