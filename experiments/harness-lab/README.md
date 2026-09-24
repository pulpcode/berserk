# W01：Web Agent 工作台

基于 Pi SDK 的本地 Web 对话工作台。支持工作区创建与切换、独立多轮会话、流式回答、资料读取、停止，以及工作区 AGENTS.md 的查看和编辑。Agent 可以按用户明确要求修改工作区指令，并按需读取资料综合写作、结果检查两个 Skill。

W01-1 的 C01～C06 已通过；W01-2 的验收结果见 [阶段记录](../../.trellis/tasks/archive/2026-09/09-16-w01-2-workspace-memory/research/validation-results.md)。W01-3 已接入 Pi 默认自动上下文压缩、摘要详情与独立运行时限，见 [验收记录](../../.trellis/tasks/09-17-w01-3-context-compaction/research/validation-results.md)。W01-4 已实现基础多角色子 Agent 并完成 D01～D13 组合验收，见 [阶段入口](../../.trellis/tasks/09-17-w01-4-subagent/review.md)。完整 Run、业务任务管理和外部调度属于后续阶段。

## 启动

应用服务需要 Node.js 24、npm 和 Python 3（仅运行固定的安全文件读写辅助程序）；文件工具和用户脚本需要 Linux Docker 与下文执行镜像。首次安装：

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

访问 http://127.0.0.1:4310 。当前使用单服务进程，默认固定测试席位，可选两个可切换测试席位，不支持两个进程同时写同一数据目录。可在 Ubuntu 同机运行应用和执行容器，通过 SSH 转发本地访问；不直接暴露公网。

## 人工提问与操作确认

Agent 需要明确输入时会显示问题卡片，支持选项、自定义文字及跳过；提交后继续当前任务。准备执行需确认的命令时，会显示完整命令、工作目录及原因，点击“确认执行”或“拒绝”。回答问题不代表批准操作。

等待期间可以切换会话、刷新或停止；同一标签页的未提交答案会保留。服务重启后待处理项失效，已保存记录仍可查看，不自动重放操作。导航分别显示“待回答”“待确认”，蓝点仍只代表新回复未读。

bash 规则在服务端执行，允许／询问／禁止分别处理；复杂或无法可靠分析的语法需要人工检查。普通 Python／Node 文件脚本仍可执行，其内部行为不做自动语义审计。批准不会开放网络或扩大 Docker 权限。具体范围见 [命令样例](../../.trellis/tasks/09-18-w01-6-hitl/research/command-policy.md)。可选双测试席位模式已接入本机业务分派与成果交接；外部系统上报、下发未接入。

开发验收可运行 `npm run probe:hitl`，使用独立临时数据和测试文件。`LAB_HITL_DEMO_ENABLED=true` 仅启用通用确认演示工具，默认关闭；不是关闭或开启 bash 规则的总开关。

## 使用

页面中的“项目”对应任务范围；实际工作区按任务 × 席位隔离。相同席位在同一项目中的会话共享普通文件和指令，聊天历史独立。默认使用服务端 `LAB_SEAT_ID`；设置 `LAB_TEST_SEATS` 后可在页面切换两个配置的测试席位。每个 API 仍校验当前路径的席位范围，这不是人员登录认证。旧 workspaceId 和原生会话保留。

