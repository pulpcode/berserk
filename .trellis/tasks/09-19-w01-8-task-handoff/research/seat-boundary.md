# Research: 单服务双席位与工作区边界

- Query: W01-8 如何在同一端口、同一 LAB_DATA_DIR 中支持两个受控测试席位，沿用任务×席位文件隔离、共享模型设置和 Pi 原生历史？
- Scope: internal
- Date: 2026-09-19

## Findings

### 当前事实

1. **数据结构已支持多席位，运行实例尚为固定席位。** `workspace-index.json` v2 已保存 `taskSpaceId`、`seatId` 和会话绑定，并拒绝重复的 `taskSpaceId × seatId`；文件路径使用独立 workspace UUID。`WorkspaceStore` 的构造参数固定一个 seatId，`list/get/binding/bindings/create` 都依赖它。见 `experiments/harness-lab/src/workspaces/store.ts:10`、`:22`、`:30`、`:49`、`:87`、`:108`。
2. **taskSpaceId 当前只是归属标识，没有业务任务表或任务生命周期。** 新建工作区默认同时生成 taskSpaceId；内部 `create(name, taskSpaceId?)` 已能为另一个席位创建同任务工作区。HTTP 新建工作区只接受 name，尚不暴露此内部参数。见 `src/workspaces/store.ts:12`、`:108` 和 `src/server/app.ts:52`（本文件中省略前缀的 src 均位于 `experiments/harness-lab/`）。
3. **PiLab 启动仅加载固定席位的会话。** 它使用 `WorkspaceStore.open(dataDir, config.seatId)`，通过过滤后的 binding 加载会话；历史交互检查、当前交互写入/读取和 Bash policy 都使用 `config.seatId`。见 `src/pi/lab.ts:139`、`:160`、`:164`、`:342`、`:455`、`:803`、`:812`、`:827`、`:841`。
4. **HTTP 目前没有人员登录或每请求身份。** Host/Origin 限制访问入口，业务方法靠固定 WorkspaceStore 过滤；不能将 Host/Origin 检查解释成人员鉴权。见 `src/server/app.ts:12`、`:50`、`:55`、`:64`。
5. **ResourceService、FileService 间接依赖固定席位。** 指令、资料、Skill 和普通文件操作都最终调用 WorkspaceStore.get/directory。FileService 的上传与下载记录已包含 taskSpaceId/seatId，并核对工作区归属；因此不能在改成“全局 get”后只过滤会话列表。见 `src/resources/service.ts:25`、`:58`、`:66`；`src/files/service.ts:44`、`:88`、`:100`、`:213`、`:228`。
6. **一个服务当前已有一套共享模型配置。** `model-settings.json` 位于 dataDir 根目录，没有席位字段；返回配置不含 API Key。PiLab 在任意已加载会话活动时禁止保存配置，保存过程中同步阻止新请求，保证 runtime/config 同步。见 `src/server/model-settings.ts:71`、`:79`、`:87`；`src/pi/lab.ts:203`、`:625`。

### 建议的最小技术方案（待设计审阅）

- 保持 **一个 PiLab、一个 WorkspaceStore、一个 ResourceService、一个 FileService、一个 DockerExecutionService**。WorkspaceStore 加载全量索引，PiLab 启动加载所有已登记会话；前端可见范围在读取/写入入口按当前受控席位筛选。
- 将固定席位改成**显式、不可变的请求身份参数**，例如 `seatId`。HTTP 从受控测试身份入口解析并校验；会话级方法首先核对 `session → workspace → seat`，工作区级方法首先核对 `workspace → seat`。`start` 在异步准备之前固定身份和工作区，后续工具、子 Agent、HITL 沿用该范围。
- 不通过修改 `lab.config.seatId`、可变的“当前席位”全局变量或多份 WorkspaceStore 实例实现切换。单一索引锁、资源锁和上传取消表继续集中所有权。无需通用身份插件框架或把 seatId 放入模型可填写的工具参数。
- 内部全量索引访问与对外按席位访问需明确分开，例如保留宿主内部 `getById`，另提供 `getForSeat/listForSeat/bindingForSeat`；PiLab/资源/文件的公开调用必须经过席位检查。具体命名可由实施阶段确定，关键是不能留下 HTTP 直接访问全量 service 的路径。
- 启动时的文件上传恢复、Pi 历史校验和孤儿容器清理只执行一次，覆盖整个数据根。历史交互校验所需 seatId 改为**会话绑定工作区的持久 seatId**，不能使用此时浏览器选择的身份。
- 为业务任务关联另一席位时，在同一个 WorkspaceStore 锁内按 `(taskSpaceId, seatId)` 查询或创建工作区；已有映射直接复用。业务任务接收者是交接服务校验的目标，不能因为允许“分派给 B”就给予 A 对 B 私有目录和会话的通用访问。
- 现有父请求与只读 subagent 继续同一工作区/沙盒；业务上的席位分派不等于调用 subagent，接收方会话独立。任务详情可显示经明确授权的任务元数据和已交接文件，不自动共享双方 AGENTS.md、会话全文、中间文件或下载目录。

