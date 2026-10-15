# Research: BUG-001 附件选择与实际交接审计

- Query: P0—P1 核对当前附件选择契约、确认实际 files、固定副本→数据库→接收方导入、历史兼容和 C07—C08/A01—A04 覆盖；不修改业务实现。
- Scope: internal
- Date: 2026-10-15
- 方法: 只读源码、既有测试和任务材料。主代理统一运行 baseline；本文的“已覆盖”表示找到测试断言，不等同于本轮已经运行通过。未运行真实模型、Docker 或生产验证。

## Findings

### 结论

当前新 Agent `assign` 已要求显式 `inputPaths`，遗漏不再静默变成零附件；`[]` 仍合法。实际文件列表已经贯穿确认卡、业务输入和成功工具回执；进入办理会话时宿主已经自动导入接收方输入。这些不是 P2—P3 需要重新建设的能力。原 BUG-001 的自然语言选片可靠性仍未关闭：必填无法证明 `[]`、少选或多选符合用户意图，历史真实模型记录也存在额外澄清导致未执行的情况。

### Files found

以下源码/测试路径以 `experiments/harness-lab/` 为根；行号为本次读取时定位。

| 文件 | 职责 |
|---|---|
| `src/contracts/collaboration.ts` | 新调用严格 schema、页面/存储/历史兼容 schema、文件/回执类型 |
| `src/pi/collaboration-tools.ts` | 宿主补入任务/工作区、原生工作工具、实际成功回执 |
| `src/pi/lab.ts` | beforeToolCall 准备和确认、会话自动导入、模型工作区说明 |
| `src/pi/interactions.ts` | 历史 action 与旧 commit 确认的兼容解码 |
| `src/collaboration/service.ts` | prepare/commit、SQLite 业务与文件关联、权限和导入入口 |
| `src/collaboration/files.ts` | 固定副本冻结、大小/hash 校验、导入 helper |
| `src/collaboration/safe-import.py` | anchored 路径、临时文件校验、无覆盖发布和相同内容复用 |
| `src/files/safe-fs.py` | 源文件安全打开、复制和摘要 |
| `src/web/HandoffFiles.tsx`, `InteractionCard.tsx`, `WorkInbox.tsx` | 两种确认入口、实际附件列表、预览和接收方文件入口 |
| `tests/collaboration/service.test.ts`, `tests/pi/collaboration.test.ts` | 固定副本/隔离/兼容/完整 Pi 循环与自动导入断言 |
| `tests/e2e/handoff.spec.ts`, `tests/e2e/hitl.spec.ts` | 真实本地服务浏览器链路、mock 交互卡展示 |
| `tests/access.test.ts` | 正式身份、公共任务分派、第三席位拒绝及归档阻挡 |

### 1. 新调用、缺省与空数组

- `contracts/collaboration.ts:30–37` 保留 `workPrepareSchema` 的 optional `inputPaths`。`pageWorkPrepareSchema:62` 复用它；`service.ts:67` 用它校验存储历史。这是兼容边界，不是新 Agent 遗漏漏洞。
- `contracts/collaboration.ts:40–59` 单独定义 historical/new schemas；新 `workActionSchema` 在 `:52` 用 `Type.Array`，没有 Optional；`maxItems=100`，服务层实际配置上限默认 20 (`service.ts:187`)。没有 `minItems`，因此 `[]` 有意合法。
- `pi/collaboration-tools.ts:27–36` 再用新 schema 检查参数，复制 DTO 并固定 taskSpace/workspace，逐项将 `/workspace/` 转为相对路径。原生参数/历史不改写。
- `pi/lab.ts:784–798` 仅在 `scopedWorkAction` 与 `service.prepare` 成功后生成 handoff，`recoverableWorkError` 返回可纠正工具错误，未生成确认卡。
- `pi/interactions.ts:113–120` 用 `historicalWorkActionToolSchema` 解码旧 action，旧 `work_item_commit` 继续按 `{operationId}` 验证。旧 prepare/commit 不再注册供新调用执行 (`collaboration-tools.ts:56–88`)。
- `tests/pi/collaboration.test.ts:201–215` 覆盖遗漏→工具错误→纠正为 `[]` 或单文件；仅一次 prepare/卡片，批准前没有工作，批准后 inputFiles 等于 handoff files。`:336–396` 分别覆盖旧 prepare/commit 和省略 inputPaths 的旧 action 在 completed/waiting/approved 下刷新重启，历史文件不改写、旧授权不复用。
- 旧页面省略形式由 `tests/collaboration/service.test.ts:63–72` 等实际准备/提交覆盖，不能收紧共享 schema 来再次“修复”新 Agent 契约。