- 侧栏按项目分组显示会话，点击会话可以直接跨项目进入；分组可折叠，折叠后仍显示处理中和需关注的数量。全局“新建对话”先选择项目，确认后创建；各项目标题旁的加号可直接在该项目新建对话。取消选择窗口不会创建空会话。会话创建后固定属于该工作区，不能跨区移动。同区会话使用相同资料与指令，但不读取彼此的聊天历史。
- “全部动态”汇总各工作区会话，可筛选“全部”“处理中”“需关注”。阶段来自实际执行状态；蓝点仅表示当前标签页尚未查看的新回复，读到回复末尾后消失；普通空闲会话不再显示“本轮完成／等待输入”文字。失败或需要恢复的会话也进入“需关注”。更新失败时保留上次状态并显示提示。
- 支持连续追问和纠正。Enter 发送、Shift+Enter 换行；中文输入法选词不会发送。切换工作区或会话不取消正在执行的请求。
- 输入 `@` 先选择“项目文件或文件夹”或“子 Agent”，再从对应列表选择；文件夹用于浏览，选择文件才添加引用。输入 `/` 选择 Skill；输入框旁的添加菜单提供相同入口。选择后显示可移除标签，填写目标并发送才开始工作。支持多个文件、一个 Skill 和一个子 Agent；选择不会自动带入下一条消息。
- 显式选用 Skill 会直接加载受控方法正文；同时选子 Agent 时，方法和文件引用也交给匹配角色。委派仍由主 Agent 调用工具执行，以实际子任务卡片为准。历史中的 Skill 标签可查看当时正文。
- 从“项目资料”查看资料清单、只读通用指令和 Skill，并编辑“项目指令”。点击保存后，下一次发送使用新内容；正在回复的请求继续使用开始时的版本。
- 也可通过对话要求“请记住，以后报告先给结论”“删除这项约定”，由 Agent 读取并更新本工作区 AGENTS.md。普通问答不会自动抽取长期记忆。
- 保存发生冲突时，编辑器保留草稿。“查看最新内容”单独展示只读文件；自行整理后点击“合并后保存”。只有主动点击“放弃草稿，使用最新内容”才替换草稿，该操作不会写入服务端文件。
- 点击停止后等待执行结束；已经保存的指令不回滚。断线或结果不明时先核对文件，页面不会自动重发修改。
- 可以要求“实际读取 meeting-notes，概括培训条件”“使用 synthesis 综合资料”“使用 review 检查安排”。示例资料是虚构通用文本，Skill 提供工作方法。

页面草稿、选择及已读记录保存在当前标签页的 sessionStorage；浏览器存储不可用时继续保留内存编辑能力。会话阅读位置在页面内切换时保留；正在阅读旧内容时不会跳到底部，只有对话在前台并阅读到末尾才标记新回复已读。已读不跨浏览器同步。刷新只查询状态，不重新发送消息或执行工具。

全局动态通过轻量 `GET /api/activity` 约每 1.8 秒更新，只汇总工作区、会话标题和状态，不加载所有会话正文，也不会把不同工作区的资料或指令混入模型上下文。完整聊天记录仍按选中的会话查询。

## 任务分派与成果交接

在 `.env.local` 加入以下配置并重启，页面将出现测试席位选择和“工作待办”：

```dotenv
LAB_SEAT_ID=test-seat
LAB_TEST_SEATS='[{"id":"test-seat","name":"席位 A"},{"id":"seat-b","name":"席位 B"}]'
```

配置必须包含旧 `LAB_SEAT_ID`，旧会话和工作区 ID 不迁移。仍只运行一个服务；测试席位可主动切换，不可作为公网登录权限。

1. A 在工作待办中分派目标和文件，预览实际固定副本后确认；也可在对话中要求 Agent 分派，由确认卡片批准。
2. B 查看并明确签收，选择新建办理会话或关联同项目的空闲会话。资料可导入自己的目录，使用既有 Pi 文件工具和脚本处理。
3. B 选择一份成果文件提交，确认后 A 查看固定版本并验收或退回。退回意见会进入 B 后续对话的工作信息；修改重提交保存新版本。

各席位文件和聊天独立，仅交接的文件副本对双方可见。普通文件不新增状态机；工作状态为待签收、办理中、待验收、已退回和已完成。工作完成后仍可在“全部”中查看。分派不自动运行对方 Agent，待验收也不占用运行资源。

结果不明时使用“查询结果”核对，勿重新创建同一交接。页面准备和 Agent 确认通道不能互相绕过。重启会使尚未提交的准备失效，已提交版本及回执保留；不重放旧工具。可通过文件面板或 `@` 引用明确要处理的文件；上报仍需业务确认。

