# Research: 文件提交边界与现有 Pi HITL 的最小对接

- Query: 自然语言上报文件如何冻结待确认内容、复用现有确认、供接收席位读取，并避免中断造成重复提交；比较最小业务存储。
- Scope: mixed；只研究当前实现与本阶段新增边界，不实现代码、不更改运行服务。
- Date: 2026-09-19

## Findings

### 1. 结论

可以保留 Pi 0.85.1 的 AgentSession、工具循环、原生 JSONL、确认等待和中断续聊。新增能力应位于宿主业务服务：**固定文件副本、工作项与提交记录、席位授权、一次提交的事务校验**。普通文件的每次保存不生成业务版本；只有明确提交时保存固定内容。

建议本阶段用 **SQLite 保存少量业务元数据，文件字节保留在沙盒外的受控副本目录**。现有 JSONL 继续记录对话和工具结果，不作为跨席位业务状态库。无需通用 Run、后台作业队列、事务消息/outbox 或外部下发。

现有 `file_output` 是“提供固定文件下载”，并非“向另一席位提交”。保留其用途，增加明确的业务提交工具，不应让下载行为自动变成上报。

### 2. Files found / 可复用代码

以下相对路径均以仓库根目录为起点。

| 文件与行号 | 已有能力 / 对本阶段的意义 |
| --- | --- |
| `experiments/harness-lab/package.json:7`、`:30` | Node 24；Pi SDK 固定为 0.85.1，未使用数据库依赖 |
| `experiments/harness-lab/src/files/service.ts:228` | `FileService.publish` 校验 Session 归属，按 workspace/session/request/toolCallId 幂等，复制内容后保存固定下载记录 |
| `experiments/harness-lab/src/files/service.ts:213`、`:248` | 下载记录核验 workspace/taskSpace/seat；读取固定副本，不回退到源文件 |
| `experiments/harness-lab/src/files/safe-fs.py:22`、`:35`、`:80` | dir_fd、O_NOFOLLOW、普通文件/单硬链接校验；受控复制、大小限制和 SHA-256；复制完成 fsync 文件 |
| `experiments/harness-lab/src/resources/files.ts:51`、`:66` | 单文件原子替换与进程内 Mutex；并非多文件事务或跨进程锁 |
| `experiments/harness-lab/src/pi/file-tools.ts:99` | `file_output` 调用 publish，再追加 FILE_OUTPUT，最后返回原生工具结果 |
| `experiments/harness-lab/src/pi/lab.ts:438` | Pi 工具顺序执行；组合原有 before/after hooks，没有第二套工具循环 |
| `experiments/harness-lab/src/pi/lab.ts:441`、`:459`、`:474` | 参数校验后确认，批准后重验参数/停止状态；after hook 尽量保留实际执行结果 |
| `experiments/harness-lab/src/pi/lab.ts:791`、`:825` | JSONL 先保存确认请求和用户决定；重复同响应幂等；停止/旧请求校验已具备 |
| `experiments/harness-lab/src/pi/interactions.ts:34`、`:103`、`:115` | 严格 schema 与历史重放，当前只允许 bash / confirmation_demo 确认 |
| `experiments/harness-lab/src/pi/interactions.ts:185` | 重启后旧等待过期；有批准无工具结果投影为 unknown，不恢复执行 |
| `experiments/harness-lab/src/pi/history-evidence.ts:34`、`:103` | 从已有请求边界派生 interrupted；不会自动补结果或去重实际效果 |
| `experiments/harness-lab/src/workspaces/store.ts:87`、`:91`、`:98` | 当前服务端固定 seatId 限定工作区、Session 与目录访问 |
| `experiments/harness-lab/src/workspaces/store.ts:100` | 索引内存副本与磁盘不一致即拒绝写入；不能让多个席位 Store 随意共享索引并分别写入 |
| `experiments/harness-lab/src/execution/docker.ts:176` | 容器只挂本工作区与只读日志、无网络；业务 DB 和提交副本应继续留在挂载范围外 |
| `experiments/harness-lab/src/server/file-routes.ts:51`、`:63` | 当前内容预览与固定下载入口；前者重新复制当前源文件，不能直接用于待确认版本预览 |
| `experiments/harness-lab/src/web/InteractionCard.tsx:59`、`:62` | 已有操作描述、批准/拒绝、查询后再重试；待补固定文件预览和业务对象信息 |
| `experiments/harness-lab/tests/files/service.test.ts:52` | 已测试改写、删除、重启后下载字节不变，并验证外席位不能直接读取 |

