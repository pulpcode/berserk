# 参考与数据边界

- DSH ui-chat：完成的处理过程可折叠，最终答复独立；焦点保护和阅读位置需处理。https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-chat/README.md
- DSH ui-tool：按工具展示紧凑执行结果，实际事件决定状态。https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-tool/README.md

本项目不引入其插件架构、系统提示词显示或思维链界面。现有 PublicMessage 不含 stopReason/toolCall，SessionSnapshot 只返回 lastResult；不能将“非 active”或“最后一段文字”当成完成依据。新增 turns 仅从既有合法原生记录派生，不写记录，不改变执行成功判定。既有 conversationItems 按 requestId+toolCallId 绑定交互和 Agents，应复用后再分段。file_output 下载必须保持独立，异常不能藏到默认折叠区。
