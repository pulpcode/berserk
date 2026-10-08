# 后端适配核对：多源上下文与任务研判

更新：2026-09-24。用途：供父任务编写设计与实施顺序；仅代码研究和待审建议，未修改产品代码、数据库或部署。

## 1. 已核对的代码事实

| 边界 | 当前实现与依据 |
| --- | --- |
| 数据库 | `access/database.ts:7-27` 打开同一个 `collaboration/collaboration.sqlite`，启用外键及 FULL synchronous，校验初始化标记、版本和 quick_check。初始 v1 包含协作表；`access/store.ts:23-38` 负责 v1→v2；`background/store.ts:59-83` 负责 v2→v3。现有启动允许版本为 1/2/3，v3 会检查后台表、索引及关联完整性。 |
| 任务存储 | `task_spaces` 只有 `id` 和 `data` JSON；`TaskSpace` 目前包含名称、目标、公私范围、负责席位、状态、revision 和操作者时间（`contracts/access.ts:9-13`、`access/store.ts:14-18`）。尚无业务引用、区域、时间或主题字段。 |
| 更新权限 | `access/store.ts:71-80` 允许席位读取公共任务及自己的私有任务。`update():99-107` 只允许 ownerSeatId 对应席位修改，比较 revision，再递增并记录用户。公私类型和 owner 不在可更新参数中。创建用 userId+clientActionId 去重，摘要目前仅含 title/goal/visibility（`:86-95`）。 |
| 服务查询 | `AccessStore.list/get` 只接收 seatId；`server/task-routes.ts:9-16` 从登录身份取得席位，没有服务主体查询契约。传入任意字符串也可能返回公共任务，但这不是已实现的服务授权接口。 |
| 后台主体 | `background/service.ts:118-120` 的 preprocess 不归属任务或真实席位；`pi/lab.ts:331-342` 使用独立 job 目录，内部 seatId 为 `service`，不加入 WorkspaceStore。`seat_analysis` 则绑定真实发起用户、席位和目标工作区（`background/service.ts:311-353`）。 |
| 查询工具 | `background/config.ts:16` 是固定工具名单；`pi/resource-tools.ts:42-49` 的 source_list/read 读取本轮静态资源快照；不存在特情历史、态势现状/变化或任务目录工具。`pi/lab.ts:598-612` 组装工具，后台禁用整个 collaborationTools；其中 work_item_list/read 查询分派工作，不能替代 Axon 任务目录。Docker 维持无网络（`execution/docker.ts:177`）。 |
| Profile 与子角色 | `pi/background-runner.ts:12-31,63-65` 固定 Profile 指令、资源、Skills、Agents。Profile 是后台主 Agent 的配置；agentIds 是可委派角色目录。Skills 起初仅显示 ID/简介，需要 skill_read 读正文（`pi/lab.ts:585`）。角色工具只读名单另在 `pi/roles.ts:8,41`，给主 Agent 加查询工具不自动使子角色可调用。 |
| 信息中心与收件 | `background/service.ts:89-94,186-213,229-243`：信息中心依触发 source 的 view/manage；收件依 recipientSeatId、delivered 状态和来源允许席位；预处理结果与工具过程没有独立资料域检查。其他席位的 seat_analysis 只返回最小状态摘要，私有正文/会话继续受原席位约束。 |
| 当前任务快照 | `resources/service.ts:91-92` 只给模型固定当前任务 id/title/goal/visibility；`pi/history-evidence.ts:23-27` 严格校验这些字段。不能直接向原生资源记录塞新字段而不更新解码和兼容测试。 |

相关规范：`.trellis/spec/backend/task-access.md`、`background-execution.md`。`database-guidelines.md` 仍是占位模板，不能据其推导额外迁移要求。

## 2. 待审建议：任务可选上下文附属现有 TaskSpace

建议以一个可选 `context` 字段放在现有 `task_spaces.data` 中，不单独建任务关系表、外部数据镜像或新的任务对象。例如：

