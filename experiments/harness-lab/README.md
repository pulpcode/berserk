# W01：多轮对话与工作区实验

基于 Pi SDK 的本地 Web 对话工作台。支持工作区创建与切换、独立多轮会话、流式回答、资料读取、停止，以及工作区 AGENTS.md 的查看和编辑。Agent 可以按用户明确要求修改工作区指令，并按需读取资料综合写作、结果检查两个 Skill。

W01-1 的 C01～C06 已通过；W01-2 的验收结果见 [阶段记录](../../.trellis/tasks/archive/2026-09/09-16-w01-2-workspace-memory/research/validation-results.md)。W01-3 已接入 Pi 默认自动上下文压缩、摘要详情与独立运行时限，见 [验收记录](../../.trellis/tasks/09-17-w01-3-context-compaction/research/validation-results.md)。W01-4 已实现基础多角色子 Agent 并完成 D01～D13 组合验收，见 [阶段入口](../../.trellis/tasks/09-17-w01-4-subagent/review.md)。完整 Run、业务任务管理和外部调度属于后续阶段。

## 启动

需要 Node.js 24 和 npm。首次安装：

```bash
cd experiments/harness-lab
npm ci
cp .env.example .env.local
```

如 `.env.local` 已存在，直接编辑，避免覆盖已有密钥。配置：

```dotenv
LLM_PROVIDER=deepseek
LLM_MODEL=deepseek-flash
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=在本地填写
```

新目录首次启动会创建“默认工作区”。已有 W01-1 会话的目录需要先按下文迁移，启动不会静默导入。

```bash
npm run dev
```

访问 http://127.0.0.1:5173 。API 在 127.0.0.1:4310；仅监听本地回环地址。无密钥时也能管理工作区、会话和指令文件，发送消息会提示配置模型。

构建后也可单服务运行：

```bash
npm run build
npm start
```

访问 http://127.0.0.1:4310 。当前是单一本地用户、单服务进程，不支持两个进程同时写同一数据目录，暂不部署到 Ubuntu。

## 使用

页面中的“项目”沿用工作区的数据与隔离规则，底层 `workspaceId` 和现有存储不变。

- 侧栏按项目分组显示会话，点击会话可以直接跨项目进入；分组可折叠，折叠后仍显示处理中和需关注的数量。全局“新建对话”先选择项目，确认后创建；各项目标题旁的加号可直接在该项目新建对话。取消选择窗口不会创建空会话。会话创建后固定属于该工作区，不能跨区移动。同区会话使用相同资料与指令，但不读取彼此的聊天历史。
- “全部动态”汇总各工作区会话，可筛选“全部”“处理中”“需关注”。阶段来自实际执行状态；蓝点仅表示当前标签页尚未查看的新回复，读到回复末尾后消失；普通空闲会话不再显示“本轮完成／等待输入”文字。失败或需要恢复的会话也进入“需关注”。更新失败时保留上次状态并显示提示。
- 支持连续追问和纠正。Enter 发送、Shift+Enter 换行；中文输入法选词不会发送。切换工作区或会话不取消正在执行的请求。
- 从“项目资料”查看资料清单、只读通用指令和 Skill，并编辑“项目指令”。点击保存后，下一次发送使用新内容；正在回复的请求继续使用开始时的版本。
- 也可通过对话要求“请记住，以后报告先给结论”“删除这项约定”，由 Agent 读取并更新本工作区 AGENTS.md。普通问答不会自动抽取长期记忆。
- 保存发生冲突时，编辑器保留草稿。“查看最新内容”单独展示只读文件；自行整理后点击“合并后保存”。只有主动点击“放弃草稿，使用最新内容”才替换草稿，该操作不会写入服务端文件。
- 点击停止后等待执行结束；已经保存的指令不回滚。断线或结果不明时先核对文件，页面不会自动重发修改。
- 可以要求“实际读取 meeting-notes，概括培训条件”“使用 synthesis 综合资料”“使用 review 检查安排”。示例资料是虚构通用文本，Skill 提供工作方法。

页面草稿、选择及已读记录保存在当前标签页的 sessionStorage；浏览器存储不可用时继续保留内存编辑能力。会话阅读位置在页面内切换时保留；正在阅读旧内容时不会跳到底部，只有对话在前台并阅读到末尾才标记新回复已读。已读不跨浏览器同步。刷新只查询状态，不重新发送消息或执行工具。

全局动态通过轻量 `GET /api/activity` 约每 1.8 秒更新，只汇总工作区、会话标题和状态，不加载所有会话正文，也不会把不同工作区的资料或指令混入模型上下文。完整聊天记录仍按选中的会话查询。

## 模型设置

点击侧栏底部的“设置”或顶部模型名称，打开设置窗口的“模型”分类。可修改服务商标识、模型 ID、HTTPS API 地址与 API Key；当前使用 OpenAI Chat Completions 兼容接口。保存前需要所有会话结束当前回复，保存成功后下一次请求生效，无需重启。