### 3. 最小提交流程（设计建议，不是已有行为）

以单个工作项提交一份文件为例。工具名仅为示意，正式设计应统一命名。

1. Agent 调用 `workitem_submit({workItemId, path, expectedRevision})`。调用方席位、会话、工作区和工具调用 ID 由服务端执行上下文取得；不接受模型传入身份或 `approved=true`。
2. 宿主检查工作项属于本任务、本席位是承办方、工作区是该任务下本席位工作区、当前状态允许提交、版本未变化。接收席位从工作项派生。
3. 安全复制选中文件到私有固定副本，保存该副本的引用、名称、大小和 hash。**这个动作是准备待确认内容，并未向接收席位提交。**
4. 复用 beforeToolCall 的现有等待流程。卡片展示工作项、发送/接收席位、文件名与固定副本预览/下载入口，说明确认提交的是这里的副本。宿主生成的副本引用作为 `action` 的受控补充字段；`action.parameters` 仍严格等于原生工具参数，不篡改已保存工具调用来塞入 hash。
5. 用户批准后，现有停止/响应归属检查继续有效。工具实际执行还需核验同一确认、固定副本、当前席位权限、工作项 `expectedRevision` 与允许状态。不能只凭内存里出现一次 approved 就绕过业务校验。
6. 单个业务事务：登记提交记录及固定副本引用；把工作项从处理中改为待审核；递增工作项 revision；保存本次操作唯一键。该事务提交是**上报完成边界**。
7. 返回包含 submissionId、工作项和状态的原生工具结果。接收席位从业务列表/详情读取，不依赖发送会话是否最后生成成功回复。
8. 接收方接收或退回时，事务内同时记录本次提交的处理结果并更新工作项。退回意见关联这次 submissionId；再次提交产生新记录，原副本和意见保留。普通文件可继续修改，不锁成只读，也不因此自动生成新业务记录。

**文件变化的处理：** 确认之前/等待期间，源目录仍可自由编辑。确认预览和最终提交必须读取同一个已固定副本，批准时不重新复制源路径。用户要改提交内容，拒绝当前确认、修改文件后重新发起。这样不需要工作区整轮串行或全目录锁。

**现有复制的实际边界：** safe-fs 能保证安全打开受控文件并固定“本次复制获得的字节”，但不保证对正在被其他进程原地修改的大文件获得某一时刻的原子快照。不能把路径安全误称为全局文件事务。用户审阅的固定副本与实际提交字节一致即可实现本期确认语义；若将来要求复制过程也必须是原子文件系统快照，应另立需求。

**一份或多份文件：** 现有 publish 的幂等键不含 path。用同一工具调用 ID 循环 publish 多个文件会一直返回第一份。最小方案可先每次提交一份主文件；若本期要求文件集，需明确增加整组 manifest 与逐文件固定副本的一次准备接口，全部准备成功后才展示一张确认卡，不能误用现有循环。

### 4. HITL 需要补什么、不需要补什么

| 范围 | 建议 |
| --- | --- |
| Pi 内核 | 复用公开 customTools / extensions 和原有 hooks；不 fork Pi、不修改循环或原生 JSONL格式 |
| 工具允许列表 | 增加有限的业务工具，并同步扩展 policySchema、decodeInteraction 与严格历史校验；不要改成任意工具自动视为有权 |
| 操作策略 | 为业务提交设固定“必须确认”规则；来源是服务端业务代码，工具描述仅解释能力。现有 Bash 策略保持独立语义 |
| 确认内容 | 增加有类型的业务对象及固定副本字段，验证其与当前任务/工作项/席位/调用一致；保留 immutable 对比，不让 response 改目标、文件或接收人 |
| 确认等待 | 沿用当前请求内等待、停止、原生记录、失效机制；不引入可跨重启继续批准的持久等待 |
| 实际提交授权 | 业务服务只接受宿主授予的具体确认上下文和固定副本；若直接暴露普通 REST 提交入口，也必须经过相同权限与版本校验，不能接受调用方自报已批准 |
| afterToolCall | 保留原有 hook 和执行证据处理；实际业务回执先在业务事务里提交，再作为工具结果返回，不在 after hook 中才第一次创建业务事实 |
| 页面/模型成功依据 | 以业务查询到的 submissionId 和状态为准；不能只读聊天里“已提交”或原生回调 event。原生缺失结果仍是缺失结果，不伪造旧 toolResult |