真实验收用 `npm run probe:handoff`；需要已配置的模型与同机 Docker，自动使用独立临时数据，输出证据路径。此命令不发布或重启正式服务。备份时停止服务并保存整个 `LAB_DATA_DIR`，包括新协作数据库及副本。

文件／Skill／角色组合输入的真实验收使用 `npm run probe:references`，同样使用独立临时数据及现有模型、Docker 配置，核对实际委派、文件读取、方法使用和重新打开后的历史。不会启动另一个正式实例。

## 模型设置

所有席位都可在输入框底部选择已配置的模型，每个对话分别保存，刷新或服务重启后仍保留。选择不会修改其他对话或全局配置；回复和后台分析进行中不能切换。未配置密钥或容量不完整的模型不可选。

只有具有 `--manage-model` 权限的席位能通过侧栏“设置 → 模型”添加、选择编辑模型配置，填写服务商标识、模型 ID、HTTPS API 地址与 API Key；普通席位的设置仅显示账户。当前使用 OpenAI Chat Completions 兼容接口。配置保存前需要所有会话结束当前回复，保存成功后下一次请求生效，无需重启。

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

name 唯一，description 描述职责，正文为角色指令；tools 支持逗号分隔文本或 YAML 数组。可声明的工具为 source_list、source_read、instructions_read、skill_read、read、ls、find；文件只读工具需要执行镜像，不支持写入、Shell 或再次委派。工具必须显式声明，无工具用 `[]`；角色文件为 UTF-8，单份不超过 64 KiB。错误配置会明确提示，不回退为全量工具。

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
  workspaces/<id>/files/        # 席位持久工作目录：上传、脚本、中间文件和成果
  file-storage/<id>/uploads/    # 上传状态与实际保存路径
  file-storage/<id>/staging/    # 未完成传输，不对 Agent 开放
  file-storage/<id>/downloads/  # 聊天下载卡的固定副本
  file-storage/<id>/executions/ # 持久命令日志，在容器内只读映射为 /logs
  collaboration/collaboration.sqlite # 工作状态、提交、准备单与回执（双席位模式）
  collaboration/files/<id>/content    # 不可变交接副本，不挂载给沙盒
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

已有工作区索引 v1 需要升级为任务／席位索引 v2，同样先停服，使用新的独立备份目录：

```bash
npm run migrate:seats -- --data-dir /absolute/path/harness-lab/.local --backup-dir /absolute/path/backups/before-seats --dry-run
npm run migrate:seats -- --data-dir /absolute/path/harness-lab/.local --backup-dir /absolute/path/backups/before-seats --apply --service-stopped
```

升级只增加归属与普通文件目录，不重写聊天历史。默认把原有工作区归到 `test-seat`，每个原工作区保留独立任务范围；使用其他测试席位时，迁移的 `--seat-id` 必须与服务端 `LAB_SEAT_ID` 一致。

## 文件作业与执行环境

W01-5 已接入文件功能，真实 Ubuntu 容器验收状态见[阶段记录](../../.trellis/tasks/09-17-w01-5-artifact-versions/research/validation-results.md)。

- 输入框加号或拖放上传文件；上传完成即成为当前席位工作目录中的普通文件。同名文件自动改名，不覆盖原文件。移除消息附件只移除引用，文件仍在工作区。
- “文件”面板浏览目录、搜索、引用、预览或下载当前文件。Markdown 不加载外部图片或执行 HTML；HTML／SVG 仅按文本预览；其他格式下载查看。PNG／JPEG 预览限制为 10 MiB、8192 边长和 1600 万像素。
- 发送时需要说明处理目标，文件内容由 Agent 按需读取或编写脚本解析。可要求“分析这份 CSV，生成图表与 Word 报告，并提供下载”。当前模型不直接理解图像。
- 同一工作区多会话并行，共享目录。修改同一文件可能互相覆盖；本期不自动合并、不建立 worktree。不同席位使用不同目录。
- Agent 用 file_output 交付文件后，聊天展示下载卡，指向固定副本；后续修改或删除工作目录中的文件不会改变这张卡的内容。此功能不包含上报、审批或业务成果状态。
- 停止只清理当前请求容器和子进程，已经写出的文件保留；不自动重放失败命令。原生长输出日志归档到持久目录，可从后续请求的 `/logs` 读取。