```ts
type TaskContext = {
  businessRefs?: Array<{ systemId: string; objectType: string; objectId: string; label?: string }>;
  focus?: {
    areaIds?: string[];
    time?: { from?: string; to?: string }; // ISO 8601；有时区；允许开放端点
    topics?: string[];
  };
};
```

- `businessRefs` 表达外部对象引用，不要求外部系统存在同名 Axon 任务。`systemId/objectType/objectId` 三元组精确匹配；可选 label 仅作显示名称，不参与身份匹配；去重并限制长度和数量。不据引用扩大资料权限，不自动关联其他任务。
- `areaIds` 使用本期模拟资料域的稳定区域标识，由该域维护区域清单；不以自由文本名称当稳定 ID，不扩展地图或几何计算。`topics` 用有限长度的主题字符串；不预建主题分类体系。
- 时间先表达明确的业务关注区间；空值是未指定，不暗示“所有历史必须全部加载”。相对窗口、滑动窗口和周期规则另行确认，本期查询工具自身应有分页及范围上限。
- 字段缺省表示无已配置上下文。更新接口须区分“未提交，保持原值”和“明确清空”；建议整块替换 context，`null` 清空，避免难审阅的深层合并。旧版只改标题/目标的请求不应清掉已有 context。
- 创建、编辑共用当前 task revision；沿用 ownerSeatId 权限和 updatedByUserId/updatedAt，不单独再造 contextRevision。创建去重摘要必须包含规范化后的 context，否则同 clientActionId 换业务引用会被误当原请求。
- 公共任务的 context 属于公共任务元数据：编辑界面应清楚说明其可见范围；不能放只有负责席位才可知的私有内容。私有任务的同类字段继续只对负责席位开放。
- 原有资源快照可先保持不变，通过新任务查询工具按需获取完整 context/revision；若设计要求当前任务上下文自动注入，则同步修改 `contracts/index.ts`、`resources/service.ts` 和严格历史解码，保留旧记录兼容。

### 数据兼容与迁移选择

仅添加可选 JSON 字段，不改变 SQLite 表/索引，本期可以维持 v2/v3：缺字段的历史任务原样可读，不遍历重写旧任务，也不重写 Pi 历史。`decodeTask` 需验证存在的新字段及上限，拒绝损坏的新结构；普通任务仍保持原行为。

旧代码不会完整验证新字段，不能仅因 SQLite 版本不变就宣称任意版本可互换。现有更新采用对象展开，会保留未修改 JSON 字段；本期仍应验证新旧请求兼容及备份恢复。若后续确需新增表或索引再设计 v4；届时需同时核对 `openDatabase`、`AccessStore`、`BackgroundStore` 和 `server/app.ts:22-25` 的版本接受及启动顺序，不能仅让一个构造器接受 4 而忽略其他构造器。

## 3. 待审建议：一个共享模拟资料域与两类真实执行主体

本期建议只引入一个受控模拟资料域，内部提供特情 history、态势 snapshot/change；两类数据共享同一明确可见范围。使用固定部署配置 `contextScope` 登记 id、允许 systemIds/seatIds，由服务启动时加载，后台 Profile 引用 contextScopeId；允许执行的服务从已验证 Profile 获得范围。运行期间不热更新资料范围，不建设权限版本生命周期。动态权限变更和存量治理后置；本期无需新建权限管理平台、角色层级、逐记录 ACL 或独立权限数据库。

### 主体与任务目录

