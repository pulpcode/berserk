# 设计依据与边界

2026-10-15。基于本地 `efe2fb6`、Pi 0.85.1 及本会话已核对的源码快照。本文件记录证据，不将参考项目的实现直接当成本项目现状。

## 本地证据

路径以 `experiments/harness-lab/` 为根，行号为基线位置。

| 位置 | 已核对的事实 | 设计影响 |
| --- | --- | --- |
| `src/pi/annotation-tools.ts:64–85` | 统一 execute 将原服务结果 JSON 写入 content，details 空；错误带恢复字段 | 在这个边界投影；不改服务事务，不删恢复信息 |
| `src/annotations/service.ts:172–184` | 先 layer/object 筛选，再分页；total 是匹配集合数量；fields 决定业务字段；模型已能看到原调用参数 | 保留 total，query 仅回显原 objectIds/layerIds/fields；澄清通用语义，不增加全图查询或专用范围分类 |
| `src/annotations/service.ts:186–198`、`src/pi/composer-input.ts` | 显式标注引用有 hash，v4 将引用整体写入模型文本 | 新输入 v5 只改新模型表达；不能只改工具然后宣称所有新引用都不带 hash |
| `src/pi/annotation-state.ts` | draft/hash、来源修订、current 的原始状态独立维护；pending 在下次推理接受 | hash 留在宿主；模型投影不改变 CAS 或读取依据 |
| `src/pi/lab.ts:828–847` | hook 前快照模型 content，hook 后检查修改/错误并拒绝结果 | 投影以后仍检查实际送出的内容；details 不可绕过该保护 |
| `src/pi/lab.ts:587`、`:1134` | 历史及实时目前只投影工具文本，忽略标注 details | 两条路径均需接通，且共用解析验证 |
| `src/web/situation/evidence.ts:67` | 从真工具 JSON 回执提取固定 ref；校验 action/来源、去重，旧动作另标 | 复用既有规则，优先用新结构，保留旧历史回退 |
| `src/web/situation/MapContext.tsx:99` | 现有 EvidenceMapLinks 已提供程序按钮 | 不新建结果卡片，不要求模型拼 URL |
| `src/contracts/annotations.ts` | 固定 ref、原回执、读结果、compare 的领域结构已存在 | 业务 DTO 原契约不变，只加工具/Web 表示契约 |

上轮真实错误证据见 [语义审阅](../10-14-map-result-reporting/base-current-semantic-review.md)：B02 `b7c30b11`、P1 `9b6b9faa`、C02 `bb108172`、管理采用 `b28a97bd`。前者只查甲却推断整个版本不存在乙，后两条 hash 错误来自同一缩写的重复，采用成功但正文虚构了字段。

审阅后明确：现有地图按钮本来就由程序生成，hash 错误发生在助手正文。数据分离减少无必要转述机会，不能保证模型不编造；参数回显是重申已有调用范围，尚无证据证明它单独足以纠正模型理解。需保留原场景对照，并以不同图层、分页和字段案例检验泛化，不把一次成功当成因果证明。

两个通用 harness spec 超过单文件自动注入上限，因此不在 JSONL 中整篇注入；实施时按标题读取相关原文，不能把本研究当作完整替代：

- [后端 Harness Lab](../../spec/backend/harness-lab.md)：Public data and dependency boundary、Request resources and tools、Native compaction and persistence、Tests Required。
- [前端 Harness Lab](../../spec/frontend/harness-lab.md)：Workspaces, sessions and streams、Current resources versus historical evidence、Chat process presentation、Structured map result entries、Tests Required。

## Pi 原生能力

- 已安装 `@earendil-works/pi-coding-agent` 0.85.1 内的 `pi-agent-core/dist/types.d.ts:317`：AgentToolResult.content 用于模型，details 用于日志/界面。
- `node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js:1063–1087`：工具结果构建 provider 消息时从 toolMsg.content 取文字，未将 details 整体送入模型。
- `node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js:781`：原生 appendMessage 保存 message。宿主仍需验证重开、压缩、实时与历史的完整链路；不能仅凭 SDK 字段注释宣称本应用已支持该效果。
- 本项目 file_output 和 subagent 已用 content/details 分工，但标注尚未接通。因此本次优先使用 Pi 原生扩展点，不发明第二个回执系统。

## 已讨论的成熟实现对照

以下链接固定到此前核对的提交，不声称是各产品最新版本。本轮未再次拉取远程仓库。

| 参考 | 可借鉴的事实 | 本项目对应 |
| --- | --- | --- |
| [Claude Code 第三方源码快照：FileEditTool](https://github.com/pulpcode/claude-code/blob/4b9d30f7953273e567a18eb819f4eddd45fcc877/src/tools/FileEditTool/FileEditTool.ts#L560) 与 [UI](https://github.com/pulpcode/claude-code/blob/4b9d30f7953273e567a18eb819f4eddd45fcc877/src/tools/FileEditTool/UI.tsx#L77) | 工具可保留结构化编辑数据，用单独映射生成模型结果，界面渲染真实 patch | 原回执生成地图入口，模型不需要复述原始结构；这是用户提供的非官方快照，不据此保证当前 Claude 内部实现 |
| [Codex apply_patch 程序摘要](https://github.com/openai/codex/blob/7a08c5f6271e818d832eb9061dac935936e2b539/codex-rs/apply-patch/src/lib.rs#L826) 与 [工具事件](https://github.com/openai/codex/blob/7a08c5f6271e818d832eb9061dac935936e2b539/codex-rs/core/src/tools/events.rs#L599) | 工具生成文件变更摘要和结构化事件，界面不需要助手正文重建 diff | 界面可确定固定引用，正文仍负责业务解释；不能推断 Codex 从不向模型提供技术字段 |
| [DeepSeek Harness 工具输出](https://github.com/deepseek-ai/deepseek-harness/blob/571902028a75c64c1d767f4ae5fd099485f0ddf0/packages/core/tools/src/index.ts#L1840)、[edit](https://github.com/deepseek-ai/deepseek-harness/blob/571902028a75c64c1d767f4ae5fd099485f0ddf0/packages/fs/tool-fs/src/edit.ts#L100) 与 [界面 diff](https://github.com/deepseek-ai/deepseek-harness/blob/571902028a75c64c1d767f4ae5fd099485f0ddf0/packages/client/ui-tool/src/client/tool/models/diff-card-model.ts#L100) | 原始 mutation 数据、model render 和 presentationMeta 分工；内部版本可由宿主使用后不放进普通模型结果 | 用 Pi content/details 达到相同职责分离，无需搬来其渲染框架；不把原生工具模式推广成其所有模式 |

这些参考支持“同一真实执行结果按接收者提供适当表达”，没有提供自动保证所有自然语言解释正确的机制。查询范围与地图权限是本项目自己的领域要求；本方案不借参考源码为任意新增校验或答案审查背书。