当前确认数据已经持久保存于 Pi JSONL。为本阶段不必再建一套相同的持久确认状态机；业务提交记录只保存需要检索/约束的 interactionId、调用归属、提交人和固定内容引用即可。临时副本在确认取消或过期后不对接收席位公开，可先保留为审阅证据；自动垃圾回收不应成为本期前置工作。

原生 hooks 依据：安装包 `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:223` 将公开扩展 `tool_call` 接入 beforeToolCall，`:244` 将 `tool_result` 接入 afterToolCall。Axon 已组合这些 hook；新增业务逻辑必须继续保留组合顺序。

### 5. 中断、幂等与并发：具体缺口

现有 W01-7 只保证原会话可发新消息，**不会保证写操作不重复**；新请求/new toolCallId 可以再次调用同一业务动作。本阶段要补的是具体提交的约束，不是重做通用恢复。

| 中断位置 | 应有结果 |
| --- | --- |
| 固定副本创建后，确认记录前 | 只有私有孤立副本，没有提交；不扫描并自动发送 |
| 等待确认时 | 旧卡按现有规则过期；重发必须新确认 |
| 已批准、业务事务尚未提交 | 没有 submission 记录；旧批准不自动续执行 |
| 业务事务已经提交、Pi 工具结果尚未保存 | 业务列表能查询到已提交记录；旧会话可显示结果缺失，但不得重做已提交动作 |
| 退回/接收已经提交、HTTP 响应丢失 | 先查询当前 revision 和处理结果；同操作唯一键返回原结果，不重复产生处理意见 |

最小约束建议：

- 用服务端生成的 operationId（可直接复用确认 interactionId）作为提交事务唯一键，同时保存 workspace/session/request/toolCallId。重复同操作返回原回执；若同键却参数或固定内容不一致，拒绝。
- 工作项的 `expectedRevision` + 状态更新参与同一事务，两个会话同时提交同一工作项只有一个成功；另一个提示工作项已变化，返回/查询最新提交。这只串行业务提交，不限制普通对话和文件写入。
- 新请求丢失旧 operationId 时，仍不能只靠 toolCallId 去重。若工作项已经待审核，则拒绝再次提交并提供当前 submissionId；Agent 先查工作项。接收/退回同样校验当前 submissionId，防止处理旧版本。
- 不以文件 hash 作为永久唯一业务键：退回后可能合理地再次提交同样字节。新 revision/新提交轮次可以有新记录，需新的明确确认。
- 业务查询故障时不可推测“未提交”并重试；显示/返回无法确认。业务 DB 已提交而 JSONL 写失败，不回滚上报、不补造原生记录；保持现有持久化故障保护，任务详情仍可核对真实回执。

### 6. 跨席位读取与存储取舍

**读取边界：** 当前 `WorkspaceStore.get` 和 `FileService.openDownload` 正确地拒绝其他席位。应增加“读取获准提交”的业务入口：先按当前主体核验其为提交方/接收方和任务参与者，再由宿主按记录打开固定副本。接收者没有源席位的目录列表、原文件路径访问、AGENTS.md 或 Session 读取权。

不要为方便读取把源席位目录挂给接收者。若接收 Agent 需要解析 PDF/脚本处理，可提供显式“复制这份已提交文件到我的工作目录”，来源必须是已获准 submissionId，由宿主安全安装为新的普通文件，重名不覆盖；这不会修改原提交副本。是否本期提供该动作需在主设计中确定，不能仅有 Web 下载却声称 Agent 已可按 Pi 文件工具处理。

**身份前提：** 当前 PiLab/WorkspaceStore 绑定服务端固定 seatId。浏览器任意提交 seatId 不能成为权限凭据；两测试席位可在明确演示模式下切换，但不能表述为真实用户鉴权。两套 Store 直接共享 workspace-index.json 会发生内存副本过期问题；应由单一宿主索引管理访问，不通过放宽磁盘一致性检查解决。

| 方案 | 优点 | 具体代价 / 限制 |
| --- | --- | --- |
| SQLite 元数据 + 受控固定副本（建议） | 工作项状态、submission、处理结果和幂等键在一个事务内；索引查询、唯一约束和外键无需自研 | 引入一个很小的业务 DB；副本先保存、DB后引用，二者不是跨文件原子事务；可留下未引用副本，但不能出现已提交记录指向未完成复制 |
| 单个受控 JSON 业务文件 + 固定副本 | 复用 atomicWrite；少量数据和单进程可将整份业务状态作为一个提交单元 | 所有变更重写整文件，需上限、严格加载和全局写锁；无法直接套用目前各 Store 独立缓存；不适合多实例共同写 |
| 每任务/每提交分别 JSON | 文件直观，局部读取简单 | 状态和提交记录跨文件；必须自己设计恢复/提交协议才能避免一半成功，本阶段不推荐 |
| 把业务状态放入 Pi JSONL | 少建一个存储 | 两席位检索要跨会话重放，事务/唯一性/当前态缺失；与 Pi 对话压缩边界耦合，本阶段不推荐 |

