# Research: BUG-002 后台文件检查与现有保护

- Query: 按 reliability-2026-10-15/source-plan.md 的 P0—P1 核实原固定命令、后台工具拒绝、失败投递、元数据及 B01—B03 覆盖；不预设新增 inspect_files。
- Scope: internal；当前本地源码、测试、历史任务及主代理导出的 Git patch。
- Date: 2026-10-15

## Findings

### 结论

BUG-002 的已知故障链已经有业务代码修复，不能按仍未修复设计第二套能力。当前原完整命令实测为 `allow / shell.ordinary / axon-bash-v2`。后台 `ask` 是未执行的 Pi 工具错误，可继续原生循环；基础设施失败仍终止请求。推荐本轮复用现有实现、保护已有测试，补齐验收证据，不改命令白名单、不新建 inspect_files。

剩余的直接验证缺口是 **真实沙盒执行原命令后的 MD5、SHA-256、行数和字节数**：现有后台集成的 DockerRunner 替身只返回 `OK`；历史服务器发布检查也明确只运行策略判定。手动复测证明某次真实后台完成并投递，不等于记录了原完整命令每项计算正确。

### 文件与规格索引

以下源码／测试路径均相对 `experiments/harness-lab/`：

| 文件 | 职责／证据 |
| --- | --- |
| `src/execution/command-policy.ts` | tree-sitter 语法分析、v2 allow/ask/deny、整链优先级 |
| `src/pi/lab.ts` | 原生工具注册、最终参数策略钩子、后台拒绝与技术失败 |
| `src/pi/file-tools.ts` | Pi 原生工厂适配、模式说明、Bash 到沙盒执行与日志 |
| `src/pi/background-runner.ts` | 两种后台模式复用 Pi，读取持久化结果 |
| `src/background/service.ts` | 固定输入、结果核验、失败终态、投递复核 |
| `src/background/store.ts` | 成功与 pending delivery 同事务落库 |
| `src/pi/file-history.ts` | 模型可见文件引用：path/name/size/hash |
| `src/background/files.ts`、`src/collaboration/files.ts`、`src/files/safe-fs.py` | 固定字节、SHA-256、大小、锚定文件操作 |
| `src/execution/docker.ts`、`execution-image/command.py` | 隔离执行、固定 cwd、真实 Bash 与进程清理 |
| `tests/execution/command-policy.test.ts` | 只判定，不执行样例 |
| `tests/pi/background-runner.test.ts` | 原生 Pi + 确定性 provider + fake Docker |
| `tests/background/service.test.ts`、`tests/background/store.test.ts` | 投递归属、技术失败、事务与取消 |
| `scripts/probe-execution.ts`、`scripts/probe-background.ts` | 真实 Docker 探针；后者还需真实模型，未在本轮运行 |

已读 `.trellis/workflow.md`、`.trellis/spec/backend/index.md`、`files-execution.md`、`background-execution.md`、`hitl.md`、`quality-guidelines.md`。有效契约主要在前三份具体后端规格；通用 quality-guidelines 仍含占位内容。历史依据为 `.trellis/tasks/09-23-background-handoff-board/{design,verification,issues}.md` 及其 `research/{runtime-basis,issue-review,deployment,manual-retest-04}`。未读取 implement.jsonl/check.jsonl。

### 原故障与提交演进

| 问题／提交 | 实际变化 | 当前结论 |
| --- | --- | --- |
| `683331b1507ade5206a4c377a63cc0dc339dd58d`，2026-09-18，实现 Web 提问、操作确认与命令规则 | 新增 v1 策略，literal 拒绝未引用 glob，所有 cd/pushd/popd 待审；已含危险命令、脚本不审计、解析失败回归 | 是原误拦的策略前提；不是 Pi 强制要求审批 |
| `baaedbabb46eb5647d56e51dc2550d7acd39bae6`，2026-09-22，实现信息处理中心、后台预处理与多席位投递 | 主代理历史清单给出后台引入提交；本研究未读其完整 diff | 不单凭提交标题断言每行引入归属；旧后台 stop 分支由下述 c14ec42 删除 diff 直接证实 |
| `047ab63e7b78d0767f667836ddc021e274b7a5a0`，2026-09-22，完善文件交接说明与附件展示，记录三项待解决缺陷 | 所提供源码 diff 主要为说明与展示；后台提示仍说需批准命令停止后接手 | 不是 BUG-002 执行机制修复 |
| `c14ec42b8acadfc42f0a209ea654edda99503d0d`，2026-09-23，修复工作交接确认与后台工具反馈，完善信息处理看板 | 策略升 v2，新增有限 glob／同目录 cd；删后台 `stop('failure', HUMAN_ACTION_REQUIRED)` 与 terminate；新增原完整链、未知语法、整链危险后缀、两种后台模式及 parser failure 测试 | 是实质代码和回归修复，不是仅 prompt 修订；当前源码仍保留 |

提交证据来自主代理已导出的 `.local/handoff-reliability-20261015/{relevant-history.txt,683331b.patch,047ab63.patch,c14ec42.patch}`，本研究未运行 Git。c14ec42 patch 的 45—115 行为策略 diff，332—336 行为后台终止改工具拒绝，349—501 行为相应测试 diff。临时 patch 不应作为长期唯一证据，稳定标识为上述完整提交号。