**不要建立两份 PiLab 共用数据根。** WorkspaceStore 各自拥有内存索引和锁；先后提交会因磁盘版本变化报错，不能成为共享写入协调方式（`store.ts:100`）。两份 ModelSettingsStore/runtime 也无法共同保证活动请求与设置更新的互斥。更具体的是 Docker owner 由 dataDir 计算，第二个 PiLab 初始化会清理相同 owner 的容器，可能停止第一个实例的活动请求（`lab.ts:143`；`execution/docker.ts:100`、`:103`）。

### 必须覆盖的授权入口

| 入口 | 最小校验/适配 |
| --- | --- |
| `/api/workspaces` 列表、新建；`/api/activity` | 按当前席位返回、创建；activity 不能在 PiLab 改为全量加载后泄露另一席位标题/状态。当前 `lab.ts:277` 直接遍历 records，需要新增过滤。 |
| `/api/sessions` 列表、新建、单会话 GET、消息 SSE、取消 | 按 session/workspace 归属校验；默认工作区也必须取当前席位。见 `app.ts:53`、`:64`、`:68`、`:71` 和 `lab.ts:223`、`:258`、`:286`。 |
| 请求资料与压缩详情 | 跟随会话所属席位，不能只凭 UUID 读取。见 `app.ts:62`、`:63`。 |
| AskUser、命令/业务操作确认响应 | 响应者必须属于该会话的席位；记录 actor 来自服务端身份，不接受正文自报 seatId。保留 requestId/interactionId、过期、重复响应等现有校验。见 `app.ts:65`、`lab.ts:825`。 |
| 当前指令、资料、Skill 的读写 | ResourceService 公共调用明确核对当前席位；common AGENTS 和 Skill 是受控公共资源，并不使另一个席位的 workspace AGENTS 可见。见 `app.ts:55`、`:57`、`:60`、`:61`。 |
| 上传创建、字节流、进度查询、取消 | 所有阶段都校验工作区/席位，取消必须先鉴权再发信号。见 `file-routes.ts:13`、`:19`、`:30`、`:31`。 |
| 普通文件列表、状态、内容、预览、固定下载 | 同一席位限制必须覆盖 fetch 和浏览器直接链接；不能仅改通用 api()。见 `file-routes.ts:32`、`:45`、`:51`、`:63`。 |
| 新增分派/提交/接收/退回工具与 HTTP | 对明确业务对象逐次检查行动主体和允许接收者；跨席位访问只能经此业务入口获取授权的固定文件，不能复用普通下载 API 时放开整个源工作区。 |
| 模型设置 | 仍为全局配置。任何席位有活动请求都应返回 MODEL_SETTINGS_BUSY；谁可以修改属于待审产品权限选择，不可默认为席位拥有私有配置。见 `app.ts:35`、`:36`。 |

### 双席位测试身份与传输方式

主会话已告知用户选定：**本期页面切换两个测试席位，后续完善真实身份**。技术建议是在受限本地测试模式中配置固定白名单，页面允许切换，服务端解析测试 context 并校验对象归属；不建设 cookie/token/login session 系统。

**主设计已采纳统一测试 context API 路径 `/api/test-seats/:seatId/...`**。每个 tab 保存所选测试席位，页面请求、上传、预览和下载均使用纯 URL 构造函数；异步请求发起时捕获 seatId，不在发送重试/回调时读取可变的当前席位。服务端只接受白名单值，不把路径中任意字符串直接当权限。

现有链路的具体约束：