### 2. 确认副本、数据库与成功回执

1. `service.ts:210` 深复制调用输入；`:227–230` 只遍历 `inputPaths ?? []`，安全路径去重后调用 freeze。`goal` 不参与文件选择。
2. `files.ts:44–47` 保存到私有 `collaboration/files/<fileId>/content`；`safe-fs.py:13–48,80–105` 拒绝 traversal、符号链接、非普通文件和多 hardlink，bounded copy/hash，并 fsync。无关文件没有被遍历或复制。
3. `service.ts:239–245` 从实际 records 构造 `WorkAction.files`，短事务保存 actions/files。准备失败不保存成功 action；已经写入但未发布的私有副本可能残留，不能把它描述为交接成功。
4. `contracts/collaboration.ts:75–77` 直接投影 action.files 到确认；`pi/lab.ts:798–813` 采用这一结果。UI 的 `HandoffFiles.tsx:13–14,32` 展示真实数量/名称/大小/查看下载；`InteractionCard.tsx:89–92` 与 `WorkInbox.tsx:199` 把它放在说明之前。`WorkInbox.tsx:190` 显示接收方实际输入/零附件状态。
5. `service.ts:282` 在 commit 前重新校验固定 bytes；`:288–321` 事务内再次验证输入/版本/授权，把实际 files IDs 写进 work，并把 files 关联 work，最后保存 receipt。没有重新读取源路径内容，也不会解析目标文字补附件。
6. `pi/collaboration-tools.ts:75–77` 从同一准备单取 files，等待 commitAgent 返回，再返回 `{...receipt, committed: true, files}`。这是工具输出投影，不是新增数据库字段或第二份复制。

### 3. 接收方到位、损坏和冲突边界

- `pi/lab.ts:360–368` 新建有关联工作的会话先检查任务，再自动导入，导入成功才创建原生会话；`:455–468` 关联已有会话先绑定，再逐个导入，仅 assignee 执行。creator 不会自动导入接收方输入；不调用模型。
- `WorkInbox.tsx:160–175` 已关联会话的“进入对话”也调用 binding endpoint，因此可重试导入；错误进入现有页面错误区域。直接从侧栏打开已有普通聊天不是这一入口，不能声称每次打开任意聊天都自动补文件。
- `service.ts:327–343` 已提交文件经 work participant 校验；导入检查目标 workspace 的 seat 与 task。默认路径是 `收到资料/<workId>/<fileId>/<name>`，同名但不同 fileId 不发生 basename 覆盖。显式目标路径或同一 fileId 已修改才触发冲突保护。
- `files.ts:49–68` 在 commit、download、import 使用前校验文件类型、单链接、size、SHA-256。固定副本不存在会拒绝；损坏不会回退复制当前源文件。import 在调用 Python 前就 assertValid；Python 在 `safe-import.py:31–46` 再对实际复制字节校验 expectedHash，随后 `:50–68` 原子无覆盖 link，同内容复用，不同内容报 FILE_EXISTS。
- 当前启动 `service.ts:56–104` 校验数据库结构/引用，没有扫描所有固定文件的 bytes；`read/getAction` 返回元数据也不读取 bytes。因此副本缺失/损坏最早在下一次 commit/preview/download/import 使用检查发现，不能写成“启动或打开详情即检测”。已提交 receipt 保留属于历史业务事实，不等于每个固定副本永久可用。
- 多文件自动导入按顺序执行，没有全组回滚。后一个失败时前面正确导入的文件可保留；已有会话 binding 也已持久化，但 API 不返回成功。修复后重试可复用前面的相同内容。这符合当前逐文件幂等模式，不建议为了假设需求另建导入状态机或删除已完成文件。
- 权限变化需分开写：prepare 与 commit 的 `validateInput` 重检在 `service.ts:220,233,292`；当前 recipient 启用状态在 `:183`；import 的 task/seat/participant 校验在 `:335–342`。本轮另一审计负责外层授权及 receipt/getAction 早返回，不据上述局部代码宣称整个 C08 权限链已无缺口。