- 后台使用宿主构造的服务主体，例如 `{kind:'service', serviceId, profileId, jobId}`；不得由模型传入，不复用用户 Cookie，不把内部 `'service'` 字符串伪装为真实 seatId。
- 新任务查询服务应为该服务主体提供明确的只读入口，只返回 `visibility=public && state=active` 的任务元数据及 context、revision、updatedAt。查询无匹配就返回空结果；私有任务不能出现在列表、数量、标题提示或错误中。
- 不创建任何席位工作区，不读取工作区文件/聊天，也不把匹配结果写回 TaskSpace。外部引用和任务候选只是分析依据。
- 前台工具使用由当前请求/会话绑定得到的真实席位主体，沿用账号与任务访问校验，并按启动加载的固定配置检查域许可。task_search/read 前台沿用公共任务＋本席位私有任务可见范围，后台服务仅提供活动公共任务；前台私有任务内容只留在该席位会话，不进入共享预处理结果。两类主体共用查询实现，不共用错误的身份假设。

### 查询工具与适配层

建议新增独立的 `context` 查询服务/数据适配层，以及 `pi/context-tools.ts` 注册层；文件名为实施建议。工具可按业务语义分为特情历史、态势快照、态势变化、Axon 任务搜索/详情，准确名字由最终设计统一。不要复用 source_read 名称承载完全不同的动态查询语义。

- 模型参数只含业务引用、区域/时间/主题、分页等查询条件；禁止任意 URL、SQL、磁盘路径和权限/主体参数。
- 模拟服务维护固定测试数据，宿主适配器从本期就通过 HTTP 查询，不能直接读取 fixture；具体请求／响应见 [交互契约](../integration-contract.md)。后续真实系统可替换适配器，仍不放开 Bash 网络、暴露凭证或复制完整外部库。
- 查询应有参数上限、分页/截断标记、超时和 AbortSignal；明确区分查无资料、数据过期、服务不可用与权限拒绝。禁止把不可用当成“无风险”。
- 返回包带范围标识、来源 systemId、记录/对象 ID、资料时间/版本、查询时间、分页完整性及必要正文。原生工具结果保存本次实际读到的内容，结果引用这些依据；不只保存会随外部修改而变化的 URL。证据字段进入实际 toolResult content，可同时保存 details；当前公共消息主要投影 content 文本，不能只藏在 details 后宣称界面可见。无须另存一套会话或新建证据数据库。
- 同一组工具注册给预处理、普通前台主 Agent，以及有域权限的 seat_analysis；后台 Profile 白名单仍限制可调用项，普通前台按真实主体检查。不要因为后台当前禁用 collaborationTools 而整体开启协作写工具。
- 首期主 Agent 负责查询与综合，子角色继续只读已有资料；若确需角色自主查询，再显式扩展 roles 工具名单并继承同一个宿主授权范围，不能仅在 Profile 增加 agentIds。

## 4. 结果、收件与继续分析的最小权限衔接

已有 source 接收/管理权限、资料域查询权限、任务可见性三者独立。访问触发来源不自动授予共享域资料；公共任务关联也不授予任务席位目录访问。

Profile 通过可选 `contextScopeId` 引用共享域；作业快照保存当次 `{scopeId, systemIds}` 范围标记，供结果鉴权与溯源。该标记是宿主元数据，禁止由模型指定或清除，不是权限版本记录。原有不使用域查询的作业无此字段，维持原权限。无需再复制一套 scope 授权成员；查询、投递和结果读取依据服务启动时加载的固定资料范围配置及真实主体进行校验。

| 入口 | 必须补的域检查 |
| --- | --- |
| 入队/领取/每次查询 | 校验宿主构造的真实主体、Profile 工具白名单与固定资料范围。 |
| 规则保存/投递 | 保留来源接收席位限制，并要求综合结果接收席位属于共享域；投递前后异步边界重新校验，仍复用现有逐席位状态与重试。 |
| 信息中心 | source view/manage 之外，正文、结果、原生工具过程、文件预览/下载要求共享域权限；仅有信息管理权限不能获得域正文。 |
| 收件箱/附件 | recipient/source 之外按固定配置检查域资格；不能只隐藏按钮而保留详情、附件或 job URL 旁路。 |
| 发起后续分析 | 导入预处理结果/文件前检查域权限；后台领取重新检查。前台查询新数据也按真实席位检查。 |