API Key 不会回传到页面，输入框每次打开都为空；同一服务商和地址下留空表示保留现有密钥。更换服务商或地址时必须重新填写对应密钥。关闭窗口会清除尚未提交的密钥，不把密钥存入浏览器缓存。保存冲突或结果不明时，先读取最新配置核对，再手动保存，不会自动重试。

没有本地设置文件时使用 `.env.local`；首次网页保存后，模型配置写入被 Git 忽略的 `LAB_DATA_DIR/model-settings.json`（权限 `0600`），其值优先于环境中的模型字段。原 `.env.local` 不改写。重启后仍使用保存的设置。模型容量和压缩参数随模型设置保存；独立超时仍由环境配置控制。若需恢复环境配置，停服后将该设置文件移出数据目录，再启动服务。

## 子 Agent 与角色配置

可以要求“委派合适的子 Agent 分析两份资料，再由你综合”，或者“请另一个 Agent 检查这份草稿的依据和遗漏”。主 Agent 按任务选择角色，通过 `subagent` 工具委派；普通聊天无需委派。

预置 `analyst` 负责资料分析，`reviewer` 负责内容检查，后者还可读取检查 Skill。一次工具调用委派一个任务，可以先后选择不同角色。子 Agent 有独立上下文，父会话只接收最终结果；子会话原文不会自动拼入父上下文或参与父压缩。

对话中的子任务卡显示角色、状态，并可展开查看任务和结果。子完成后主 Agent 继续处理；点击当前“停止”结束整次处理。刷新不重新委派，子会话不加入普通会话列表。

角色文件位于 `fixtures/agents/*.md`，例如添加一个无工具的文本整理角色：

```markdown
---
name: formatter
description: 按要求整理给定文本的结构和格式
tools: []
---
仅整理任务中给出的内容，保留原意，不添加未经提供的事实。
```

name 唯一，description 描述职责，正文为角色指令；tools 支持逗号分隔文本或 YAML 数组。可声明的工具为 source_list、source_read、instructions_read、skill_read，不支持写入、Shell 或再次委派。工具必须显式声明，无工具用 `[]`；角色文件为 UTF-8，单份不超过 64 KiB。错误配置会明确提示，不回退为全量工具。

角色目录在每次用户请求开始时加载并固定，文件新增／修改／删除在下一请求生效。角色共用父请求模型，不能在文件里配置 model；网页角色管理、独立角色模型、并行／chain、递归和后台独立运行后置。

## 文件存储与旧版本迁移

服务端数据根目录为 `LAB_DATA_DIR`，默认本工程 `.local/`：

```text
.local/
  model-settings.json          # 网页保存的模型配置，包含服务端密钥（可选）
  workspace-index.json          # 工作区及会话归属
  .workspace-initialized        # 初始化标记
  migrations/workspace-v1.json  # 旧版本迁移记录（如执行过）
  workspaces/<id>/AGENTS.md     # 当前工作区指令
  workspaces/<id>/sources/      # 每区独立的两份测试资料
  sessions/                    # 原有 Pi 原生会话文件，位置和 ID 不变
  subagents/<parent>/<child>/   # 内部子会话的 Pi 原生历史
  agent/                       # 受限内核目录
```

通用指令和两个固定 Skill 位于本工程 `fixtures/common`、`fixtures/skills`；不会自动加载开发机全局配置或仓库根 AGENTS.md。`.env.local`、`.local/`、`.backups/`、构建和测试产物均被 Git 忽略。密钥仅在服务端使用。

升级已有 W01-1 数据前，先停止所有使用该目录的 API 服务。下面的备份路径应选一个尚不存在、位于源目录之外的位置；将示例替换为实际绝对路径：

```bash
npm run migrate:workspace -- --data-dir /absolute/path/harness-lab/.local --backup-dir /absolute/path/backups/harness-before-workspace --dry-run
npm run migrate:workspace -- --data-dir /absolute/path/harness-lab/.local --backup-dir /absolute/path/backups/harness-before-workspace --apply --service-stopped
```

`--dry-run` 只检查；`--apply` 先复制整个停服数据目录，核验后登记默认工作区。旧原生文件不重写，不调用模型；无法解析的文件保留并记入报告。中途失败时保留备份和报告，使用相同参数重试。索引损坏或丢失不会通过扫描历史猜测重建。

回退时停止新版本，将升级前备份恢复到另一个独立目录，由旧版本通过 LAB_DATA_DIR 指向恢复目录。保留升级后目录及新增指令、会话供核对；不要直接用旧版打开升级后的活动目录，也不自动合并新旧数据。

## 上下文压缩与运行控制

长对话使用 Pi 0.85.1 默认自动压缩：旧内容生成文本摘要，近期内容按 token 保留。特别长的一轮可压缩前半段。触发位置由 Pi 决定，可能发生在发送前、工具循环中或本轮结束时；遇到上下文溢出，Pi 可执行一次压缩恢复。摘要不用项目自定义提示词。

页面显示“正在压缩上下文”。原始消息和工具结果保留，摘要追加到同一原生会话文件；模型后续使用最近有效摘要与保留原文。通过“查看最近压缩摘要”入口可以查看摘要、原文保留起点和可获得用量。摘要详情只读，不启动模型调用。纯摘要完成不会产生未读蓝点。