### 4. 现有测试映射与最小补测

| 编号 | 已找到断言 | 剩余/最小建议 |
|---|---|---|
| C07 准备后源文件变化 | Pi `collaboration.test.ts:78–115` 卡片后改源，批准后仍旧 bytes；导入 hash 等于卡片。服务 `service.test.ts:31–61`、浏览器 `handoff.spec.ts:67–126` 还覆盖 submit 源变化和两版成果。 | 复用；不新建 snapshot 机制。 |
| C08 固定副本缺失/损坏 | `service.test.ts:137–142` 改坏固定 bytes 后 commit 和 download 均拒绝，工作为空。 | 增加 missing/corrupt 参数化：prepare 后删除/损坏固定 content，commit 拒绝、receipt 不出现、无工作；已有 corrupt 用例可扩展。再补已提交后删除/损坏，receiver import/createSession 拒绝、目标无错误内容、不调用模型。 |
| C08 权限变化 | `access.test.ts:218–230` private 拒绝、第三席位详情拒绝、prepare 和 work 存在时归档拒绝；`:232–236` session 撤销检查。 | 不是等待确认期间的权限切换完整覆盖。由确认/权限审计给出具体可达场景，不通过直接写 DB 伪造不受支持的产品转换来宣称真实生命周期漏洞。 |
| A01 两份与无关文件 | Pi `:81–87` 三源文件只选两份，`:110–115` 每份 receiver bytes/hash。服务 `:31–40` 双文件固定副本。 | 已有有力确定性覆盖；真实语义选片另测。 |
| A02 单附件/纯文字/遗漏 | Pi `:201–215` 全覆盖；service `:63–72` 覆盖兼容省略；browser `handoff.spec.ts:217–241` 说明声称两份而真实零附件。 | 复用；不要让旧 page/历史也强制字段。 |
| A03 越界/符号链接/跨席位项目 | service `:113–136,174–184`；Pi `:228–240` 卡片前拒绝；`access.test.ts:218–230` 第三席位。 | 检查现有 baseline 即可；测试安全边界与自然语言语义无关。 |
| A04 同目标不同 bytes | service `:126–135` FILE_EXISTS 且旧内容保留，同内容可重复导入；Pi `:49–75` 新建/已有会话自动导入、冲突失败、删除后重试、跨任务拒绝。 | 可选最小补充：两附件第二份损坏/冲突时请求失败，第一份正确内容保留，修复后重试成功且无覆盖。避免假定组原子性。 |
| 确认 UI | `handoff.spec.ts:217–241` 真实服务零附件、误导说明、receiver/reload；`:246–270` 真实 Pi 双附件卡与原生成功历史；`hitl.spec.ts:58–84` mocked 0/2 附件、排序、预览、刷新；`:86–101` 非 assign 无误报警。 | mocked 零附件卡使用旧 commit 形状；当前实现按 handoff.kind 共用，未找到真实 Pi 新 action `[]`→浏览器零卡一体测试。优先复用现有页面/组件与 Pi 测试，非必需重复。UI 不验证自然语言是否选择正确。 |

建议 P0—P1 只补 C08 缺失/提交后导入损坏的确定性用例；权限点待主代理合并审计。没有证据要求新增自动收集 read 历史文件、goal 正则、再次 LLM 核验、再次审批、prepare/commit 对外拆分。

### 5. 历史实际代码 diff 核对

研究角色不运行 Git。主代理从仓库读取真实提交 diff，保存为 `.local/handoff-reliability-20261015/<hash>.patch` 和 `relevant-history.txt`；本节已直接读取这些 patch 的源码增删行，不只引用任务文档。patch 是主代理选择路径导出的证据子集，不是提交全部文件清单。