SQLite 建议只持久化小元数据，文件复制/预览/模型等待全部在事务外。一次同步短事务完成校验与变更，不持有数据库事务等待人确认。无需 ORM、连接池、分布式锁或默认开启 WAL；单实例先使用简单事务即可。

`node:sqlite` 在已部署 Node 24.14.0 中无需实验开关，有 `DatabaseSync`、预编译语句、默认外键约束；但该版本文档仍标为 Stability 1.1 / Active development，API 同步执行。应在设计中明确接受这一驱动成熟度，不能写成已稳定多年。项目当前只保证 Node 24 大版本，不应无核对地依赖 24.14 才加入的选项。若不接受实验 API，应单独选定成熟 SQLite 驱动，不能把这个选择默默跳过。

SQLite 事务不能替代文件副本的落盘。现有 safe-fs 对内容文件 fsync，atomicWrite 对临时记录 fsync 后 rename，但没有给所有新增目录显式 fsync。若本期承诺覆盖突然断电而不只是进程 SIGKILL，需要同步明确副本目录落盘规则，并做对应验证；不要把已有进程重启测试当作断电持久性证据。停服备份整个 LAB_DATA_DIR 最容易同时保留 DB、固定副本和 Pi 历史。

### 7. Related specs / 外部依据 / 待审项

相关已实现规范：

- `.trellis/spec/backend/files-execution.md`：普通文件、席位目录、固定下载、安全文件访问和沙盒边界。
- `.trellis/spec/backend/hitl.md`：请求内确认、原生交互记录、批准与执行的区别、重启过期。
- `.trellis/spec/backend/harness-lab.md:103`：最小中断续聊；`:107` 明确新模型调用可重复旧动作，现有能力不去重效果。
- `docs/mvp/design.md:65`：席位工作项与计算 Subagent 的职责不同；`:108` 明确固定业务按钮不再叠加无意义二次确认；`:199` 普通文件无需先登记成果。
- `.trellis/spec/backend/database-guidelines.md` 当前为占位规范，不代表项目已选定 ORM/数据库方案。

外部参考（2026-09-19 核验）：

- [Node.js 24.14.0 SQLite 文档](https://nodejs.org/download/release/v24.14.0/docs/api/sqlite.html)：版本稳定性、同步 API、foreign keys、timeout 与预编译语句。
- [SQLite Transaction](https://www.sqlite.org/lang_transaction.html)：事务与同一时间一个写事务，适合本阶段小量业务状态变更；不为跨文件系统或外部系统提供事务。
- [SQLite Atomic Commit](https://www.sqlite.org/atomiccommit.html)：原子提交依赖 journal、锁和落盘假设；不能将自行维护多个 JSON 文件视为等价替代。

主设计仍需明确、供用户审阅：

1. 每次提交单文件还是文件集；建议首期单文件，不影响 Agent 自由生成中间产物。
2. 接收席位仅预览/下载，还是包含显式复制入自己的工作目录以供 Agent 处理；后者需要受控导入入口。
3. SQLite（含 node:sqlite API 状态）或单文件 JSON；建议 SQLite，范围仅工作项与提交元数据。
4. 工作项的发起方/承办方/接收方权限与两测试席位的选择方式；真实登录可后置，但身份不能由工具参数决定。
5. 接收、退回可用明确页面按钮作为用户动作，Agent 代办则确认；避免两条入口对同一业务产生不同校验规则。

## Caveats / Not Found

- 尚无业务任务、工作项、跨席位 submission store 或数据库实现，本文件提出的是最小新增设计，不是 Pi 原生已经具备的业务能力。
- 未读取密钥、连接服务器、运行外部写操作或修改任何产品代码。
- 未承诺任意共享目录并发写无冲突；上述事务仅保护业务提交/审核转换。
- 现有文件下载读取会检查受控路径、普通文件和大小，并非每次下载重新算 hash；业务方案如要求完整性校验应明确对固定副本的策略，不误称已有逐次 hash 校验。
- 单实例是建议 SQLite 集成和受控索引写入的当前部署前提；多服务共用数据目录需要另行设计，不在本阶段展开。
