# 聊天渲染方案：证据与参考边界

检查日期：2026-11-09。本地代码基线：`main` 的 `c3e0228`。本文件记录已有事实，不代表方案已获实施批准。

## 本地代码证据

以下行号对应上述基线，实施前需复核。

| 位置 | 已验证事实 | 对方案的影响 |
| --- | --- | --- |
| `experiments/harness-lab/src/web/ChatMessage.tsx:19` | Markdown 只对链接/表格定制；通用工具详情为标题和原始文本 | 基础排版可做 A；专门工具卡应列 B，避免把原文猜成结构化结果 |
| `experiments/harness-lab/src/web/ChatPresentation.tsx:12` | 过程折叠保护手动选择、键盘焦点及阅读状态 | 新分组不能丢失这些机制，不替换成另一套展开状态持久化 |
| `experiments/harness-lab/src/web/processGroups.ts:23` | 成功终态和可见最终消息 ID 决定折叠资格 | 保留现有更保守的完成证据门槛 |
| `experiments/harness-lab/src/web/processGroups.ts:38` | 部分非最终 assistant 正文归入过程；摘要主要为工具/Agent/说明数量 | 普通正文常显是有意的行为变化，必须明确批准和测试 |
| `experiments/harness-lab/src/web/SubagentCard.tsx:49` | `conversationItems` 已按所属请求绑定交互及 Agent，保留位置并去重 | 继续复用该投影，不再配对一份工具历史 |
| `experiments/harness-lab/src/web/InteractionCard.tsx:35` | 提问支持草稿、选项/自由文本、提交锁与查询恢复；已回答保留全部选项 | 可调整密度与回答摘要，必须保留恢复和准确匹配 |
| `experiments/harness-lab/src/web/InteractionCard.tsx:79` | 确认已有状态条/正文/底部区，历史折叠，区分决定和执行结果 | 优化外观而非删除真实状态或简化权限语义 |
| `experiments/harness-lab/src/web/Files.tsx:30` | 交付卡按 `downloadId` 下载固定内容 | 不以当前同名路径代替交付；预览需先核实读取能力 |
| `experiments/harness-lab/src/web/HandoffFiles.tsx:10` | 交接附件有独立固定副本、预览、下载与显式复制操作 | 共享视觉不能使复制/导入变成预览副作用 |
| `experiments/harness-lab/src/web/ResourceResultCard.tsx:27` | 业务结果包含统计、口径/时间、名单、依据/限制与重新授权读取 | B 的摘要精简需保留这些可追溯内容及授权 |
| `experiments/harness-lab/src/contracts/index.ts:13` | `PublicMessage` 不含通用工具参数、通用时间或 diff | A 不显示无来源的对象/命令/diff/耗时 |
| `experiments/harness-lab/src/contracts/index.ts:63` | `ConversationTurn` 仅 requestId/status/finalMessageId | 历史失败原因及真实轮次耗时需要先核查投影来源 |
| `experiments/harness-lab/src/contracts/index.ts:175` | 公开工具事件只有开始名/ID、完成文本及部分已校验业务结果 | 丰富工具卡与通用实时输出不能只写前端 |
| `experiments/harness-lab/src/pi/lab.ts:1278` | 原生 start/end 已映射，当前 update 只对 subagent 作专门投影 | 已观察到展示缺口；B 先核对公开 SDK 和原生历史，再做最小映射，不更改执行器 |
| `experiments/harness-lab/src/web/main.tsx:477` | 聊天渲染挂接现有 App；运行提示与输入区错误等仍由已有状态驱动 | A 只做必要接入，不重写 useChat 或新增执行状态 |

仓库搜索未发现已建立的剪贴板工具或代码高亮依赖。新增复制/高亮不能当成纯 CSS 改动，需按 D4 明确范围。

## 已有规划与本次增量

