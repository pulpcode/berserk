# Research: Pi 文件工具与 Web 执行边界

- Query: 锁定 Pi 0.85.1 如何复用通用文件与 Shell 工具；对现有运行、子 Agent、历史的影响。
- Scope: internal；含随 npm 包发布的上游文档与实现。
- Date: 2026-09-18
- 状态：只读代码核验；未运行容器、修改功能或验证新的执行后端。

## Findings

### 文件与规格

以下 `LAB` 指 `experiments/harness-lab`，`PI` 指 `LAB/node_modules/@earendil-works/pi-coding-agent`；都是本地已核验路径。

| 文件 | 用途 |
| --- | --- |
| `LAB/package.json:26`、`PI/package.json:3` | 精确锁定并实际安装 0.85.1 |
| `PI/dist/index.d.ts:24` | 公开工具定义工厂、Operations、withFileMutationQueue 出口 |
| `PI/dist/core/sdk.d.ts:10` | createAgentSession 公开参数 |
| `PI/dist/core/tools/{read,write,edit,bash}.d.ts` | 文件和执行后端注入接口 |
| `PI/dist/core/tools/{read,write,edit,bash}.js` | 实际读写、取消、截断行为 |
| `PI/dist/core/tools/file-mutation-queue.js` | 进程内按文件串行写入 |
| `PI/dist/core/tools/output-accumulator.js` | Bash 完整输出落盘 |
| `PI/docs/security.md:31`、`PI/docs/containerization.md:5` | 官方隔离边界与部署模式 |
| `PI/examples/extensions/{ssh.ts,gondolin/index.ts}` | 官方远程／隔离工具路由示例 |
| `LAB/src/pi/lab.ts:339` | 当前每请求 Session、工具与资源快照组装 |
| `LAB/src/pi/roles.ts:8`、`LAB/src/pi/subagent-history.ts:35` | 子 Agent 权限与历史验证 |
| `LAB/src/resources/service.ts:26` | 现有 AGENTS.md 读取、CAS、快照 |
| `.trellis/spec/backend/harness-lab.md` | 必须保持的运行、历史、资源、停止、子 Agent 契约 |

### 1. 可以复用原生工具，不需要改造 Agent 循环

建议复用根包公开的 `createReadToolDefinition`、`createWriteToolDefinition`、`createEditToolDefinition`、`createBashToolDefinition`，把返回值放入 `createAgentSession({customTools, tools: names})`；每项的 `options.operations` 接入受控文件／执行后端。0.85.1 接收的是工具名数组 `tools?: string[]` 和 `ToolDefinition[]`，不要套用旧示例里不同版本的 SDK 签名。原生与自定义工具同名时，自定义定义覆盖原生定义（`PI/dist/core/agent-session.js:2119–2132`）；须测试有效工具表，防止误启用本地原生后端。

| 工厂／接口 | 已核验签名要点 |
| --- | --- |
| `createReadToolDefinition(cwd, {operations})` | `readFile(path): Promise<Buffer>`；`access(path)`；可选 `detectImageMimeType(path)` |
| `createWriteToolDefinition(cwd, {operations})` | `writeFile(path, content)`；`mkdir(dir)` |
| `createEditToolDefinition(cwd, {operations})` | `readFile`、`writeFile`、`access`；模型参数是 `{path, edits:[{oldText,newText}]}` |
| `createBashToolDefinition(cwd, {operations, exposeSessionEnvironment:false})` | `exec(command,cwd,{onData,signal,timeout,env}) -> Promise<{exitCode:number|null}>`；timeout 单位秒，可省略且原生无默认命令时限 |
| `createLsToolDefinition`、`createFindToolDefinition` | ls 的 exists/stat/readdir 和 find 的 exists/glob 可替换 |

