# 上传与文件作业交互参考

核验日期：2026-09-18。依据为官方使用说明，未操作用户的竞品账号，也不推测其未公开存储实现。

| 参考 | 官方公开行为 | 本项目采用的交互 |
| --- | --- | --- |
| [Claude 文件上传](https://support.claude.com/en/articles/8241126-upload-files-to-claude) | 输入框加号、选择文件、拖放；聊天附件与项目文件分别提供入口 | 借鉴附件按钮、拖放与列表反馈；本项目两个上传入口均落入当前席位普通工作目录，存储语义不照搬 |
| [Claude 文件创建与编辑](https://support.claude.com/en/articles/12111783-create-and-edit-files-with-claude) | 在执行环境中编写运行代码，处理数据并产生可下载文件 | 覆盖脚本与中间产物；结束后展示真实文件入口，不只输出聊天正文 |
| [ChatGPT 项目与聊天](https://learn.chatgpt.com/docs/projects) | 项目组织文件与独立聊天，Web 项目需要上传或连接来源；本地目录是另一种接入方式 | 服务端管理项目文件，通过浏览器上传，不把用户电脑目录误当成服务器路径 |
| [ChatGPT 文件查看](https://learn.chatgpt.com/docs/artifacts-viewer) | 网页可附加源文件，查看／下载生成文件，并继续反馈修改 | 对话旁文件面板、下载卡和自然语言修订；首期预览范围单独声明 |
| [DeepSeek Harness Web 指南](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/index.md) | 选择工作目录，Agent 可读写文件、执行命令与委派工作 | 复用现有项目导航并接通用文件作业；指南未证明上传交互，不把上传细节归因于它 |

上述产品的文件大小、额度和套餐限制不能直接作为本项目配置。Claude 不同文件功能说明中的限额并不一致，本研究只采用其交互与能力边界，不照搬数字。

## 本项目交互提案

1. 输入框增加附件按钮，同时支持拖放；原项目选择、会话加号及未读蓝点保持现有方式。
2. 每个附件显示文件名、体积、上传进度及失败原因。上传失败保留文字草稿；可重试或移除，不能静默漏发附件。
3. 上传成功即成为当前任务、当前席位的普通可写文件，同工作区会话可按需读取；发送消息只关联文件引用。移除附件引用不删除已上传文件，切换会话保留未发送文字和引用。
4. 同名时生成不重名文件名并显示实际路径；上传不覆盖已有文件，不自动解压、执行脚本或加载指令。之后可通过正常文件工具修改，不强制只读原件。
5. 文件面板统一展示当前席位工作目录，可预览、引用、下载，不区分只读上传区与工作区。聊天交付卡打开固定下载副本，区别于面板中的当前文件。
6. 内容按工具需要进入模型上下文；不要求每次上传都创建知识库、嵌入索引或全文系统提示。

ui-ux-pro-max 定向查询 `file upload progress errors --domain ux` 返回进度反馈、错误恢复及完整错误／名称可访问的建议，与场景匹配。结合既有规则，采用逐项重试、键盘替代拖放、可见焦点、窄屏文件面板、跨项目迟到响应隔离；不新增视觉体系。

任务 × 席位工作区、普通文件上传与同目录多会话并行是本项目的产品选择；下载副本和 Docker 执行方式是本项目的工程设计，不宣称这些竞品内部采用相同实现。

## Codex 同目录工作的参考边界

Codex Local 直接操作项目目录，各会话保留自己的记录并读取当前工作文件；Worktree 为 Git 项目提供独立文件副本，官方同时提醒并行 Agent 写入可能冲突。[环境模式](https://learn.chatgpt.com/docs/environments/modes)、[项目与会话](https://learn.chatgpt.com/docs/projects)、[Worktree](https://learn.chatgpt.com/docs/environments/git-worktrees)、[子 Agent](https://learn.chatgpt.com/docs/agent-configuration/subagents)。核验日期：2026-09-18。

本项目采用本轮讨论中的同目录多会话并行方式，不增加整轮排队，也不在本期实现 worktree；不推断 Codex 存在未公开的目录锁或保证所有同文件修改无冲突。