| 提交 | 实际源码差异及当前影响 |
|---|---|
| `2abb7822a1222648c0fc3ec6d15de1a9b1ae3ffc` (09-20) | 首次增加 collaboration files/service/safe-import。patch:71/88/94 已有 freeze/assertValid/import；:418/420 根据 inputPaths 冻结；:468 commit assertValid；:565 optional inputPaths。说明固定副本、路径隔离、校验本来就存在，原事故是零选片而非副本丢失。 |
| `047ab63e7b78d0767f667836ddc021e274b7a5a0` (09-22) | contract 字段增加说明但仍 Optional；工具说明从立即 commit 改成核对返回 files；lab 明确跨席位目录独立；InteractionCard 从“有文件才列”改为 assign 专用实际附件展示。它没有修正新调用必填，原任务文档关于可选契约是当时事实。 |
| `c14ec42b8acadfc42f0a209ea654edda99503d0d` (09-23) | 删除模型侧 prepare/commit 双工具，新增 work_item_action、宿主 scopedWorkAction、beforeToolCall 准备/HITL；DTO 当时仍用可选 inputPaths 条件展开；成功执行直接返回 commitAgent receipt，没有 files。不能把这个阶段误写成已解决明确选择。 |
| `e81f9d22b1145d5a399844aa6bbe38782e4e012c` (10-10) | contract 从原 workActionSchema 分出 historical schema；新 assign inputPaths 必填；DTO 无条件 map；成功结果由仅 receipt 改为 receipt + committed:true + 同一 action.files；lab 说明成功代表已执行。当前代码保留这些变化。 |
| `99b40ec1188fed81bf95a1487f54ec858cd1961a` (10-10) | createSession 新增 await importWorkInputs，bindWorkItem 变 async 并自动导入；新增 assignee-only helper，逐文件复用 service.importFile；新增自动导入、冲突与重试测试。当前代码保留这些变化。 |

历史文档对照：父任务 `verification.md` 的“inputPaths 仍可选/后续方案未纳入”仅描述 09-22；不能覆盖 10-10 后的新契约。`10-10-handoff-explicit-files/verification.md` 首轮和后续复测均明确自然流程整体未通过；后续 7 组为 4 通过/3 未通过，失败包括不执行分派、额外澄清。自动导入修复另列为宿主确定性保证，不能外推成模型语义选择稳定。

### Related specs

- `.trellis/workflow.md`：研究仅持久化证据，本轮 P0—P1 不实施业务变更。
- `.trellis/spec/backend/task-handoff.md`：新/旧 schema 分离、固定 bytes、原生授权、接收方自动导入和真实模型验收分离。
- `.trellis/spec/backend/files-execution.md`：安全 anchored 文件操作、普通工作区与私有固定副本边界。
- `.trellis/spec/frontend/harness-lab.md:152–172`：两入口实际附件展示、零状态及 scoped 固定文件预览。
- 已读父任务 prd/design/implement/bugs/verification/evidence，以及 `10-10-handoff-explicit-files` prd/implement/verification/manual-test；原方案的“参数可选”已被后续已批准新调用契约替代。

### External references / versions

本研究为本地实现审计，无需外部网页推断。仓库 `package.json:45,60` 固定 Pi coding-agent `0.85.1` 与 TypeBox `1.3.7`。GitHub Issue 和外部参考未在本代理重复查询，故不把公开状态当成本轮源码结论。

## Caveats / Not Found

- 未修改业务或测试代码；仅写本研究文件。baseline 的实跑结果由主代理补入统一 verification，不以历史绿测冒充当前结果。
- 未发现完整覆盖“固定副本被删除”“已提交固定副本损坏→自动导入拒绝”“自动导入多附件中途失败”的现有断言；这是证据缺口，不是已经实测出的产品错误。
- 未进行自然语言单轮/多轮真实模型验证，BUG-001 语义选择可靠性不得标记解决。
- 不承诺任意并发篡改私有文件根的全局原子快照；该根不挂载给普通 sandbox。现有 hash/无覆盖保护不需要升级成通用文件事务或新业务状态机。