重要接点：文件与 Bash 工具实际使用 `ctx?.cwd || 工厂 cwd`（read.js:56、edit.js:95、write.js:32、bash.js:157）。当前项目传给 AgentSession 的 cwd 是整个 `LAB_DATA_DIR`（lab.ts:378），只修改工厂 cwd 不够。应固定工作文件根和路径映射，显式处理上下文 cwd；不能暴露整个数据目录。

虚拟路径方案可行性：`createAgentSession` 的显式 cwd 优先于现有 SessionManager.getCwd，SDK 入口仅 resolve 该路径（sdk.js:67–74）。P0 首选验证 `cwd:'/workspace'`，同时显式传入现有 SessionManager、ModelRuntime、内存 SettingsManager、受控 ResourceLoader；工具 operations 闭包绑定服务端确定的任务／席位／workspace/request/container，不依赖模型提供宿主目录。路径仅解释为 `/workspace`（含上传文件的普通工作目录）、`/logs`（日志只读）等虚拟名字空间，真实宿主路径只留在宿主映射中。原生 system prompt 即使使用 customPrompt 也会追加 cwd（system-prompt.js:15–33），应保持模型提示与实际工具 cwd 一致。现有 JSONL header 不需要为了这个选择重写。

若完整 Session 使用虚拟 cwd 遇到 loader 兼容问题，可对工具定义 execute 包装，以 `{...ctx,cwd:'/workspace'}` 调用原定义，保留模型能力信息，同时同步模型提示中的 cwd；官方 Gondolin 示例采用 guest 工厂并不向底层 tool.execute 传宿主 ctx（index.ts:443–483）。仍需 P0 验证，不建议为了省事把所有宿主绝对路径透传到容器。原生 read 路径纠错和 mutation queue 会在宿主尝试 exists/realpath（path-utils.js:72、file-mutation-queue.js:11），这不是文件内容后端；虚拟 `/workspace` 不同项目可能共享队列 key，最多造成不必要串行，不能把它当作项目隔离凭据。

`grep` 是特殊项：0.85.1 的 GrepOperations 仅替换 isDirectory/readFile，搜索仍在宿主 `spawn(rg)`（grep.js:52、101）。不能写成“所有搜索都通过 operations 自动进入容器”。官方 Gondolin 示例也单独实现 grep（index.ts:511–513）。本期可先用 read/ls/find 加主 Agent 的受控 bash；是否增补独立 grep 属于实现选择。

### 2. cwd 不是隔离；Shell 后端必须另有运行边界

Pi 官方明确：没有内置 sandbox，工具具有 Pi 进程权限；支持整进程入容器，或宿主 Pi 将工具路由到隔离环境（security.md:33–48；containerization.md:5–18）。因此“指定 cwd”“路径前缀检查”“提示词约束”均不能限制任意 Shell 脚本。

与现有架构最相容的方向是保留宿主 Pi／API／模型凭证与原生 JSONL，只让任务脚本进入受控容器或其他真实隔离环境，仅挂载指定工作文件。Operations 是接入点，不提供隔离本身。可复用官方路由思路，不应直接照搬 SSH 示例作为生产取消、安全实现。

默认 Bash 会继承 `process.env`（utils/shell.js:115–125），并默认附加 PI_SESSION_FILE 等元数据（bash.js:119–145）。自定义后端必须构建自己的环境白名单，不把传入 env 原样传给任务进程；禁用 `exposeSessionEnvironment` 只关闭 PI_* 附加项，**不会自动清除宿主 API Key**。不能挂载模型设置、会话 JSONL、其他工作区、宿主凭证或容器控制 socket。

现有工作区的 AGENTS.md／固定 sources 可以继续留在受控资源目录；新增单独的工作文件目录最容易保持既有快照与 CAS。若挂载整个旧工作区为可写，则 bash 可以绕过 instructions_update 修改 AGENTS.md 和固定资料，既有受控写入契约就失效，必须明确重设计，而非无意发生。

### 3. 原生文件工具有有限的并发协调