AGENTS.md 继续独立加载：下一次发送读取最新版本，同一次请求使用固定快照。项目不会将完整 AGENTS 再注入摘要调用。Pi 默认会将过长工具结果在摘要输入中截短到 2,000 字符，磁盘和网页历史仍保存原文。默认摘要不保证无损，关键数据需按具体业务另行设计保存方式。

停止会取消回答、摘要或重试等待，等待在途操作收敛后显示结果。已提交的文件更新和摘要不回滚；下一次发送重新检查是否需要压缩。最终摘要失败会明确提示并结束本次请求。正常结束后可重启续聊；未完成的请求不自动重放，损坏原生文件会被保留并禁止续跑。

模型设置提供上下文容量 C、模型最大输出量 M，以及高级参数：压缩预留量 R、近期保留量 K。它们是模型能力和 Pi 原生参数，不能当作精确的剩余 token 计数。要求 M≤C、R+K<C，不要求 M≤R。普通窗口默认 R=16,384、K=20,000，小窗口自动缩小。

已核对的 DeepSeek Flash 官方端点预设 C=1,000,000、M=393,216。其他模型或代理地址需填写真实能力；不明时保留草稿并拒绝发送。更换模型身份不会继承上一模型的容量。v1 设置文件可读取，网页保存后写 v2；旧设置中环境补缺只适用于同一模型身份。

| 配置 | 默认值 | 意义 |
| --- | --- | --- |
| LLM_HTTP_IDLE_TIMEOUT_MS | 300000 | 单次模型流连续无进展的时限；0 关闭空闲计时 |
| LLM_REQUEST_TIMEOUT_MS | 不设置 | 单次模型调用时限；未设置时沿用提供方 SDK 默认 |
| AGENT_RUN_TIMEOUT_MS | 0 | 整轮总时限，0 表示不限时；正值覆盖准备、模型、工具、摘要和重试 |
| LLM_CONTEXT_WINDOW | 官方预设或未知 | 尚无网页配置时使用的模型真实上下文容量 |
| LLM_MAX_OUTPUT_TOKENS | 官方预设或未知 | 模型真实最大输出能力，不是每轮任务总额度 |
| LAB_DATA_DIR | .local | 服务端持久化目录，相对本工程目录 |

默认不限制累计工具调用数、模型尝试数或整轮时长。旧 REQUEST_TIMEOUT_MS、MAX_TOOL_CALLS、MAX_OUTPUT_TOKENS 只提示迁移，不再生效，用户环境文件不改写。次数和实际用量用于观测，缺失 usage 显示未知。

正常回答沿用 Pi 的模型输出额度和剩余空间裁剪；摘要沿用原生摘要额度，不统一限为 2,048 token。瞬时错误采用 Pi 原生重试策略，最多额外 3 次；提供方重试关闭，避免叠加。工具可由宿主声明独立时限，当前本地文件工具不附加统一时限；写效果未知时停止并要求核对。

通用指令上限 4 KiB、工作区指令 16 KiB、单 Skill 16 KiB、单份资料 32 KiB，均按 UTF-8 字节计算，超限报错。DeepSeek Flash 显式关闭 thinking。Pi 价格占位值不能当作实际费用。

工具为 source.list/read、instructions.read/update、skill.read；模型调用名称使用下划线，例如 source_read。任意文件／Shell 工具和扩展自动发现保持关闭。

## 验证

```bash
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
# 以下命令调用真实模型并消耗额度
npm run probe:compaction
npm run probe:subagent
npm run probe:workspace
npm run probe:live -- --case C02
```

普通测试使用确定性模型流，实际运行 Pi 会话、工具和原生历史；浏览器回归使用受控 API 响应。`probe:workspace` 在独立临时目录执行迁移、真实 HTTP/SSE 模型调用、独立进程重启，以及真实 Chrome 页面保存与冲突处理，输出证据路径、请求结果和实际 token 用量，不使用用户当前会话目录。

`probe:compaction` 使用独立临时目录及真实 DeepSeek，验证最新纠正、连续压缩、原文保留、摘要中停止和独立进程重启。只调整隔离目录的 R/K 提前触发，不伪造模型容量；探针单轮 300 秒时限不影响产品默认。真实验收没有 10 条请求总量限制。

macOS 优先使用已安装的 Chrome；其他环境需先准备 Playwright Chromium（例如 `npx playwright install chromium`）。真实探针保留临时目录用于核对，证据中的初始旧历史明确标记为合成测试数据。

`probe:subagent` 在独立临时目录验证真实角色选择、资料分析／内容检查、同轮先后委派、停止及独立进程重新加载；不使用用户会话目录。构建后可通过 `npm run probe:subagent -- --browser <证据目录> <父会话ID>` 查看真实历史的网页展示，验证展开、375px 布局和刷新无重发。探针单轮 300 秒时限仅用于验收。

官方依据：[Pi SDK v0.85.1](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/sdk.md)、[DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)。
