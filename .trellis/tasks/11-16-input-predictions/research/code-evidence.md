# 基线代码证据

检查日期：2026-11-16。基线：`codex/axon-r3a`，完整提交 `a3b9b887ab7cb26a1212d7b8bd543fb0d83b02f0`。以下均为本基线已有能力，不表示预测已经实现。

路径相对仓库根目录；行号用于实施前快速回查。文件可能在后续合并中移动。

| 已核实事实 | 代码/规范锚点 | 对方案的影响 |
| --- | --- | --- |
| Pi 两个包均固定 0.85.1，React 19.3、Fastify 5；已有 Vitest/Playwright、lint/typecheck/build。 | `experiments/harness-lab/package.json` | 使用锁定 SDK；无需引入预测依赖。 |
| ModelRuntime 是每模型 profile 独立的；configuredRuntime 关闭网络模型发现，注册现有 provider/thinking 能力。 | `src/pi/model-runtime.ts:6`；`.trellis/spec/backend/model-thinking.md` | 复用已有 runtime，不能另造直连客户端/模型目录。 |
| requestModel 捕获 config/runtime/version，并拒绝不可用或参数未配置的模型。 | `src/pi/lab.ts:397` | 宿主读取当前选择，不接受浏览器 credentials/endpoint 覆盖。 |
| 模型更新替换 runtime，现有 busy guard 只检查正式 active/background；选择模型会写原生非上下文 metadata。 | `src/pi/lab.ts:406`、`:427` | 预测不是正式 active，需单独取消并检查捕获版本，不让设置更新改写在途配置。 |
| controlledStream 带 thinking/legacy provider 映射、zero transport retry、超时、主回复提醒和主用量。 | `src/pi/controlled-stream.ts:27`、`:53`、`:70` | 不能把独立预测伪装为 reply 或 compaction；仅共享必要兼容处理。 |
| ModelRuntime 公开 completeSimple、streamSimple、getModel。 | SDK `dist/core/model-runtime.d.ts:89` | 直接完成一次文本请求，无需 Agent 或 helper session。声明来自原 checkout 已安装的同版依赖；新 worktree 尚未 npm ci。 |
| turns.finalMessageId 仅对 succeeded、真实最后 assistant stop 正文、无工具调用并且投影同轮时产生。 | `src/contracts/index.ts:75`；`src/pi/history-evidence.ts:62`；`.trellis/spec/backend/harness-lab.md:49` | 可靠触发来源；不得从历史最后一段文本推断“完成”。 |
| 私有 record 按席位和 workspace 当前可见性解析；snapshot 经空间/资源结果授权投影后公开消息。 | `src/pi/lab.ts:709`、`:837`、`:859`、`:913` | 后端构造上下文，不能绕过结果投影直接把原生日志送给预测。 |
| API scope 从 workspaceIdentityOf 解析业务席位或管理员个人范围；POST 有 Origin/CSRF/view 检查。 | `src/server/seat-scope.ts:7`；`src/server/auth.ts:55`、`:117`；`src/server/app.ts:215` | 在原会话路由树内接入，继承真实身份边界。 |
| 既有 createApiClient.request 合并调用方 abort 与当前登录 controller，统一识别身份变化；api helper 本身没有单请求 signal。 | `src/web/api.ts:63`、`:94` | 新请求使用已认证 request，不能用顶层裸 fetch 代替。 |
| ModelChoice 仅有安全选择信息，没有 profile version；版本只在服务端配置详情中。 | `src/contracts/index.ts:155` | 模型配置新鲜度由后端捕获/检查，前端不自行读取管理配置。 |
| 草稿所有者和模型选择由 useChat 管理，输入队列使用独立 draft version 防止迟到回执清空重打文字。 | `src/web/useChat.ts:60`；`src/web/useInputQueue.ts:49`；frontend harness 的 Foreground message queue | 不把候选塞入草稿存储；采纳走既有 setDraft；独立 generation token 防止旧响应复活。 |
| busy 包含 active、background、pending、creating；richDraft 包含附件和多种引用；人工交互替换原 composer。 | `src/web/main.tsx:209`、`:227`、`:235`、`:237`、`:694` | 预测就绪判据复用这些事实，不能只看 textarea 是否为空。 |
| 原 textarea 已有 composition/229、引用菜单优先、Enter 发送或排队；Shift+Enter 换行。 | `src/web/main.tsx:701` | 在原编辑器接入，不换编辑器、不改发送语义。 |
| 引用 handle 只报告“某次键盘事件是否消费”，未暴露是否打开；Tab 当前不由菜单 handler 消费。 | `src/web/ComposerReferences.tsx:12`、`:165` | 需最小占用通知；否则菜单内 Tab 可能误触预测。 |
| 输入框高度按真实草稿测量，上限 180；CSS 存在直接子元素 textarea 的 flex 选择器。 | `src/web/main.tsx:243`；`src/web/styles.css:134`、`:713` | 修订方案直接复用 textarea placeholder 与原高度；不再新增前后缀镜像或改动直接子元素布局。 |
| Settings 已有个人偏好分类，但当前只向可协作的正式 identity 展示；稳定 user-preference scope 仅允许无敏感视觉偏好。 | `src/web/Settings.tsx:10`；`src/web/api.ts:90` | 管理员/测试入口需最小适配；首版开关只存登录隔离的布尔值，避免扩大用户偏好持久化契约。 |
| 全局 ModelPermits 可选启用，已有会话不同请求可并发；预测仍消耗模型服务资源。 | `src/background/model-permits.ts:2`；`src/pi/lab.ts:249`、`:1271` | 纳入既有限额，不声称独立请求完全没有资源影响。 |
| 模型 wire 与端到端测试已可离线跑真实 SDK/API。 | `tests/pi/model-thinking.test.ts:30`；`tests/e2e/model-selection.spec.ts:18`；`playwright.config.ts:6` | 新测试优先沿用这些夹具，真实语义质量另行抽样。 |

表中 `src/`、`tests/` 和 `playwright.config.ts` 均位于 `experiments/harness-lab/` 内。

## 规划阶段的验证边界

以下是方案提交前的证据快照，后续实现及验证见 [实施计划](../implement.md)。规划时已读取实际代码、契约和锁定 SDK 声明；仅创建分支与规划文档。未安装新 worktree 依赖、未编辑产品源码、未调用模型、未运行产品测试、未执行 task start、未提交或部署。