原问题记录 `.trellis/tasks/09-22-handoff-attachment-integrity/bugs.md:54` 明确：命令执行前命中 v1 `shell.review`，后台 `HUMAN_ACTION_REQUIRED`，原作业没有成功投递。该文件 :86 已记修复部署。历史发布 `09-23-background-handoff-board/verification.md` 明确源码尚未提交，且服务器检查只调用策略、没有执行检查命令；不能把其发布时点简单等同后来 c14ec42 提交。

### 当前真实调用链与安全边界

1. `src/background/service.ts:690` 导入来源固定副本到独立 job/files；文件引用带 `size/hash`（:698）。席位分析复核身份、项目和信息来源，再 resolveInputs（:701）。
2. `src/pi/background-runner.ts:53` 通过 `lab.start(...,{background:true})` 执行席位分析；:66 通过 `startPreprocess` 执行预处理。完成后重读原生历史（:63、:74），recoveryWarning 拒绝成功（:37）。
3. `src/pi/lab.ts:742` 注册已有文件工具；后台不注册协作写工具／AskUser（:744、:761）。`src/pi/file-tools.ts:37` 复用 Pi Bash 工厂并固定 `/workspace`，:38—46 将后台不能等待审批写入实际工具描述，而非只改未被自定义系统提示采用的 promptGuidelines。
4. `src/pi/lab.ts:773` 先调用原 beforeToolCall，再检查最终参数；:801 判定原命令；:803 先写原生策略记录；deny :806 返回 block，allow :807 放行，后台 ask :808 返回 block+原因，无 terminate、无确认卡。未知基础设施异常 :824—826 走宿主 stop 并 terminate，避免异常仅变成可恢复工具错误。
5. `src/pi/file-tools.ts:70` 原命令交给 sandbox.exec；`src/execution/docker.ts:228` 只接收 `/workspace` cwd，:238 通过容器监督器执行；`execution-image/command.py:43—46` 使用固定环境与 `/bin/bash --noprofile --norc -c`，没有宿主 fallback。
6. `src/execution/docker.ts:175—181` 保持无网络、只读系统、非 root、无能力、资源限制，只挂本请求工作区和只读日志。命令策略是入口检查，不是脚本效果审计；Python/Node 文件脚本与 write/edit 仍可修改工作区，不能声称“rm 要审，所以所有等效删除都要审”。历史 PERM-001 已明确后置该更大权限需求。

受限语法的具体范围：`command-policy.ts:47` 仅 word basename、含 * 或 ?、不以 - 开头、字符限 Unicode 字母数字及 `._*?-`；:12 仅 ls/md5sum/sha256sum/wc；:77 仅字面量 `cd /workspace` 或 `cd .`；:111 非预期 cwd 待审；:110、:115—117 整链取 deny > ask > allow。目录 glob、变量、替换、未知 shell 语法仍待审。检查不做真实 glob 展开，不运行 Shell。由实际 Bash 解析与容器执行产生最终结果。

### 本轮只读诊断

在 `experiments/harness-lab` 用 `node --import tsx --input-type=module` 导入当前 `evaluateCommand` 并输出五个固定字符串的判定，退出码 0；未执行这些命令、未调用模型：

| 固定输入 | 实际结果 |
| --- | --- |
| `cd /workspace && ls -la && echo "---HASH---" && md5sum *.md && sha256sum *.md && echo "---WC---" && wc -l -c *.md` | allow / shell.ordinary / axon-bash-v2 |
| `cd /workspace && ls *.md && rm original.md` | ask / shell.modify |
| `cd /workspace && ls *.md && sudo ls` | deny / shell.environment |
| `cd /tmp && ls *.md` | ask / shell.review |
| `ls "$FILES"` | ask / shell.review |

### 失败不投递与“执行完成”的准确含义

- `src/pi/lab.ts:1154—1160` 后台必须有正常结束的最终正文，工具调用尾部／错误／无正文不是成功。
- `src/background/service.ts:720—745` 核对 requestId、最终正文引用、固定 output 字节；失败、取消、中断不生成成功 result。`src/background/store.ts:365—385` 只有 `succeeded && preprocess` 在事务中插入 pending delivery。
- `src/background/service.ts:518—536` 实际送达前再次检查 job 成功、来源／席位权限、原生结果引用、原输入和输出固定字节，并在异步核验后重查权限。
- `ask/deny` 拦住一个工具并不自动令整个 job failed。Agent 正常回复“无法完成”仍可为 succeeded 并投递，这是当前已批准产品语义；不能把 B03 偷换成“出现任意工具错误都不投递”。失败作业不投递，不等于所有不能达到业务目标的答复均不投递。
- `tests/background/service.test.ts:332—357` 明确覆盖受阻后的说明投递，以及该作业重处理遇 provider error 后 failed/0 deliveries；旧成功投递仍按旧 jobId 保留。:376 覆盖原文或原生证据损坏时不能标 delivered。`tests/background/store.test.ts:112` 成功／投递事务回滚；:138 取消优先且不产生 delivery。