标记需跟随作业/结果保留，读取结果和后台重试均使用当次范围标记，不从分析正文猜测范围。内容入口应共用一个小的范围检查方法，避免不同页面各写一套规则。本期不设计运行中配置变更、收紧或扩大范围的处理流程。

已合法导入席位工作区和普通 Pi 历史的资料沿现有文件/会话权限处理。本期不新增副本追踪或治理机制；动态撤权与存量资料治理整体后置，不在此设计撤权后的查询、结果入口或副本处置规则。

## 5. 可复用与实际改动清单

| 模块 | 本期建议改动 | 保持复用 |
| --- | --- | --- |
| `contracts/access.ts`、`access/store.ts`、`server/task-routes.ts` | 可选 context 类型/校验、创建幂等摘要、revision 更新；明确服务任务投影入口 | 同一任务表、公私/owner 权限、创建与更新回执、归档行为 |
| 新 `context/*`、`contracts/context.ts` | 单域配置、主体与授权检查、查询契约、模拟适配器及任务查询 | 现有 AccessStore 连接和任务数据；不新建外部镜像 |
| 新 `pi/context-tools.ts`、`pi/lab.ts` | 主 Agent 注册只读查询、取消/错误传递、真实主体绑定 | createAgentSession、SessionManager、压缩、模型并发、原生工具历史 |
| `background/config.ts`、`contracts/background.ts`、`pi/background-runner.ts`、`background/service.ts` | Profile 允许查询工具/域范围、固定并检查作业域标记、结果及接手入口授权 | 来源接入幂等、队列、独立目录、文件交付、固定规则多席位投递 |
| `background/store.ts` | 新可选作业范围字段的持久化校验和重试保持；无新表时不升版本 | 当前 SQLite 原子终态/投递记录和恢复机制 |
| `server/config.ts`／`server/app.ts` | 服务启动时加载固定资料范围配置并注入共享查询服务，前台也可使用；不把其生命周期藏在队列运行期 | 单一应用、现有登录和请求边界 |
| `web/Tasks.tsx`、必要的契约/API 文件 | 编辑业务引用与关注范围，呈现 owner 权限/revision 冲突 | 当前任务创建、列表和编辑页面 |
| `web/Inbox.tsx`、信息中心详情/共享展示组件 | 展示分析中任务影响与证据、域权限的可理解状态 | 现有 Markdown、文件、过程和后续对话入口 |
| `resources/service.ts`、`pi/history-evidence.ts`、`contracts/index.ts` | 仅当决定自动注入新增当前任务字段时修改；否则先走查询工具 | 旧任务资源记录/原生历史兼容 |

资料域配置不应与某一条来源 Rule 的接收人列表混为一份授权。动态权限变更、热更新及存量治理属于后续范围，不作为本期实施项。

## 6. 最小验证建议

- 旧 v2/v3 数据打开、无 context 的任务与旧 Pi 历史可读；新增字段正常重启；畸形 context 拒绝，不丢旧字段。
- context 创建去重/不同参数冲突、owner 修改、非 owner 禁止、revision 冲突、显式清空、公私可见性。
- 服务任务查询仅活动公共任务，猜私有 ID 不泄漏；前台仅能查公共任务和本席位私有任务，猜他席位私有 ID 不泄漏。两类查询均不建工作区、不读会话，前台还须按自己真实主体检查域许可。
- 两个模拟源查询、分页/截断、过期/不可用/无匹配差异、取消传播；证据时间/版本在原生历史中可重读。
- 在启动加载的固定配置下，服务或席位无域权限、投递范围不合法、信息中心只有 source 权限、直接访问 job/file URL，各条源结果入口都有确定性负例。验证作业范围标记保留并参与结果鉴权与溯源；不把运行中权限变更或存量治理列为本期必验项。
- 原队列/预处理/收件/普通对话回归继续通过；不为本轮文档研究运行真实模型、Docker 或部署。
