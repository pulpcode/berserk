# W01-9 实现依据

核对日期：2026-09-20。依据当前工作树及安装的 Pi **0.85.1**。以下区分现有能力与本期设计选择，不宣称是竞品的内部实现。

## 现有代码

路径相对 `experiments/harness-lab/`：

| 位置 | 核对结果 | 本期用途 |
| --- | --- | --- |
| `src/web/useAttachments.ts`、`Files.tsx` | 已有按草稿归属的上传、普通文件引用、迁移与恢复 | `@` 作为已有引用能力的新入口 |
| `src/files/service.ts`、`src/server/file-routes.ts` | 列表按当前目录筛选；`resolveInputs` 验证文件并取得 hash；不是全工作区搜索索引 | 复用目录查询和发送校验 |
| `src/resources/service.ts`、`src/pi/resource-tools.ts` | 已有受控 Skill 清单、请求快照、正文及 `skill_read`；当前预置 synthesis/review | 选择列表和显式加载沿用同一来源 |
| `src/pi/roles.ts`、`fixtures/agents/*.md` | 受控基础角色配置；analyst 没有 `skill_read`，reviewer 有；均只读 | 返回角色元数据，不让选择器编辑权限 |
| `src/pi/lab.ts` | 通过主会话 `subagent` 工具进入独立子会话；原有停止、结果与预算路径；每请求固定资源和角色 | 保留既有执行路径，补充选用意图与必要输入 |
| `src/pi/file-history.ts`、`history-evidence.ts` | 文件引用用 Pi custom_message 入同一 JSONL，显示和模型输入分离；历史有严格校验 | 同样用原生消息表达 Skill／角色输入，不引入第二套存储 |
| `src/web/Seats.tsx`、`useChat.ts` | 席位作用域、草稿切换、首次创建及异步事件归属已有保护 | 新选择项必须随同一草稿迁移 |

## Pi 的边界

安装包源码：`node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js` 的 `prompt` 与 `_expandSkillCommand`，以及 `resource-loader.d.ts`。

- Pi 原生 `/skill:name args` 只在开头匹配一份已加载 Skill，读取 filePath，去掉 frontmatter，展开方法正文后附加任务文字。
- 公开 ResourceLoader 有 `skillsOverride`；原生命令展开仍会读取宿主文件路径。它不会直接消费 Axon 的 `ResourceSnapshot`，也不会自动生成网页选择器。
- Axon 当前设置 `noSkills: true`，并调用 `prompt(text, {expandPromptTemplates: false})`。直接在网页输入 `/skill:review` 不会获得原生展开能力。
- 公开 `sendCustomMessage` 与 `prompt` 可继续使用 Pi 的会话保存、模型循环及压缩。本方案用前者传递受控选择内容，后者保留原用户正文；不修改内核。

**本期设计选择**：Skill 显式选择后加载正文；`@` 子 Agent 仍是交给主 Agent 的委派要求，而非宿主直接强制启动。前者需一个小型 Web 输入适配，后者沿用现有工具。正文包裹、选择标签和只读目录接口是 Axon 的适配，不声称 Pi 原生自带这些 Web 交互。

显式加载与 `skill_read` 共用受控快照中的 Skill 访问逻辑。用户审阅时核对的官方依据：[Codex App Server](https://learn.chatgpt.com/docs/app-server#skills) 推荐结构化 `skill` 输入，由服务端注入正文；[Claude Code](https://code.claude.com/docs/en/skills#control-who-invokes-a-skill) 区分用户显式调用与模型自主调用，两者都会加载方法内容。这些资料支持显式选择后无需再要求模型调用读取工具；不表示 Axon 实现了这些产品全部 Skill 语义。

## 交互依据

采用现有 React textarea、附件标签和添加入口，不改变全站布局。使用 `ui-ux-pro-max` 的键盘焦点及 Web 浮层可见性建议；检索 `autocomplete keyboard focus` 得到的适用条目是 Focus States、Focus Not Obscured。Enter 选择与发送分离、中文组合输入保护、异步草稿归属是本项目针对对话输入的具体要求。