### 文件元数据是否已足够

`src/contracts/files.ts:1` 的 FileRef 已有 path/name/size/hash；`src/pi/file-history.ts:19` 直接把完整引用 JSON 作为模型文本；`src/pi/lab.ts:1091` 以原生 custom message 发送。`src/background/files.ts:91—102` 上传期间基于实际字节计算 SHA-256 和大小；`src/collaboration/files.ts:44—68` 复用固定副本与验证；`src/files/safe-fs.py:80—103` 在同一锚定打开文件上复制／统计实际字节／计算 SHA-256。

因此，证明收到的固定资料身份、字节数和 SHA-256 已有能力，无需再跑 MD5/SHA/wc 才能保证交接完整性。元数据没有 MD5、行数，也不代表后来修改过的可写工作区仍是相同字节；若业务明确需要当前文件行数／MD5，已有获准 Bash 链可用。未找到“修订值班交接说明”必须计算 MD5 或 wc 的业务要求，不能把模型自行检查步骤认定为新工具需求。此证据只支持“不必新建 inspect_files”，不支持删除已有工具或修改模型语义目标。

### B01—B03 覆盖与最小补测

| 编号 | 现有覆盖与证据强度 | 缺口／建议 |
| --- | --- | --- |
| B01 原固定命令 | `tests/execution/command-policy.test.ts:16—21` 原样策略回归；:64 整链后缀；`tests/pi/background-runner.test.ts:125—146` 在 preprocess、seat_analysis 中经过真实 Pi hook，记录 allow/succeeded、无交互；本轮直接判定成功 | 已有确定性覆盖，勿再制造“原命令仍 ask”红测。runner :24—28 只捕获 command 并输出 OK，不能称原 Bash 真执行 |
| B02 获准能力结果正确且后台完成 | 元数据来自真实 bytes；上述后台测试证明允许链到执行器。历史复测04记录 succeeded/delivered；`scripts/probe-background.ts` 默认工作流真实 Python 处理，但未固定执行本命令 | 需要真实隔离 Docker + 固定工具脚本（确定性 provider），核对 MD5/SHA-256/wc 实际 stdout、exitCode、native toolResult、job 终态；无 Docker 时记未执行，不能 fake pass |
| B03 仍受控／失败不成功投递 | `background-runner.test.ts:78` 两模式 ask 未执行、模型可见 isError、继续 source_read、重启保留证据；:125 deny 不到 runner；:148 parser failure failed、无下一轮；service/store 上述失败与取消不投递 | 最小可选增强：`tests/background/service.test.ts` 注入 parser throw，走完整 admission→Pi hook→job failed→deliveries=[]，断言无确认、无 Bash 执行、无 provider 下一轮。这补跨层连接，不改变行为 |

优先补测位置：复用 `tests/pi/background-runner.test.ts` 的确定性工具序列与 `scripts/probe-execution.ts` 的真实 Docker 初始化，增加明确选择的无真实模型验收入口；不在默认单测里悄悄依赖 Docker，也不调用现有付费 `probe:background` 来充当本轮确定性测试。固定两份 Markdown，包含 Unicode／空格名、空文件、末尾无换行；MD5/SHA 用 fixture bytes 的独立计算为预期，wc -l 固定为 LF 字节数、wc -c 为字节数，检查每文件与 total，附无关 .txt 证明 glob 范围。再保留一例无匹配文件的非零工具结果，不能误报统计成功。可在两模式参数化运行；preprocess 经服务到 delivery，seat_analysis 不应新增预处理 delivery。

不要为了满足 P4 候选工具验收清单给现有自由 Bash 添加一套未获审阅的文件数／行数限制。符号链接／跨范围安全继续复用既有 safe-fs 与 Docker 隔离测试；如果改为新检查工具才需要为新入口独立建立边界，目前没有该修改依据。

### External references / versions

无新增外部检索；以本地锁定依赖及已安装运行时适配代码为证据。`package.json` 固定 Pi `@earendil-works/pi-ai` / `pi-coding-agent` 0.85.1、tree-sitter / tree-sitter-bash 0.25.1，当前策略版本 `axon-bash-v2`。本轮未升级依赖、未访问生产、未运行真实模型、未改业务或测试代码。

## Caveats / Not Found

- 本研究仅执行策略函数只读诊断；完整基线测试与新增测试由主代理统一记录。主代理补充：本机 Docker CLI 存在，但 `docker info` 退出 1，无法连接守护进程；没有启动宿主全局服务或访问生产，B02 真实容器计算未执行。没有把历史 527 项单测／103 项浏览器结果当成本轮测试通过。
- 历史 manual-retest-04.json 只给 job/delivery 终态，没有原固定命令的 stdout 或统计值；deployment.json 的 allow 只是策略检查，不是实执行。
- “普通命令允许”不代表只读、成功、语义正确或完整权限沙箱；已知跨工具效果控制是历史 PERM-001 后续设计范围。
- 当前审计没有证实新增文件能力缺口；B02 的不足首先是验证证据缺口。未经新证据，不应把它改写成必须实现 inspect_files。