在 Ubuntu 应用目录构建镜像（构建时需要下载基础镜像和依赖）：

```bash
docker build -t berserk-file-runtime:w01-5 execution-image
npm run probe:execution
```

运行时默认无网络、非 root、只读根目录；只挂载当前席位工作目录和只读日志。模型/API Key、原生会话和工作区索引留在应用宿主，不注入容器。Docker 不可用时文件执行明确失败，不回退宿主执行；普通聊天和文件管理仍可使用。应以普通用户运行应用，容器 UID/GID 默认跟随应用用户；配置其他 UID 时须先保证挂载目录读写权限。

| 环境配置 | 默认值 | 用途 |
| --- | --- | --- |
| LAB_SEAT_ID | test-seat | 服务端固定席位 |
| LAB_EXECUTION_ENABLED | true | 是否注册容器文件工具 |
| LAB_EXECUTION_IMAGE | berserk-file-runtime:w01-5 | 已构建的本地镜像 |
| LAB_EXECUTION_CPUS / LAB_EXECUTION_MEMORY_MB / LAB_EXECUTION_PIDS | 2 / 1024 / 128 | 单请求容器资源 |
| LAB_EXECUTION_UID / LAB_EXECUTION_GID | 应用进程 UID/GID | 非 root 容器身份 |
| LAB_MAX_FILE_BYTES / LAB_MAX_ATTACHMENTS | 104857600 / 20 | 单文件传输与单条消息附件上限 |

执行容器根目录 tmpfs 限制为 256 MiB；单命令输出和 read 整文件读取有边界。持久 bind mount 不提供硬磁盘配额，应监控服务器磁盘空间。每个请求启动独立容器，请求结束销毁；应用启动清理同实例残留容器，不恢复执行。

服务器部署时，代码、应用、持久数据和 Docker 放在同一 Ubuntu 主机；不要将 Mac 的路径直接交给远程 Docker daemon。服务器运行 `npm run build`，再运行 `PORT=4315 npm start`，然后在本机终端建立同端口转发：

```bash
ssh -N -L 4315:127.0.0.1:4315 tencent-server
```

浏览器访问 http://127.0.0.1:4315 （使用独立本地端口，避免与本地开发服务冲突）。SSH 凭证只保存在本机 SSH 配置中；API Key 仅写入服务器 `.env.local` 或受控模型设置，均不提交 Git。

发布源码包必须包含 `public/`；Vite 会将其中的 Logo 和 favicon 复制到 `dist/`。替换线上 `dist/` 前核对这批静态文件完整；发布后检查 `/brand/axon-app-icon.svg`、`/brand/axon-wordmark.svg` 和 `/favicon.ico` 的 HTTP 状态、图片类型及内容，不能只检查首页和 JS 文件。

## 上下文压缩与运行控制

长对话使用 Pi 0.85.1 默认自动压缩：旧内容生成文本摘要，近期内容按 token 保留。特别长的一轮可压缩前半段。触发位置由 Pi 决定，可能发生在发送前、工具循环中或本轮结束时；遇到上下文溢出，Pi 可执行一次压缩恢复。摘要不用项目自定义提示词。

页面显示“正在压缩上下文”。原始消息和工具结果保留，摘要追加到同一原生会话文件；模型后续使用最近有效摘要与保留原文。通过“查看最近压缩摘要”入口可以查看摘要、原文保留起点和可获得用量。摘要详情只读，不启动模型调用。纯摘要完成不会产生未读蓝点。

