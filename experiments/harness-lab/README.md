# W01：多轮对话与工作区实验

基于 Pi SDK 的本地 Web 对话工作台。支持工作区创建与切换、独立多轮会话、流式回答、资料读取、停止，以及工作区 AGENTS.md 的查看和编辑。Agent 可以按用户明确要求修改工作区指令，并按需读取资料综合写作、结果检查两个 Skill。

W01-1 的 C01～C06 已通过；W01-2 的验收结果见 [阶段记录](../../.trellis/tasks/archive/2026-09/09-16-w01-2-workspace-memory/research/validation-results.md)。完整 Run、业务任务管理、上下文压缩、Subagent 和外部调度属于后续阶段。

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

- 在侧栏选择或新建工作区，再新建对话。会话创建后固定属于该工作区，不能跨区移动。同区会话使用相同资料与指令，但不读取彼此的聊天历史。
- 支持连续追问和纠正。Enter 发送、Shift+Enter 换行；中文输入法选词不会发送。切换工作区或会话不取消正在执行的请求。
- 从“工作区资料”查看资料清单、只读通用指令和 Skill，并编辑“工作区指令”。点击保存后，下一次发送使用新内容；正在回复的请求继续使用开始时的版本。
- 也可通过对话要求“请记住，以后报告先给结论”“删除这项约定”，由 Agent 读取并更新本工作区 AGENTS.md。普通问答不会自动抽取长期记忆。
- 保存发生冲突时，编辑器保留草稿。“查看最新内容”单独展示只读文件；自行整理后点击“合并后保存”。只有主动点击“放弃草稿，使用最新内容”才替换草稿，该操作不会写入服务端文件。
- 点击停止后等待执行结束；已经保存的指令不回滚。断线或结果不明时先核对文件，页面不会自动重发修改。
- 可以要求“实际读取 meeting-notes，概括培训条件”“使用 synthesis 综合资料”“使用 review 检查安排”。示例资料是虚构通用文本，Skill 提供工作方法。
- 消息中的资源详情用于核对当次实际加载的指令与已读 Skill，旧快照不会随当前文件编辑而改写；迁移前未记录的请求明确显示不可用。

页面草稿和选择保存在当前标签页的 sessionStorage；浏览器存储不可用时继续保留内存编辑能力。刷新只查询状态，不重新发送消息或执行工具。

## 文件存储与旧版本迁移

服务端数据根目录为 `LAB_DATA_DIR`，默认本工程 `.local/`：

```text
.local/
  workspace-index.json          # 工作区及会话归属
  .workspace-initialized        # 初始化标记
  migrations/workspace-v1.json  # 旧版本迁移记录（如执行过）
  workspaces/<id>/AGENTS.md     # 当前工作区指令
  workspaces/<id>/sources/      # 每区独立的两份测试资料
  sessions/                    # 原有 Pi 原生会话文件，位置和 ID 不变
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

## 单次请求限制

| 配置 | 默认值 | 意义 |
| --- | --- | --- |
| REQUEST_TIMEOUT_MS | 120000 | 请求总时限，包含资源准备、模型与工具循环 |
| MAX_TOOL_CALLS | 8 | 工具尝试上限，模型请求最多为该值 + 1 |
| MAX_OUTPUT_TOKENS | 2048 | 每次模型输出上限；截断会明确提示 |
| LAB_DATA_DIR | .local | 服务端持久化目录，相对本工程目录 |

已有 `.env.local` 中的显式配置优先，不因升级覆盖。单工具时限为 5 秒；文件写入会等待结果确定，不放任超时写操作后台继续。通用指令上限 4 KiB、工作区指令 16 KiB、单 Skill 16 KiB、单份资料 32 KiB，均按 UTF-8 字节计算，超限报错。

DeepSeek Flash 显式关闭 thinking。真实验收不设置 10 条请求总量上限；上述限制针对每次请求。Pi 模型目录中的价格为占位值，不能当作实际费用。

工具为 source.list/read、instructions.read/update、skill.read；模型调用名称使用下划线，例如 source_read。默认任意文件／Shell 工具、扩展自动发现、自动压缩和自动重试保持关闭。

## 验证

```bash
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
# 以下命令调用真实模型并消耗额度
npm run probe:workspace
npm run probe:live -- --case C02
```

普通测试使用确定性模型流，实际运行 Pi 会话、工具和原生历史；浏览器回归使用受控 API 响应。`probe:workspace` 在独立临时目录执行迁移、真实 HTTP/SSE 模型调用、独立进程重启，以及真实 Chrome 页面保存与冲突处理，输出证据路径、请求结果和实际 token 用量，不使用用户当前会话目录。

macOS 优先使用已安装的 Chrome；其他环境需先准备 Playwright Chromium（例如 `npx playwright install chromium`）。真实探针保留临时目录用于核对，证据中的初始旧历史明确标记为合成测试数据。

官方依据：[Pi SDK v0.85.1](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/sdk.md)、[DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)。
