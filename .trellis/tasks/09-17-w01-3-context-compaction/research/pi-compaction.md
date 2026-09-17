# Research：Pi 0.85.1 默认压缩接入

日期：2026-09-17。依据：本地安装包源码与同版本官方文档。未调用真实模型。

## 1. 原生行为

| 位置 | 已核验事实 |
| --- | --- |
| dist/core/agent-session.js:1453 | 默认摘要使用 agent.streamFunction，并传入当前 Pi 重试设置 |
| dist/core/agent-session.js:1739 | 自动压缩完成范围选择、摘要生成、追加保存及上下文重建 |
| dist/core/agent-session.js:1753 | 摘要调用前同步发出 compaction_start；结束发出 compaction_end |
| dist/core/agent-session.js:1660 | 可恢复溢出可以压缩后继续一次，再次失败发出错误；原历史保留 |
| dist/core/compaction/compaction.js:610 | 长单轮可能调用历史摘要与前缀摘要，最后合并保存 |
| dist/core/compaction/utils.js:74 | 摘要输入中的每条工具结果最多前 2,000 个 JavaScript 字符，附截短标记 |
| dist/core/session-manager.js:739 | 原生同步追加先改变内存再写文件，没有事务或 fsync 保证 |

路径均位于 experiments/harness-lab/node_modules/@earendil-works/pi-coding-agent/，版本为 0.85.1，安装产物不修改。

Pi 在新请求进入前、工具返回且还需下一回答、原生 Agent 结束时判断是否压缩。阈值为 contextTokens > contextWindow - reserveTokens。keepRecentTokens 控制近期保留量；特别长的一轮可在 assistant 边界划分摘要范围，不拆散工具调用与结果。

原文保留起点是 firstKeptEntryId。getBranch 供原始历史展示，buildSessionContext 使用最近摘要与保留消息。再次压缩携带上一摘要，并覆盖前次保留区中新纳入的历史。

## 2. 本项目接入

直接启用默认自动压缩，不注册自定义摘要扩展、不手动调用 compact helper 或再次 append。当前 src/pi/lab.ts 的流包装只按回复处理，需要依据原生 compaction_start／end 维护每会话独立用途标记，并在调用开始时捕获。

默认摘要继续使用原生提示词与 Context。摘要调用不注入当前完整 AGENTS 提醒，普通回答仍使用本请求固定快照；两类调用共享提供方设置、取消、用量记录与错误清洗，各自使用正确输出额度。空文本或非法摘要在受控流返回给 Pi 前转成明确失败，保留原生截断检查。

Pi 统一重试设置覆盖默认摘要和普通 Agent 瞬时错误重试；本期沿用原生最多额外 3 次、provider 重试 0，每次进入受控流都记录尝试。次数用于观测，不限制正常工具循环；显式整轮时限如有配置仍约束重试和恢复。错误清洗需保留安全分类，使瞬时错误和上下文溢出仍可识别。

session.abort()覆盖 Agent、压缩和重试；仅 agent.abort()不足。compaction_end 失败不必然结束宿主请求，项目需先锁定失败原因、禁止后续模型／工具调用，再由外层等待停止，事件中不自等 idle。

## 3. 保存边界

Pi 默认 details 用于原生文件跟踪，不自动理解本项目所有自定义工具。项目保留原生条目，用请求结果关联新压缩 ID、模型配置、触发原因和用量；不能仅凭相同摘要文字识别新条目。

原生追加失败可能留下已经改变的内存状态，须停用 manager，finally 不继续写入。文件打开前沿用逐行严格校验，不利用 Pi 跳坏行行为冒充修复。正常保存重启续聊与处理中崩溃自动恢复分别验收，后者不在本期。

## 4. 参考与验证

- [Pi 压缩文档](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/compaction.md)
- [AgentSession 源码](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/agent-session.ts)
- [压缩源码](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/compaction/compaction.ts)

源码说明接入依据，实际用途标记、错误识别、停止、存储与续作仍须按 [验收清单](../acceptance.md) 验证。现有 spec 描述的是已实现版本，开发后再同步验证结果。
