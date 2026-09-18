# Pi 人工交互能力核对

核对日期：2026-09-18。代码基线：`93c511a`，已安装 Pi **0.85.1**。依据为依赖源码、同版本官方文档与现有 Axon 代码；本阶段接入探针尚未执行。

## 原生能力与 Axon 分工

| 能力 | Pi 已提供 | 本期接法 |
| --- | --- | --- |
| AskUser | question／questionnaire 是官方扩展示例，通过注册工具、等待用户输入、返回工具结果继续循环 | 固定扩展注册 ask_user，复用该模式；使用 Axon 网页桥接替代终端组件 |
| 扩展加载 | SDK 的 DefaultResourceLoader 支持 extensionFactories；固定工厂独立于自动发现加载 | 保持 noExtensions=true，不加载用户目录／上传文件里的扩展；显式启用主 Agent 工具列表中的 ask_user |
| 执行前拦截 | Agent 公开 beforeToolCall 支持异步等待与阻止，位于工具参数校验后、实际执行前 | 组合 Pi 已有钩子与停止检查，交由服务端规则决定允许／询问／禁止 |
| 原生交互 UI | 扩展有 ctx.ui.confirm／select／custom；RPC 有 extension_ui_request／response | 当前 SDK 应用使用固定网页桥接，不引入 RPC 或实现完整终端 UI 接口 |
| 等待与停止 | 异步工具／钩子可等待；取消信号和原循环处理后续 | Axon 保存问题、答案、决定并关联请求，处理刷新、迟到响应与停止 |

question 示例明确要求 TUI，questionnaire 使用终端自定义组件，并非安装后就有 Web 卡片。Axon 需要实现网页呈现、回传和历史；多选及每批 1～4 题是本项目选择，不能称为 Pi 内核自带规则。AskUser 回答是普通工具结果，操作授权则由宿主规则单独管理。

源码显示 noExtensions 关闭自动发现，而 extensionFactories 仍经 loadExtensionFactories 装载；使用显式工具清单时必须加入扩展工具名。P1 要验证这条完整链路及装载错误处理。扩展运行于宿主进程，属于受信任程序；文件处理脚本继续运行于 Docker，不因上传而成为插件。

Pi 的扩展机制可供开发者编写模块；CLI 的重新加载能力不等于 Axon 已有插件市场、网页安装或活动请求无缝热切换，这些均不在本期。

## 当前代码约束

路径相对 `experiments/harness-lab/`：

| 位置 | 本期注意事项 |
| --- | --- |
| src/pi/lab.ts：openSession | 现有 createAgentSession、关闭自动发现、串行工具及停止钩子；添加固定扩展时保留这些约束，并组合 Pi 原有 beforeToolCall |
| src/pi/lab.ts：stop／execute | 等待复用 Active.controller；不能在同一 Pi 事件管线内部等待 session.abort 完成 |
| src/pi/file-tools.ts | bash 使用固定 /workspace 和 RequestSandbox；批准必须绑定实际原命令，继续沿用容器 operations |
| src/server/app.ts：messages／cancel | SSE 断线不停止请求，GET 可恢复活动状态；回答／决定使用独立 POST，不重发聊天消息 |
| src/pi/history-evidence.ts | custom entry 严格白名单；新增 interaction 记录需同时补齐读取与校验 |
| src/web/useChat.ts、WorkspaceNavigation.tsx | 复用会话归属、草稿、需关注和未读规则；待回答／待确认使用独立 phase |

Pi 在工具准备阶段会把钩子异常转成工具错误，仅抛异常不能保证整轮结束；规则或持久化故障必须触发现有宿主终止通路，并由 P1／F10／F16 验证不再发起后续调用。

Pi 的 tool_execution_start 早于 beforeToolCall，不证明工具已实际执行。拒绝后的原生阻止结果按交互记录显示为用户拒绝，真正的工具错误仍保留错误含义。Pi 默认策略和 permission-gate 示例不能替代本项目的命令规则，更不提供业务主体授权或跨重启恢复。

## 官方依据

- [question 示例](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/examples/extensions/question.ts)、[questionnaire 示例](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/examples/extensions/questionnaire.ts)：工具参数、终端交互与答案回传模式。
- [permission-gate 示例](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/examples/extensions/permission-gate.ts)：执行前等待决定；本项目不复制其简单命令正则。
- [SDK 文档](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/sdk.md)、[资源加载源码](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/resource-loader.ts)：固定工厂、自动发现与工具启用。
- [Agent 文档](https://github.com/earendil-works/pi/blob/v0.85.1/packages/agent/README.md)、[扩展文档](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md)：钩子、事件、取消与扩展 UI。

本地依赖位于 `node_modules/@earendil-works/pi-coding-agent/`，重点复核 `dist/core/agent-session.js`、`dist/core/resource-loader.js`、`examples/extensions/` 与 `docs/`。升级 Pi 后重新验证 P1。

会话内卡片和两个等待状态是 Axon 多会话产品选择，Pi 没有规定 Web 布局。UI/UX 核对仅用于明确按钮语义、保留草稿、错误恢复、焦点和窄屏体验。