0.85.1 的 **edit 与 write 已使用公开 withFileMutationQueue**（edit.js:96、write.js:34）。它是模块内 Map；现有路径用 realpath，路径不存在则用 resolve 后路径作为 key，在同一进程、同一工具模块实例内串行同文件 mutation（file-mutation-queue.js:3–50）。edit 在队列内重新读取当前内容、匹配唯一不重叠区域再写入；write 直接覆盖全文。匹配实现有换行／部分字符归一化与 fuzzy fallback，不是全文 hash CAS（edit-diff.js:136 起）。

这不是完整的跨会话并发控制：read→模型思考→write 不在同一临界区；write 不检查用户先前所见版本；bash、上传接口、外部程序、另一服务进程不参与队列。默认 writeFile 也不是项目现有 fsync＋rename 提交机制。不能宣称“Pi 完全没有协调”，也不能宣称“启用 Pi 工具即可防止丢更新”。

本期按用户选择允许同工作区会话并行，保留 Pi 原生工具行为，不增加工作区整轮互斥。跨会话同文件修改可能冲突；专门保护后置，不能假设只加 expectedHash 就能约束任意脚本。

### 4. 取消和超时：本地能力不能自动移植到容器

原生本地 Bash 在 Unix 下以 detached process group 启动，取消／timeout 调用 killProcessTree，尝试 `process.kill(-pid,'SIGKILL')`，失败回退单 PID；Windows 使用 taskkill /T。等待子进程结束后返回／抛错（bash.js:50–105；utils/shell.js:184–214）。这是常规进程组清理，不是对主动 setsid／逃离进程组后代的严格清理证明。

替换 BashOperations 后，取消与 timeout 的落实由新后端负责。杀掉宿主 docker exec／ssh CLI 不等于已清除远端或容器内后代；官方 SSH 示例只 child.kill（ssh.ts:81–109），不能作为严格保证。P0 必须验证脚本→子进程→后台进程的清理，终止结果未知时不能将该请求标为已停止或放行同会话下一请求。请求专属容器整体停止须验证进程退出与文件操作收敛，并确保不影响同工作区其他请求。

原生 edit/write 在每个 await 后检查取消，且保持 mutation queue 到在途文件调用结束；但若写已完成后观察到取消，仍可能抛出 aborted（edit.js:127–128、write.js:48–49）。停止不回滚文件；不能仅凭错误文本断言“未修改”。原生读写 Operations 没有 AbortSignal 参数，可由请求作用域闭包传递取消及等待收敛。

宿主现有 stop() 调用完整 session.abort()（lab.ts:209–216）；execute finally 等待 active.aborting（lab.ts:620–621）。应延续这个次序，把新后端清理纳入结算，不能增加会提前释放执行状态的 Promise.race。

### 5. Bash 截断与完整日志需要专门处理

原生 read 返回前 2,000 行／50 KiB；bash 返回尾部相同额度，阈值首先达到者生效（truncate.js:10–11）。这不是任务工具次数限制，也不是文件大小上限。

**完整 Bash 输出由运行工具的宿主 Node 在 os.tmpdir()/pi-bash-随机.log 写出**（output-accumulator.js:6–8、169–180），不是由 BashOperations.exec 的执行环境写出。仅替换 exec 为容器并不会迁移该日志。BashToolOptions 没有日志目录参数（bash.d.ts:57–68）。结果内容和 details.fullOutputPath、流式 onUpdate 都可能引用宿主临时路径（bash.js:168–174、220–233）。

若 read 只能访问任务目录，后续模型无法直接读取该宿主临时路径。P0 需验证宿主日志收集、受控持久路径映射、模型提示及前端下载的统一方案；不要开放整个宿主 /tmp 来兼容，也不要全局改 TMPDIR 影响并行请求。原生 JSONL 保存的是截断后的工具结果，**并不自动保存完整 Bash 输出正文**；日志丢失会导致无法回查原输出。

### 6. 文本、图像与二进制边界

