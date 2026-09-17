# Pi Subagent 能力与接入依据

核对日期：2026-09-17。基线：项目已安装并锁定的 `@earendil-works/pi-coding-agent@0.85.1`。本文是源码与文档研究，不是实现验证结果。

## 1. 官方能力

| 依据 | 核对结果 |
| --- | --- |
| [Pi README](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/README.md) | Subagent 属于扩展能力，不是默认内置的调度服务 |
| [官方 Subagent 示例](https://github.com/earendil-works/pi/tree/v0.85.1/packages/coding-agent/examples/extensions/subagent) | 提供 single／parallel／chain；每个子 Agent 为独立 CLI 进程，JSON 事件输出，取消传播到进程 |
| [示例实现](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/examples/extensions/subagent/index.ts) | `subagent` 工具显式传 task；使用 `--mode json -p --no-session`；最终助手正文作为工具结果，完整执行信息放 details；onUpdate 返回进度 |
| [角色发现](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/examples/extensions/subagent/agents.ts) | Markdown frontmatter 定义 name、description、tools、model；会扫描用户／项目目录；本项目只加载指定工程目录的角色文件 |
| [SDK 文档](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/sdk.md) | 支持嵌入 AgentSession、customTools、SessionManager、资源加载、事件、abort 和 dispose，可由宿主组织独立子会话 |

官方示例 parallel 最多 8 项、同时执行 4 项，这是示例并发策略，不是 Pi 内核的工具调用次数限制。single 没有同样的任务数上限；本期不照搬这些数字。

未在角色文件指定模型时，示例继承调用方模型和 thinking。示例 reviewer 本身是代码审查角色，声明了 bash 和特定模型；“只读”包含提示词约定。本项目的资料检查角色需要自己的说明，并从实际工具注册中去掉写入及 Shell，不能直接复制示例文件后宣称权限隔离。

## 2. 本期接入选择

| 项目 | 选择与理由 |
| --- | --- |
| 执行方式 | 同服务进程内新建独立 AgentSession；复用现有模型和资源接入，避免额外 CLI 配置及 JSON 进程桥接 |
| 执行循环 | Pi 管理模型与工具循环；不实现宿主 while 循环，也不通过反复 prompt 模拟子步骤 |
| 单层委派 | 官方 single 参数形状；父工具串行、子不注册 subagent；并行／chain 后置 |
| 多角色 | 复用角色文件形式和公开 parseFrontmatter，加载名称／职责供主选择，按配置创建子会话；预置 analyst 与 reviewer，可通过文件扩展 |
| 配置生效 | 角色正文和工具集合在父请求内固定，下一请求重载；本期继承父模型，网页角色编辑及独立模型配置后置 |
| 子历史 | 使用 SessionManager 持久文件，方便 Web 重启后查已完成记录；这是相对示例 `--no-session` 的项目选择 |
| 指令与资源 | 继承父请求已固定的工作区资源；不使用示例的 cwd／用户目录发现；子 instructions_read 读取已加载快照 |
| 取消与清理 | 使用公开 abort／dispose，外层协调父子完成；不修改内核取消机制 |
| 用户界面 | 使用公开事件与工具 onUpdate，投影为网页子任务卡；不用 TUI 渲染器 |

SDK 独立会话提供上下文隔离，不提供进程故障隔离。选择它基于当前固定只读工具及单进程架构；后续引入不可信执行时需要独立评估进程／容器边界。

## 3. 已核对的本地接入点

下列路径均相对仓库根目录：

- `experiments/harness-lab/node_modules/@earendil-works/pi-coding-agent/docs/sdk.md`：customTools／defineTool、noTools、SessionManager 与生命周期。
- 同包 `dist/core/session-manager.d.ts`：`SessionManager.create(cwd, sessionDir, options)`、`getSessionId`、`getSessionFile`、`appendCustomEntry`；无需自行编写 JSONL 消息格式。
- 同包 `examples/extensions/subagent/index.ts`：显式 task、继承模型、onUpdate、最终正文回传与进程停止。
- `experiments/harness-lab/src/pi/lab.ts`：现有请求占位、资源快照、createAgentSession、工具串行、beforeToolCall、完整 abort、原生历史和恢复提示。
- `experiments/harness-lab/src/pi/controlled-stream.ts`：模型／摘要用途、空闲计时、错误清洗和 usage；可复用，但调用上下文必须父子分开。
- `experiments/harness-lab/src/pi/resource-tools.ts`：现有五个资源工具；需要按角色明确注册子只读集合，禁止默认退回全量工具。
- `experiments/harness-lab/src/pi/history-evidence.ts`：现有 berserk custom entry 严格校验；新增记录和子只读元数据需显式扩展，不能套用可写请求记录。

Pi 工具返回 details 可以承载结构化状态，但不要假定 execute resolve 就代表业务成功。已安装的 pi-agent-core `agent-loop.js` 在 execute 正常返回后初始设置 `isError: false`，公开 `afterToolCall` 可以调整该标记；实施时应针对 subagent 的失败 details 映射错误标记，并验证父模型实际收到的工具消息。不能仅模仿示例对象中的 `isError` 字段而不测试结果。

## 4. 实施前的最小验证

使用现有确定性模型替身与真实 Pi SDK 验证：根据目录选择不同角色，子提示词及工具集合按配置生效；父工具内创建子会话可正常完成；失败状态及 onUpdate 能穿透现有接入；子模型／工具／压缩／重试期间取消能够收敛；子原生文件保存及父关联缺口可识别。完成这些验证后再接 Web，不以接口存在替代行为证据。

网页采用现有工具消息样式，交互参考本项目 frontend spec 与 ui-ux-pro-max 的键盘导航、状态文字、渐进展开和不移动焦点原则；不复制官方示例的终端界面，也不增加诊断入口。