AGENTS.md 继续独立加载：下一次发送读取最新版本，同一次请求使用固定快照。项目不会将完整 AGENTS 再注入摘要调用。Pi 默认会将过长工具结果在摘要输入中截短到 2,000 字符，磁盘和网页历史仍保存原文。默认摘要不保证无损，关键数据需按具体业务另行设计保存方式。

停止会取消回答、摘要或重试等待，等待在途操作收敛后显示结果。已提交的文件更新和摘要不回滚；下一次发送重新检查是否需要压缩。最终摘要失败会明确提示并结束本次请求。正常结束后可重启续聊；未完成的请求不自动重放，损坏原生文件会被保留并禁止续跑。

模型设置提供上下文容量 C、模型最大输出量 M，以及高级参数：压缩预留量 R、近期保留量 K。它们是模型能力和 Pi 原生参数，不能当作精确的剩余 token 计数。要求 M≤C、R+K<C，不要求 M≤R。普通窗口默认 R=16,384、K=20,000，小窗口自动缩小。

已核对的 DeepSeek Flash 官方端点预设 C=1,000,000、M=393,216。其他模型或代理地址需填写真实能力；不明时保留草稿并拒绝发送。更换模型身份不会继承上一模型的容量。v1/v2 设置文件可读取，单一默认模型仍写 v2，添加多个模型后在同一文件保存 v3 目录；旧设置中环境补缺只适用于同一模型身份。

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

原有 source.list/read、instructions.read/update、skill.read 继续可用；文件作业增加 Pi 原生 read、write、edit、bash、ls、find 与 file_output。文件及命令只在请求容器中执行；宿主内置文件／Shell 工具与扩展自动发现保持关闭。

## 验证

```bash
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
npm run probe:execution
# 以下命令调用真实模型并消耗额度
npm run probe:files
npm run probe:files-continuation
npm run probe:compaction
npm run probe:subagent
npm run probe:workspace
npm run probe:live -- --case C02
```

普通测试使用确定性模型流，实际运行 Pi 会话、工具和原生历史；浏览器回归使用受控 API 响应。`probe:workspace` 在独立临时目录执行迁移、真实 HTTP/SSE 模型调用、独立进程重启，以及真实 Chrome 页面保存与冲突处理，输出证据路径、请求结果和实际 token 用量，不使用用户当前会话目录。

`probe:execution` 要求真实 Linux Docker 和已构建镜像，验证文件格式、容器隔离、并行及停止，无模型调用。`probe:files` 使用独立数据目录、真实模型和容器验证上传后的脚本处理、修改、固定下载副本、只读子 Agent 与重启；`probe:files-continuation` 验证原生压缩后继续处理原文件，以及停止真实长命令和后续读取。两个文件探针的单轮 600 秒时限仅用于诊断，不改变产品配置。

`probe:compaction` 使用独立临时目录及真实 DeepSeek，验证最新纠正、连续压缩、原文保留、摘要中停止和独立进程重启。只调整隔离目录的 R/K 提前触发，不伪造模型容量；探针单轮 300 秒时限不影响产品默认。真实验收没有 10 条请求总量限制。

macOS 优先使用已安装的 Chrome；其他环境需先准备 Playwright Chromium（例如 `npx playwright install chromium`）。真实探针保留临时目录用于核对，证据中的初始旧历史明确标记为合成测试数据。

`probe:subagent` 在独立临时目录验证真实角色选择、资料分析／内容检查、同轮先后委派、停止及独立进程重新加载；不使用用户会话目录。构建后可通过 `npm run probe:subagent -- --browser <证据目录> <父会话ID>` 查看真实历史的网页展示，验证展开、375px 布局和刷新无重发。探针单轮 300 秒时限仅用于验收。

官方依据：[Pi SDK v0.85.1](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/sdk.md)、[DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)。