原生 read 检测 jpg/png/gif/webp/bmp，并可默认缩放至最大 2000×2000；非图像直接 `Buffer.toString('utf-8')`（read.js:37、63–92；read.d.ts:30–34）。它不是 PDF、DOCX、XLSX 解码器；上传成功不能等同于“内容已被理解”。这类文件可先落盘，随后由脚本和环境已有解析库处理，具体首批支持格式需要明确验收。

当前模型若不支持 image，Pi 会给出图片不可输入的说明；图片可预览不代表模型可看懂（read.js:25–29、66–85）。文本 read 的 50 KiB 只限制输出；它先读完整 Buffer 再截断，上传和文件读取仍需实际资源限制，不能当作无限大文件读取已解决。

### 7. 与现有实现的结合

| 现有接点 | 需要保持／调整 |
| --- | --- |
| `lab.ts:339–398` | 工厂、cwd、工具 allowlist、后端与请求生命周期；AgentSession、controlled stream、默认压缩继续复用 |
| `lab.ts:352–360`、`resources/service.ts:66–77` | 保留受控 AGENTS 快照、关闭外部自动发现；工作文件按需读取，不把全部内容装入资源快照或 system prompt |
| `roles.ts:8–43`、`subagent-history.ts:35–46` | 可扩展只读工具名，如 read/ls/find；同时更新角色配置与历史 allowlist，保留旧记录兼容；子 Agent 不注册 write/edit/bash/subagent |
| `lab.ts:436–514` | 子 Agent 仍独立 Session／JSONL，仅父工具调用返回最终结果；同工作区文件可读不意味着获得父会话历史 |
| `lab.ts:265–280、594–605` | 当前公开历史仅投影 text；原生 edit.diff/patch、图片、Bash fullOutputPath、普通工具流式更新未展示。需要专门的安全 DTO／文件链接，而非把原生 details 直接公开 |
| `history-evidence.ts:31–75` | 新增 berserk.* 文件／附件记录时必须添加严格解码；原生普通工具消息无须自造业务成果记录 |
| `lab.ts:518–535` | 当前仅同一 Session 互斥，不是同一工作区互斥；本期沿用此范围，不新增工作区占用与排队机制 |

只读子 Agent 的可行范围是阅读文本、列目录、查找文件及使用既有资料工具；它无需 Bash 就可审阅主 Agent 生成的脚本、分析结果和文稿。不能授予任意 bash 再依靠提示词称其“只读”。独立 readonly 文件后端或只读挂载可加强权限约束；单纯注册只读工具并不能证明其 Operations 路径实现没有越界。

### External references（随安装包发布的主源）

- Pi 0.85.1 `docs/security.md`：工具权限、无内置 sandbox。
- Pi 0.85.1 `docs/containerization.md`：整进程隔离与宿主路由两种模式；Gondolin 示例。
- Pi 0.85.1 `docs/extensions.md:2115`、`examples/extensions/ssh.ts`：公开 operations 扩展模式；示例本身不是生产隔离／取消保证。
- Pi 0.85.1 `examples/extensions/gondolin/index.ts:445–513`：read/write/edit/bash/ls/find 路由，grep 单独实现。
- 结论以已安装精确版本为准，未据最新版网页推测 API；实现不得 deep-import 未公开的 OutputAccumulator 等内部模块。

## Caveats / Not Found

- 尚未验证 Docker／其他隔离后端在当前开发机与目标 Ubuntu 的可用性、运行成本、子进程清理、网络与资源边界；必须列为 P0 技术验证。
- 尚未验证原生 tool definition 在 SDK customTools 注册后的完整有效工具表、ctx.cwd 路由、日志路径重映射和跨平台行为；不能提前标记实现完成。
- 尚未确定首批二进制格式与 Python 库。通用文件落盘、下载能力和自动解析各格式是不同能力。
- 本研究没有改变上传交互、并发策略或业务流程范围；业务成果状态机不是本次能力接入的前置要求。
