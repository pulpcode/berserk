# 输入建议交互对照：输入后隐藏还是前缀续显

调研日期：2026-11-16。由用户观察 Codex 在输入匹配前缀后仍隐藏灰字引出。调研时只核对交互，未启动实现。用户随后明确选择按本次样本的常见做法修改方案，当前 PRD R4 已改为空框展示、输入隐藏、删空恢复；仍处于待审阅阶段。

## 结论与证据边界

本次核对的 Claude Code 官方说明、Kimi Code 官方开源实现，以及两个 Pi、两个 DSH 和一个 OpenCode 第三方扩展，都采用空输入时展示整条候选、开始编辑后隐藏或撤下的交互。未在这些具体实现中发现“手工输入仍匹配候选前缀时继续显示剩余后缀”的路径。这个结论只覆盖本次样本，不代表所有 Agent 或所有版本。

Codex 的官方 Composer Predictions 页面说明回复后展示候选、Tab 接受为可编辑草稿、自行输入另一条消息；未明确说明匹配前缀时如何处理，不能仅凭文档断定所有版本行为。用户本机观察是输入后隐藏；本轮未执行本机 UI 实测。

## 对照

| 实现与身份 | 开始输入且前缀匹配时 | 清空输入后 | 采纳方式 | 一手证据 |
| --- | --- | --- | --- | --- |
| Claude Code CLI，官方文档 | 开始输入即隐藏，没有声明前缀匹配例外 | 本页未明确说明 | Tab / 右箭头填入，另按 Enter 发送 | [Interactive mode / Prompt suggestions](https://code.claude.com/docs/en/interactive-mode#prompt-suggestions)，本次页面 397–401 行。 |
| Kimi Code，官方开源 | `handleEditorChange` 取消在途请求并 `dismiss('input')`，不比较输入内容 | 候选已清除，该 handler 不恢复它 | Tab / 右箭头，引用补全优先 | [controller](https://github.com/MoonshotAI/kimi-code/blob/main/apps/kimi-code/src/tui/controllers/prompt-prediction.ts#L93)，111–117、208–212 行。blob `88d259ae3abd6f8126a11c1f0219eb824c6e1087`。 |
| Pi `gamaraan/next-prompt-extension`，第三方 | 展示和采纳均要求输入为空；非采纳键撤下候选并取消在途请求 | 真正“非空→空”后延时恢复缓存候选，不重新请求模型；Escape/箭头等有单独撤下规则 | 默认 Alt+/，避免占用 Tab 补全 | [源码](https://github.com/gamaraan/next-prompt-extension/blob/main/next-prompt.ts#L1817)，1817–1850、1902–1953、1995–2039 行。blob `060e9916d0ea6daaf03a82e8125edd5f5fc14591`。 |
| Pi `justmytwospence/pi-next-prompt`，第三方 | 编辑器非空就隐藏灰字，不做候选前缀判断 | 清空即重新展示 offered 候选，无新模型调用 | 默认 Tab / 右箭头 | [源码](https://github.com/justmytwospence/pi-next-prompt/blob/main/src/index.ts#L224)，174–189、224–239 行。blob `b6ee9c58542e871c9d56c10f3f300af1ac714d37`。 |
| DSH `yepyeel/dsh-prompt-suggestion`，第三方 | `beforeinput`、`input` 和 compositionstart 撤下；控制器 blank=false 时同样 dismiss，不做前缀比较 | 本次候选/cache 已消费，单纯清空不自动恢复；插件另有手动生成入口 | Tab / 右箭头；Esc 忽略 | [控制器](https://github.com/yepyeel/dsh-prompt-suggestion/blob/main/src/client/ghost/controller.ts#L153)，103–110、153–157、225–256 行，blob `44400cb21ef63f11330ac1ea3350fc1311ff7849`；[DOM 事件](https://github.com/yepyeel/dsh-prompt-suggestion/blob/main/src/client/dsh/composer.ts#L168)，173–176 行，blob `077c6e01c0a904cd14b6bc4b02c4a209629ae70c`。 |
| DSH `studyzy/dsh-suggest-prompt`，第三方 | `draft.trim() !== ''` 就不展示；只有空白仍算空，没有后缀裁切 | 恢复原候选，有专门测试 | 默认 Tab，填入草稿 | [GhostSuggestion](https://github.com/studyzy/dsh-suggest-prompt/blob/main/src/browser/GhostSuggestion.tsx#L117)，117–125、160–167 行，blob `b64c14b7b37d5f93dde3139532b6a4816f78280b`；[清空恢复测试](https://github.com/studyzy/dsh-suggest-prompt/blob/main/tests/ghost.client.spec.tsx#L190)，blob `065d5eef1d59c5d49b44497cc3d6d666ee0f7d96`。 |
| OpenCode `lenitain/opencode-next-prompt`，第三方 TUI 插件 | 使用输入框 placeholder 展示；有输入就隐藏，采纳也只对空输入生效 | 恢复原候选；即使已经采纳后又删空也能恢复 | 默认右箭头，可配置 | [README](https://github.com/lenitain/opencode-next-prompt/blob/main/README.md#L25)，25–29 行，blob `f0ad0b9fe3064a85f13ee7e357edfc2f3ca456f1`；[采纳源码](https://github.com/lenitain/opencode-next-prompt/blob/main/src/index.ts#L186)，186–193、220–224 行，blob `5f366da84e4f546cc94627d2c998d501aae4d2f7`。 |

所有 blob SHA 是读取文件的内容标识，不冒充仓库 commit。主分支链接会随上游变化。以上判断来自文档和代码，未声称在各 Agent 中实际运行测试。

## Codex 官方说明

[Composer Predictions](https://learn.chatgpt.com/docs/features/composer-predictions#tab-to-accept) 的 1007–1012 行规定 Tab 把建议变成草稿，用户检查、修改后发送；也可以直接开始输入自己的消息。页面没有明确描述前缀匹配、输入后删空是否恢复，不能补写成官方承诺。当前公开 Codex CLI 和 desktop 也不能混为同一 UI 实现。

## 对本项目方案的含义

这是两个独立决策：

1. **如何生成**：主回复完成后独立请求生成一次，用户已经选择该路线。
2. **输入后怎么展示**：空框整条建议，或与手工前缀一致时续显剩余后缀。独立请求路线本身不决定此项，也不需要为了保留后缀逐字请求模型。

按本次样本对齐的首版建议是：空输入显示整条候选；开始输入就隐藏；Tab/点击整条填入后编辑并另行发送。可采用 Pi-next/OpenCode 的轻量变体：保留同轮候选，删除到空后恢复，不再次请求。新轮次、会话切换、关闭开关和明确 Esc 拒绝仍使候选失效。

这项推荐是基于样本的产品判断，不是上游作者陈述的共同设计动机。其好处是状态和操作更容易解释，降低中文组词、光标移动和镜像后缀对齐的复杂度；代价是用户开始打字后不能再直接补齐原建议的剩余部分。前缀续显依然可实现，但属于用户提出的增强交互，需要保留原计划中的专门验收。

本地通用 UX 规范搜索未命中“对话下一步建议”专用条目，不把普通搜索框 autocomplete 或移动端手势建议当作本次结论的证据。用户采纳上述交互方向后，PRD/设计/实施清单已同步修订；前缀续显移出首版，未编写产品代码。