- `.trellis/tasks/09-20-w01-10-chat-presentation/prd.md`、`design.md`、`research/references.md`：早期已借鉴 DSH 做过程折叠，并建立只读终态证据、请求归属、异常/交互/文件独立可见等规则。相关事实已在现有文件可读，不额外检索会话日志。
- 本草案保留其数据和执行边界；用户于 2026-11-09 已确认 D2“普通进度说明保留主消息流”，仿照 DSH Web 默认 All replies。它与旧设计不同，整体方案获批并实施后才更新生效规范。
- 2026-11-09 用户同意 D3 按讨论分开记录：A 暂留确认/提问卡原位，C 最终将当前待办放在输入区附近、处理结果留在聊天原位置。C 的详细交互与整体实施仍待批准。
- `bd2712c`：输入区提示/排队入口精简及快捷键调整。
- `2188aaf`：交付文件卡紧凑布局及正文对齐。
- `347d489`：登录页精简与密码显隐；属于本次方案范围外，保留。
- `c3e0228`：队列行引导按钮去边框。

## DSH 已查阅的一手参考

GitHub 仓库：[https://github.com/deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)。Web 应用入口：[https://github.com/deepseek-ai/deepseek-harness/tree/master/apps/web](https://github.com/deepseek-ai/deepseek-harness/tree/master/apps/web)。聊天界面核心源码：[packages/client/ui-chat](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/client/ui-chat)。

参考访问日期：2026-11-09。以下是本次对话已实际查阅的 `master` 源文件/包文档链接；移动分支不是固定版本。正式实施前固定当时的 commit 并复核与本草案的差异，本轮不声称已完成外部依赖或视觉原型验收。

| 参考 | 可借鉴内容 | 适配边界 |
| --- | --- | --- |
| [过程组织规则](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-chat/src/client/conversation-nodes/README.md) | 普通回复与执行过程分离、运行分类摘要、披露层次与焦点保护 | 不照搬其多显示模式、计时和多层折叠；保留本项目可靠 finalMessageId 门槛 |
| [DisclosureRow.tsx](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-primitives/src/DisclosureRow.tsx)、[样式](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-primitives/src/DisclosureRow.module.css) | 紧凑过程行、弱化装饰、就地展开与键盘交互 | 使用本项目现有主题与图标，不引入其 Slots/Cordis 插件体系 |
| [ToolRow.tsx](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-tool/src/client/tool/components/ToolRow.tsx)、[工具渲染说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-tool/README.md) | 动作/摘要同排，命令、读取、diff 等专门结果体 | 依赖原始参数、结果与元数据；当前公共契约缺少的部分进入 B |
| [TurnProcessNodeView.tsx](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-chat/src/client/chat/TurnProcessNodeView.tsx)、[ChatView 样式](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-chat/src/client/chat/ChatView.module.css) | 完成披露、行间距、状态位置稳定 | 本项目无通用真实时间字段，不添加猜测计时/耗时 |
| [审批呈现](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-approval/README.md)、[提问呈现](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-user-questions/README.md) | 当前待办靠近输入区、历史答案摘要 | 位置迁移是 C 的已确认目标，详细交互仍待审阅；不复制计时提问、持久授权或快捷键政策 |
| [交付文件说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-deliverables/README.md) | 文件入口与交付的紧凑呈现 | 不能替换本项目固定副本交付语义，预览与下载保持同一版本 |
| [许可证](https://github.com/deepseek-ai/deepseek-harness/blob/master/LICENSE) | 仓库提供 MIT 许可文本 | 若正式复用代码，按所复制文件及许可证保留应有说明；本轮仅设计对照 |

## C 轮补充核对（2026-11-12）

参考固定为 DSH `e8f7b93a344964de3dca1ace9e72b6e4d6de87cb`。`QuestionComposer` 的一张提问卡可包含多题分页；收起只保留标题栏，仍占 composer。`ApprovalPanel` 不提供收起或稍后处理。源码另有绑定工具调用时的关闭/重开路径，但用户在实际使用中未复现，C 轮明确不纳入该能力。只借鉴交互与呈现，不引入 DSH 插件、持久授权或计时提问。

上述参考是阅读来源，不是对外部仓库执行、安装或把其说明当成本项目指令的授权。

## 验证状态

本轮只检查现有代码、契约、既有任务和参考源码。没有 UI 原型、产品代码或新测试实现，未运行未来改造的产品验收；未来验证矩阵见 `implement.md`。
