# C 轮修复：源码核对记录

核对日期：2026-11-12。Axon 基线：`feat/chat-rendering-c` 的 `2a08ea8`；DSH 固定参考：`e8f7b93a344964de3dca1ace9e72b6e4d6de87cb`。通过 GitHub 连接器读取官方仓库源码；未安装或执行外部代码。本记录是证据，不是实施授权。

## DSH 已核实行为

| 官方源码 | 已核实事实 |
| --- | --- |
| [QuestionComposer.tsx](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/client/ui-user-questions/src/client/QuestionComposer.tsx#L104-L136) | `AnswerField` 使用一行起始、自动增高的 textarea；有 inline 和无选项题目的 block 两种呈现。行内回答不是新增一块独立表单。 |
| [选择与继续](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/client/ui-user-questions/src/client/QuestionComposer.tsx#L357-L460) | `choose` 在非末题单选后推进；多选不自动推进。Enter 触发继续，Shift+Enter 和输入法组合事件除外。`completed` 表示有答案或明确 skipped；提交会检查整组。末题跳过会调用整组提交，因此“末题跳过后仍明确点击提交”是本方案有意的适配。 |
| [分页和底部按钮](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/client/ui-user-questions/src/client/QuestionComposer.tsx#L684-L721) | 底部先渲染左右箭头和题号，再渲染跳过、继续按钮；主按钮按是否末题显示 Next 或 Submit。不是在任何页面都只要整组完成就显示提交，也不是当前题一选就自动提交。 |
| [QuestionReplyView.tsx](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/client/ui-user-questions/src/client/QuestionReplyView.tsx)、[样式](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/client/ui-user-questions/src/client/QuestionReplyView.module.css) | 已答内容使用右侧单一用户气泡，内含逐题问题与答案，缺答案显示跳过；未选选项不铺开。源码明确完整显示问答，没有默认整组折叠。气泡宽度受限，题间间距为 12px，不是每个答案各套一个大框。 |
| [ApprovalCard.tsx](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/client/ui-approval/src/client/ApprovalCard.tsx) | 卡片含等待状态、具体操作、说明及详情，底部拒绝/允许；卡片本体没有整次请求的停止按钮。这不证明其他界面位置没有停止入口。Axon 卡片期间不提供停止入口以本次用户明确要求为依据。 |
| [聊天过程规则](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/client/ui-chat/src/client/conversation-nodes/README.md) | 默认 All replies 保留公开回复；过程和正文分开组织。不同模式、完成折叠及手动展开另有规则，不应从一张截图推断全局行为。Axon 本次保留 A 轮已有规则，不新增模式或内部推理展示。 |

用户提供的 DSH 实机截图是“提问 · 等待回答”轻量状态行的直接视觉依据；上述提问组件负责输入区，不能仅凭它推断聊天列表占位行的源码实现。

## Axon 已核实差距

| 本地文件 | 现状及修复边界 |
| --- | --- |
| `experiments/harness-lab/src/web/InteractionCard.tsx` | 自定义选项后另渲染 label + 三行 textarea；选择仅改草稿，不翻页。底部始终有提交按钮；skip 请求针对整组。待处理消息是两行大卡片，已答记录铺开所有长题目和答案，并逐题放选项展开入口。 |
| `experiments/harness-lab/src/web/main.tsx` | 当前卡占用输入区后，仍在卡片下方独立渲染 `composerControl`，形成截图中的圆形停止按钮。停止仍调用现有请求取消机制，不能用拒绝当前确认代替。 |
| `experiments/harness-lab/src/contracts/interactions.ts`、`experiments/harness-lab/src/pi/interactions.ts` | 每题回答目前是选项或文本二选一；`action: skip` 跳过整组，回答提交要求所有题目都有有效答案。逐题跳过需明确扩展回答记录及校验、工具返回和历史读取，不能只改按钮文案或提交空答案。旧记录继续按旧含义读取。 |
| `c-round-review.md`、`prd.md` | 原批准范围要求保留停止能力、历史可查、草稿及不确定结果恢复。本次用户明确调整为提问和确认卡期间不提供停止入口；普通运行的停止仍保留。逐题跳过及新的呈现规则按修复方案审阅后同步，旧方案不覆盖本次指示。 |

## 采用与保留

借鉴行内输入、分页位置、单选翻页、紧凑问答气泡及卡片对应的轻量状态记录；完成后才显示提交、末题不自动提交是明确提出的本地调整。v0.2 已取消标题栏停止建议和额外的多题或 4 行默认折叠规则。

按最新用户反馈，v0.3 将范围收回提问卡、确认卡及其对应的聊天状态和结果记录；不再调整完整聊天列表。A 轮已有正文排版、普通消息、通用过程行和整体折叠规则保留，ABC 完成后再统一评估前端效果。DSH 的推荐项预选、多选与自定义混合回答、关闭重开、计时提问、持久授权及插件体系均不随本次修复引入。

仅新增规划资料；未修改产品代码，未运行修复后的测试、未提交 Git、未更新服务。实施前需按获批方案补齐对应测试，并保留 C 轮独立复核已修复的顺序、执行证据、焦点及输入高度行为。