| 客户端链路 | 代码位置 | Header/context 改造边界 |
| --- | --- | --- |
| 通用 JSON 请求 | `web/api.ts:13` | 可以加 header，也可统一包装 URL。 |
| 消息 SSE | `web/api.ts:23` | 是 fetch POST，不是 EventSource；可加 header/context，但必须固定发起席位。 |
| 上传 | `web/useAttachments.ts:43`、`:54`、`:58` | 状态查询、创建、取消有 fetch/api；传输使用 XHR，不能只改 api()。 |
| 文件预览 | `web/Files.tsx:42` | fetch 成功后转 blob/text，可用同样 context；图片展示为 blob URL。 |
| 历史引用/当前文件/固定成果下载 | `web/Files.tsx:27`、`:30`、`:66` | 原生 `<a href>` 导航无法附加自定义 header，URL context 可以直接适配。 |

如统一使用 header，必须额外解决直接下载：要么下载 URL 另带明确测试 context 并验证与其他身份字段不冲突，要么改 fetch→blob 下载。后者需要浏览器缓冲整个文件，增加改造与内存成本；不建议只为了测试身份改变下载流。混合 header/query 也比统一路径更容易漏验。

Fastify 路径 prefix 携带 seat 参数时，现有 `additionalProperties:false` 的 params schema 必须包含该参数；不要仅添加 prefix 后使合法路由全部校验失败。多席位测试模式中的私有 API 缺少 context 应明确拒绝，不能静默回落到旧 A 席位，掩盖遗漏适配的链接。主设计已确认：公共 bootstrap/info 保持无前缀；原单席位模式兼容 `/api/...`，双席位测试模式的私有无前缀 API 拒绝访问。切换页面测试席位不得改变服务全局模式。未来真实认证仅替换身份解析入口，不应绕过后续对象归属检查。

不建议同源 cookie 存储一个“当前席位”：切换会影响同源其他标签页，与本期双标签对照验收不符。每 tab 的选择、缓存和新请求范围独立，不能改变另一个 tab 已经开始的请求。

受控测试切换不是人员身份认证：本地测试操作者可以选择另一个测试席位。应验证“当前所选 A 不能凭 B 的对象 ID 越过接口范围”，不能声称已阻止恶意操作者切换成 B。真实登录、人员与席位分配、SSO 不在此最小范围。

前端缓存需按测试身份隔离或在身份切换时完整重新挂载和隔离旧异步结果。现有 `berserk.drafts/submitted/read-results/workspace/selections` 是同源 tab 缓存，见 `web/useChat.ts:7`、`:20`、`:90`；附件缓存还在 `web/useAttachments.ts`，交互草稿另在 `InteractionCard.tsx:17`，指令编辑草稿在 `useInstructions.ts:17`。为防止丢旧草稿，可只给新增席位增加命名空间，原席位沿用旧键；切换不取消服务器已经开始的任务。新业务任务与交接缓存也必须绑定身份。

### 共享配置与兼容/迁移边界

1. **现有 v2 workspace-index 不需要为双席位升级 schema。** validator 已支持多席位；现有默认工作区字段允许当前席位没有全局默认时取本席位第一个工作区。第二席位尚无工作区时返回空列表，何时创建默认工作区应明确为受控初始化或业务建任务动作，不能在每次 GET 时改写索引。
2. **保留所有原 workspace UUID、taskSpaceId、seatId、sessionBindings 和文件目录。** 现有 LAB_SEAT_ID（缺省 test-seat）应仍作为旧数据的席位配置值；不要为了显示“分派席/处理席”改写历史 seatId。席位显示名称另由受控配置提供。
3. **Pi JSONL 保持原样。** `sessions/`、子会话和旧交互记录不迁移，不补写新的身份字段；旧条目已有的 seatId 按原归属验证。加载所有席位是宿主读取范围改动，不是 Pi 内核变更。旧未绑定/损坏历史仍不自动纳管。
4. **不要自动给所有旧工作区编造分派任务。** 若业务任务使用现有 taskSpaceId 作为关联键，需要说明旧工作区仍可普通使用；任务领域记录何时创建由业务动作决定。本研究没有发现历史任务状态可据以迁移。
5. **模型配置继续共享一个 model-settings.json/runtime。** 保留期望版本校验、全局活动请求拦截、保存期间拒绝新请求和不返回 Key；无需新增每席位模型配置。界面应让用户理解这是当前服务的公共配置。是否仅某测试席位/操作员可以修改，主设计需注明待审选择。
6. **初始化前仍备份整个停服数据目录。** 第二席位增加工作区是新增索引条目而非 JSONL 迁移。旧程序只能看其固定席位，新业务记录与操作不能被旧版本继续维护；回滚应使用独立完整备份，不应笼统承诺旧程序可以安全继续新数据。只有仍为 v1 的历史索引才继续使用已有显式 migrate:seats 流程（`workspaces/seat-migration.ts:8`、`:38`）。