## 业务任务与账号入口

正式启动默认要求登录。一个启用账号固定绑定一个席位；工作任务的说明对启用席位可见，文件／会话仍按任务 × 席位分别保存。个人空间仅所属席位可访问和管理，每个启用席位均可创建自己的空间。工作任务内的工作分派、成果提交与验收继续使用原有确认流程。

本期不迁移难以对应的旧实验项目。需要重新初始化时，先停止服务，再备份完整数据根：

```sh
npm run access:admin -- reset --data-dir /绝对路径/数据目录 --backup-dir /绝对路径/独立备份目录 --service-stopped
```

命令将旧目录完整移动到备份位置，并准备空数据目录；只复制模型设置。已有备份不会被覆盖。需要回退时先保留新数据，再用旧程序和原备份恢复。**不要对正在运行的数据根执行维护命令。**

在实验目录内开通账号（密码由终端隐蔽输入两次，不放在命令参数或对话中）：

```sh
npm run access:admin -- account --data-dir /绝对路径/数据目录 --username operator-a --name 席位A用户 --seat seat-a --seat-name 席位A --manage-tasks --manage-model --service-stopped
npm run access:admin -- account --data-dir /绝对路径/数据目录 --username operator-b --name 席位B用户 --seat seat-b --seat-name 席位B --service-stopped
```

`--manage-tasks` 授权该席位创建、编辑、归档和重新开启所有工作任务的说明，不受创建席位限制；未获授权的席位即使曾创建任务，也不能管理这些说明。该权限不允许读取其他席位的文件／会话或个人空间，不改变工作分派与验收的参与者权限。旧参数 `--create-public` 仍可使用，含义与 `--manage-tasks` 相同；内部沿用 `createPublicTask`／`create_public` 字段，无需迁移数据。`--manage-model` 仍独立控制共享模型设置。

首次开通生成被 Git 忽略的 `.env.auth.local`，包含数据目录和随机签名密钥；`npm start`／`npm run dev:api` 会加载它。密码只以加盐 scrypt 摘要存储。同用户名再次运行是重置密码和能力，会使旧登录失效；账号不可在此命令中换席位。停用使用 `disable --username operator-b --data-dir ... --service-stopped`。正式配置请移除原 `LAB_TEST_SEATS`，不得与登录模式同时启用。

| 配置 | 用途 |
| --- | --- |
| `LAB_AUTH_MODE=login`（默认） | 正式账号入口；缺签名密钥或启用账号时拒绝启动 |
| `LAB_SESSION_SECRET` | 至少 32 字符，维护命令随机生成，不提交仓库 |
| `LAB_SESSION_HOURS=8` | 绝对登录有效期，不限制 Agent 执行时长 |
| `LAB_AUTH_MODE=test` | 仅供独立测试数据，允许原固定／测试席位接口；不提供认证 |

当前仍仅监听本机，通过已有 SSH 同端口转发访问。Cookie 的 HTTP 例外仅用于此本地连接；此实现未扩大为公网 HTTPS 部署。

退出会清理本页未发送内容与附件引用；已接受的 Agent 处理继续，重新登录后可查结果。不同账号并行验收应使用独立浏览器配置或隐身会话；同一浏览器标签页共享登录。

`npm run probe:access` 使用新临时数据根运行真实模型与 Docker 的任务上下文、席位文件隔离、重启续聊验证；不启动生产监听器，不打开生产会话库。权限与登录主要由 `tests/access.test.ts` 和 `tests/e2e/access.spec.ts` 确定性验收。

## 信息处理与席位投递

登录模式下可选启用本功能：接收来源文本／文件，Pi 后台预处理后投递一个或多个席位；席位人员再选择进入对话，或明确提交后台分析。对话入口只准备资料和草稿，不自动发送。后台分析沿用本席位所选任务的文件，执行完可继续原会话。

先复制 `config/background.example.json` 到受控的本地配置文件，核对来源、处理方案及实际席位 ID。在被 Git 忽略的环境文件中设置：

