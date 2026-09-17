# 后续研究：摘要定制与项目数据

状态：后置，不作为 W01-3 实施或验收的前置条件。

## 摘要定制

Pi 有默认摘要模板，手动 session.compact(customInstructions)可追加重点；自动路径没有直接的 compaction.prompt 配置，也不自动解析 AGENTS.md 专用小节。扩展允许提供自定义压缩结果，但定制是否必要应以默认压缩的实际问题为依据。

可参考[Pi 压缩文档](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/compaction.md)、[Claude Code 的 Compact Instructions](https://code.claude.com/docs/en/how-claude-code-works#when-context-fills-up)和[Claude API 摘要定制](https://platform.claude.com/docs/en/build-with-claude/compaction#custom-summarization-instructions)。Claude API 的 instructions 是完整替换默认提示词，与补充重点不同。

## 关键项目数据

需要准确保留的项目状态、依赖和参数，可以在明确的数据源中独立保存，按需加载到后续上下文；不依赖历史摘要记住这些值。当前 AGENTS.md 按独立指令加载已有类似边界。

结构化格式本身不使内容免于压缩：如果 JSON 只是历史工具结果，仍可能进入摘要。未来应按具体需求明确数据来源、更新方式、版本和加载范围；从任意聊天自动提取关键数据也是独立能力，不能假定已具备。

W01-3 仅采用默认压缩、既有 AGENTS.md 加载和原始历史保存，不实现专用小节解析、自定义摘要提示或关键数据固定注入机制。