### 验证建议

- 单 PiLab 内 A/B 同任务不同 workspace，目录、AGENTS、会话/压缩原文/资源、上传/下载、AskUser/确认均隔离；修改为 B 对象 ID 必须拒绝且无写入/取消效果。
- A 发起请求后切换 B，A 的模型调用、工具和确认依然绑定 A；A/B 普通请求可并行，操作确认只能从对应席位响应。
- B 工作区和会话创建后重启，双方索引、文件与 native JSONL 不变且正常加载；旧 A 会话、压缩、HITL 历史无需改写。
- A/B 任一请求活动时修改全局模型配置均拒绝；空闲时保存后双方下一请求使用同一新版本，任何席位 GET 不返回 Key。
- 所有路由而非只列表做越权矩阵；直接下载/预览链接、XHR 上传、历史详情、取消流都覆盖。
- 比较两个标签页，确保切换身份不混入旧 SSE、未读、草稿、附件和确认响应结果。

## Files Found

| 文件 | 用途 |
| --- | --- |
| `experiments/harness-lab/src/workspaces/store.ts` | v2 索引、固定席位筛选、归属唯一性、单写锁 |
| `experiments/harness-lab/src/workspaces/seat-migration.ts` | 旧 v1→v2 离线迁移，保留原生历史 |
| `experiments/harness-lab/src/pi/lab.ts` | 会话加载、入口归属、资源与交互绑定、共享设置、请求保留 |
| `experiments/harness-lab/src/resources/service.ts` | AGENTS/资料/Skill 与工作区锁 |
| `experiments/harness-lab/src/files/service.ts` | 文件根、上传归属、固定下载、启动恢复 |
| `experiments/harness-lab/src/server/app.ts`、`file-routes.ts` | 全部 HTTP 路由和现有 Host/Origin 限制 |
| `experiments/harness-lab/src/server/config.ts`、`model-settings.ts`、`main.ts` | 固定 seat 环境项、全局模型配置、单实例启动 |
| `experiments/harness-lab/src/execution/docker.ts` | dataDir 所有者标签对应的启动清理与请求容器 |
| `experiments/harness-lab/src/web/api.ts`、`useChat.ts`、`useAttachments.ts`、`Files.tsx` | 客户端请求、tab 缓存、上传与直接下载链接 |
| `experiments/harness-lab/tests/files/seats.test.ts:25` | 已验证同 taskSpaceId 的第二席位独立工作区，但通过两个 Store 顺序测试，不能代表单服务双席位运行 |
| `experiments/harness-lab/tests/files/service.test.ts:52` | 固定下载字节与席位拒绝测试 |
| `experiments/harness-lab/tests/pi/model-settings.test.ts:148` | 模型配置与活动请求的互斥用例 |

## Related Specs

- `.trellis/spec/backend/harness-lab.md`：现行固定 LAB_SEAT_ID、单进程单目录、受控资源、Pi JSONL 和中断续聊。W01-8 如获实施批准，固定席位这一现行约束需同步更新。
- `.trellis/spec/backend/files-execution.md`：上传/下载 task-seat-workspace 归属、不可绕过的文件根、安全 helper、请求容器清理。
- `.trellis/spec/backend/hitl.md`：交互记录固定席位、精确参数确认、旧等待失效；不得为新身份入口削弱历史校验。
- `.trellis/workflow.md`：本次为规划研究，产品设计待审后再实施。

## External References / Versions

本研究仅据本仓库实际实现，不依赖竞品或网络身份设计。锁定依赖在 `experiments/harness-lab/package.json`：Pi 0.85.1、Fastify 5.12.5、Node 24；没有提出 Pi 升级或内部修改。

## Caveats / Not Found

- 未读取 `.env`、API Key 或真实数据；未访问服务器。不能据本研究推断线上当前 seatId、存量索引是否全部 v2、席位名称或真实人员权限。
- 未运行验证。本报告的测试段是待实现验收建议，现有测试只覆盖固定席位/离线迁移的一部分行为。
- 新任务/交接对象的存储、固定文件交接事务和接收/退回状态由主任务设计负责，本研究仅限定身份和旧数据兼容边界。