```dotenv
LAB_BACKGROUND_CONFIG=/绝对路径/background.json
# 至少 24 字符的随机来源凭证；由部署人员设置，不提交 Git
MATERIAL_FEED_TOKEN=填入随机凭证
```

配置的 `enabled:false` 使首次来源接收和队列均暂停。之后网页开关持久保存，重启不会用配置值覆盖。`concurrency` 控制后台作业数，`modelConcurrency` 控制进程内真实模型调用数，`backlogLimit` 统计未匹配信息和排队作业。来源凭证只能提交该来源，不能登录席位或管理规则。

停服备份数据根后，给账号或席位授予指定来源的信息中心权限：

```sh
npm run background:admin -- grant --data-dir /绝对路径/数据目录 --source material-feed --account a --permission manage --service-stopped
# 只读观察权限将 manage 改为 view；按席位授权将 --account a 改为 --seat test-seat
npm run background:admin -- list --data-dir /绝对路径/数据目录 --service-stopped
```

授权者在工作台左侧进入“信息处理中心”，导航保持常驻。默认后台作业看板按“排队中、执行中、执行完成、异常／已停止”分列，可切换列表、按来源与关键词筛选、分别翻页，点击作业查看详情。信息记录按每次作业展示对应投递；“处理与投递规则”保留现有配置入口。普通席位通过“收到的信息”查看各自收件；信息中心权限不授予其他席位的私有分析内容。

集成入口使用 `Authorization: Bearer <来源凭证>`：

- `POST /api/integrations/:sourceId/uploads`，JSON `{name,size}`；随后 `PUT /uploads/:uploadId/content` 上传 `application/octet-stream` 字节。
- `POST /api/integrations/:sourceId/events`，JSON `{sourceMessageId,title,text,uploadIds?,subjectId?,occurredAt?}`；纯附件消息传空 `text`。
- `GET /api/integrations/:sourceId/events?sourceMessageId=...` 查询已接受回执。

同一消息重送沿用 `sourceMessageId`；同键同内容返回原回执，同键异内容返回 409。无启用规则的信息会保存为待匹配，不启动模型；管理人员明确补处理后才入队。投递失败可单独重试，预处理不会重跑。

前后台共用命令规则。普通同目录 `cd` 和文件检查的简单通配可执行；后台遇到待审命令时，该命令不执行，Pi 收到工具错误后可选择获准步骤继续，不创建确认卡或自动转为前台工作。普通对话仍使用现有确认卡。命令检查不审计脚本全部效果，不保证所有等效文件修改都经过审批。

“执行完成”表示 Agent 正常结束，不保证业务目标全部达成；部分结果或无法完成的正常答复也可能投递。查看详情可分别核对实际答复、受阻命令和投递结果。技术失败、取消和中断不新增结果投递；旧失败记录保持原状。明确重新预处理会创建新作业，沿用原输入和规则快照，不增加权限。

新增 SQLite 元数据以 schema v3 保存，Pi 原生历史不迁移、不另存一份聊天。文件位于 `background/events`（固定正文）、`background/files`（固定输入与交付副本）、`background/jobs/<id>`（预处理工作文件、原生会话和日志）；人员分析仍在原任务 × 席位目录。运行中异常退出后标为中断，不自动重放工具；排队项重启后重新校验再领取。

`npm run probe:background` 使用临时账号／任务和新临时目录，调用真实模型与 Docker 验证上传、Python 处理、双席位投递、前台接手、后台分析及续聊，并完成 A 分派两份附件、B 签收修订并提交 A 的流程。`npm run probe:background -- --feedback` 单独验证后台命令受阻后继续读取。两者保存 `validation.json`，不启动生产监听器，不自动批准 shell；交接验收只确认脚本核对过的本次合成工作。发布需另行更新服务；回退前保留新收到的数据，使用匹配的旧程序与完整备份。
