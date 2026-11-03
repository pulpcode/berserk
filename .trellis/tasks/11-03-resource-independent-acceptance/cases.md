# 独立验收题包：逐题事实与人工预期

状态：**待审阅、未冻结、未执行**。本文是合成 fixtures 的准备计划，以下来源、记录、账号、任务、标绘和引用目前均未据本文写入系统，不表示真实业务或现有系统数据。本文不授权模型调用、测评执行、产品修改或 runner 实现。

独立编题仅使用已批准的 `10-28-agent-spatial-plotting/resource-followup-20261102/03-acceptance.md` 和 `experiments/harness-lab/src/contracts/{task-resources,context,annotations}.ts`；未读取旧测评具体样例、实现测试或产品统计函数。预期为下列集合、数字、矩形几何和证据的人工推导。

## 共同冻结规则

- 规模固定为 P01–P04 各一次、N01–N08 各两次，共 20 个完整任务。正式题第一遍 N01→N08，第二遍 N08→N01。每次有独立账号、任务、会话、草稿和数据目录；第二次复用业务事实，不能复用上次会话答案或缓存。允许 UUID、taskId、真实版本号、时间平移不同，必须保留逐项逻辑 ID→实际 ID/时间的映射。
- 表中的 source systemId/objectId/entityId 是拟准备的精确业务标识；`任务` 是该次实际 taskId 的占位映射。`A(case)` 是该次通过 AnnotationService 实际创建并读回的不可变 `{setId, revision}` 或 `{publicationId}`。凡涉及初始引用，必须由真实浏览器显式引用生成实际消息附件；不把本文表格、答案或完整 geometry 放进用户提示。`A(case)` 不是可直接提交给 API 的伪造引用。
- **T0 的定义**：经授权准备该次实例时，通过可用只读 API/服务响应读取实际时钟时间并记录获取途径及原始响应，作为该实例 T0；不得由模型编写一个看似真实的 API 时间。表中的 `T0±时长` 是允许写入合成来源事实的相对时间；冻结时换成实际 ISO 时间。查询的 `queriedAt`、来源响应 `asOf`、标绘 `createdAt`、版本 `revision/hash` 和导入回执时间必须取各次真实 API 返回值，不能用 T0 占位值冒充。N05 另有明确的来源快照 `asOf` 相对时间计划，仍须作为实际 HTTP 响应返回、留存后才成为事实。
- T0 在实例准备开始时读取；随后在 T0 后、执行前创建合成数据。默认业务报告/生效时间位于 T0 前，**不是声称平台记录在 T0 前已创建**。正式任务在 T0 后一小时内开始，在默认有效期内结束。默认来源事实 `reportedAt=T0-5分钟`、`effectiveAt=T0-10分钟`、`validUntil=T0+24小时`。超出有效窗口不静默平移运行中的数据；在执行前判输入无效，记录并等待处置。N04 过期记录使用自己的时间。仅 fixtures 的业务时间可按公式生成，平台/查询/版本时间不能伪造。
- 本文坐标全为虚构测试区 WGS84 `[经度,纬度]`，与实际地名、设施无对应。`R(w,s,e,n)` 表示闭合 Polygon `[[[w,s],[e,s],[e,n],[w,n],[w,s]]]`。点在严格不等式内部为内部、等于一条边且其余维度在闭区间内为边界，否则为外部。点 geometry 必须为 `Point`，不以名称、areaIds 或站址代替坐标。
- 表中 `—` 表示该字段不存在/不适用，不能变成空字符串、虚构 entityId 或新增 contract 字段。单体来源 `objectType=resource`、`resource.meaning=actual_resource`、`granularity=individual`；表中聚合行为 `granularity=aggregate`，**没有 entityId**。除特注外来源 `revision=1`、`areaIds=[]`、`validTime={from:effectiveAt,to:validUntil}`、`properties={}`。没有 geometry 的来源使用 `geometry:null`。
- 数量写作 `数值 单位 / meaning / scope`，严格对应 `resource.quantity`。默认单体车辆是 `1辆/entities/<该题车辆scope>`，category=`vehicle`；舟艇是 `1艘/entities/<该题舟艇scope>`，category=`rescue_boat`。同类聚合使用相同 category。每题明确 scope；成员列映射 `coverage.memberEntityIds`，`完整/不完整` 映射 `coverage.complete`，**coverage.scope 与该行 quantity.scope 完全一致**。单体默认省略 coverage。缺少成员名单不等于数量为零；不知道数量时才用 `quantity.value=null`。没有数量的普通点/区域/计划点不添加 category 或 quantity。
- 来源事实依据默认为该行自身 `source` evidence（精确 systemId、objectType、objectId、revision），分别挂在 quantity、taskRelations、availability、position 上；必要的条件或业务口径另加表中逐字 declaration evidence。不能只挂最外层 evidence 代替具体事实的依据。标绘事实以 declaration evidence 明确“合成验收声明”，导入副本的事实与关联必须由真实受控导入产生。
- 任务关系列 `U` 表示对本次任务明确 `unconfirmed`，不是 assigned、不是不存在关系；`A/R/S` 分别是 `assigned/related/potential_support`。状态 `可用/不可用/未知` 对应合法 `available/unavailable/unknown`。默认这些事实使用上述有效时间且无条件；表中其他状态均明列。普通点、区域和计划点没有任务关系和可用性要求。
- 默认来源 capability：`pagination=cursor`、`snapshot=fixed_revision`；支持该题所用 category/unit，relations 为四种合法关系，filters 含 category/task/relation，`taskIdMapping="identity"`；支援规则 `id="explicit-task-relation"`，description 为“仅当记录为同一 taskId 明确声明 potential_support 时视作潜在支援，空间接近、平台引用和 related 不产生支援关系”。正文特别约定的 partial 覆盖优先于默认。Context HTTP 分页结束（hasMore=false）与业务 resourceCoverage 完整独立；默认限定来源及题定 scope 的 HTTP 数据齐全、resourceCoverage=complete，不能扩写为整个任务、所有来源或现实全量。
- 每条来源及其名称/quantity/成员信息都必须能经真实 ContextService 的 situation_query 路径读出；TaskResource 查询的 records 未必携带 `properties`，不能假定其必有 memberRefs。需要读名称映射时使用合法数据路径读取下表单体对象。表中只有 API 已有的 `properties.memberRefs` 可用于成员对象引用，不添加自定义成员名称字段。
- 只有 P03/N06 的冻结消歧回复由实际追问触发：普通文本或结构化选择均按其实际含义接续，不按是否有问号判断。已经给出答案、仅自述将澄清、或未问到对应歧义时，不主动发送选择来救场。其他题除明确规定的下一轮外，没有追加事实或提示。
- 每题下列“工具缺陷”只对工具实际输出及故障证据判定；回答错误不能自动推定工具错误。已有三项工具硬门槛是：空统计中断、有充分成员依据仍重复计数、缺乏依据仍输出精确合计。`summary.entityCount=null` 本身不构成失败，特别是聚合对象没有 entityKey 时；应检查目标口径的 quantity/成员结果及工具是否无据宣称精确。统一全局评分、无答复处理、分母和预算由同目录 README 规定。

## P01：真实显式引用、内部与边界

**用户原文**：`只看我引用的“绀溪核验图层”和“绀溪矩形”，列出矩形内部及边界上的实际资源，内部和边界分开，给出各自数量。`

**初始引用与交互准备**：先普通点击绀溪矩形，核对尚未附加引用；随后用真实显式引用操作，把 `A(P01)` 的 `p01-assets` 图层以及 `p01-regions/p01-area` 区域随上述消息发送。区域为 `R(121.00,31.00,121.04,31.04)`。普通点击环节是公开流程观测，不是额外模型任务。范围外的图层不引用。

标绘内逐行事实（表中 systemId `annotation` 仅是定位说明，不作为 ContextRef；真实定位为 `A(P01)+layerId+objectId`）：

| systemId / 图层 | objectId | entityId | 名称 | 任务关系 | 状态证据 | 数量口径 | geometry 与 position |
| --- | --- | --- | --- | --- | --- | --- | --- |
| annotation / p01-regions | p01-area | — | 绀溪矩形 | — | — | — | 上述 Polygon；无 resource |
| annotation / p01-assets | p01-car | — | 溪鹭运输车 | U | 可用，合成声明 | 1辆/entities/p01-vehicles | Point[121.01,31.02]；actual/resource |
| annotation / p01-assets | p01-boat | — | 芦汀救生艇 | U | 可用，合成声明 | 1艘/entities/p01-boats | Point[121.04,31.03]；actual/resource |
| annotation / p01-assets | p01-out | — | 松砾运输车 | U | 可用，合成声明 | 1辆/entities/p01-vehicles | Point[121.05,31.02]；actual/resource |
| annotation / p01-assets | p01-plan | — | 水榭拟设车辆位 | — | — | — | Point[121.02,31.01]；meaning=planned_location，position=planned/resource，informationRole=plan |

无后续用户事实。人工预期：内部仅溪鹭运输车，1辆；边界仅芦汀救生艇，1艘；松砾运输车在外，计划位不计实际资源。可以补“内部1个实际资源对象、边界1个”，不能混称总共2辆。

判分：**主任务**要求真实引用可用、工具/结果卡片/回答完成，内部与边界集合及单位正确。**解释**说明固定图层、区域、实际资源口径。**关键约束**不将普通点击当引用、不扩展图层、不把 U 当分配。**工具缺陷**若合法标绘读取或空间计算中断则记产品故障；是否命中三项工具硬门槛依实际输出判断，不能仅因结果为空推定。

## P02：两个来源全部任务关系未知

**用户原文**：`请查“苇汀调度”和“杉岬协作”这两个来源中，本任务的资源情况。分别说现在看到哪些、与本任务是什么关系，以及各来源查全没有。`

初始没有标绘引用；当前任务为实际 `任务(P02)`。只开放以下两个来源至题目查询范围，车辆 scope=`p02-vehicles`，舟艇 scope=`p02-boats`。

| systemId / 来源名 | objectId | entityId | 名称 | 任务关系 | 状态证据 | 数量口径 | geometry 与 position |
| --- | --- | --- | --- | --- | --- | --- | --- |
| p02-weiting / 苇汀调度 | wt-cart | wt-e41 | 苇汀运载车 | U，来源未确认对应任务关系 | 未知 | 1辆/entities/p02-vehicles | Point[121.011,31.013]；actual/resource |
| p02-shanjia / 杉岬协作 | sj-boat | sj-e72 | 杉岬巡护艇 | U，来源未确认对应任务关系 | 可用 | 1艘/entities/p02-boats | Point[121.026,31.016]；actual/resource |

两个来源 HTTP 均返回以上1条、hasMore=false，但 `resourceCoverage={status:partial,reason:"仅开放当前同步片段，任务归属尚未确认"}`。任务资源 coverage 均 partial，asOf 来自真实响应；没有可继续取得其他业务数据的 cursor 时 reason 必须存在。不得把分页结束转换成 complete。无后续业务事实；不替模型补分配关系。

人工预期：看到两个候选资源，各自关系未知；杉岬巡护艇有有效可用声明，但不能称“本任务已分配可用艇”。两来源都不完整，不能断言本任务没有资源，也不能断言这两条就是本任务总量。

判分：**主任务**分别列出两来源已有记录、未知关系与 partial，合法 data/task 路径均可。**解释**区分可用事实与任务归属、分页结束与业务全量。**关键约束**无无据分配、无部分冒充全量。**工具缺陷**重点核对未知关系/空可统计集合不触发自校验中断；若中断发生，模型绕行后答对仍不能抵消。

## P03：公开消歧接续

**用户原文**：`请查“南坪”里面有哪些实际车辆。两个同名区域请先让我选，再继续查。`

初始显式引用 `A(P03)` 的区域图层 `p03-areas`，包含两个同名区域，注记及几何可读；没有选中单一区域的隐藏附件。另开放来源 `p03-lanting`（蓝汀车辆），车辆 scope=`p03-vehicles`。

| systemId / 图层或来源 | objectId | entityId | 名称 | 任务关系 | 状态证据 | 数量口径 | geometry / 注记与 position |
| --- | --- | --- | --- | --- | --- | --- | --- |
| annotation / p03-areas | p03-southwest | — | 南坪 | — | — | — | R(121.00,31.00,121.03,31.03)；note=西侧南坪 |
| annotation / p03-areas | p03-southeast | — | 南坪 | — | — | — | R(121.06,31.00,121.09,31.03)；note=东侧南坪 |
| p03-lanting / 蓝汀车辆 | lt-w | lt-e11 | 楝影运输车 | U | 可用 | 1辆/entities/p03-vehicles | Point[121.015,31.015]；actual/resource |
| p03-lanting / 蓝汀车辆 | lt-e | lt-e28 | 汀铃运输车 | U | 可用 | 1辆/entities/p03-vehicles | Point[121.075,31.015]；actual/resource |

**仅在实际询问选哪一处南坪时发送**：`选西侧南坪，就是经度121.00到121.03、纬度31.00到31.03的那个。` 若结构化交互要求点击，用对应西侧选项完成真实交互，同时留存值映射。选择不是初始输入可见事实。

人工预期：先提出能区别两个区域的聚焦问题；收到选择后仅列楝影运输车1辆。无需再追问“车辆是否可用”，用户只问实际车辆。查阅候选区域以消歧可以，未获选择就完成任一区域或两区合并不可以。

判分：**主任务**先等待选择、正确接续并完成西侧结果。**解释**指出选择的是西侧固定区域；不能把“待选择”叙述成工具已经查明偏好。**关键约束**无隐藏偏好泄露、无自动代选。**工具缺陷**真实文本/结构化接续应留存；若输入没有送达、重复发送或送错选项，属于流程无效应停止正式题，不用模型分数掩盖。

## P04：两轮续读与旧快照

**第一轮用户原文**：`查询“雾栈车队”的实际车辆，先给我最前面两条，并保留这一次查询结果，余下的等我下一轮再读。`

无标绘引用。来源 `p04-wuzhan`（雾栈车队），车辆 scope=`p04-vehicles`。固定快照 V旧 的顺序为下表顺序。第一轮通过现有 `task_resource_query` 的 query 路径完整取得4条并得到真实固定 `resultRef`，只向用户展示前2条；工具若已把4条都返回模型，保留原始轨迹，不人为裁剪。来源 HTTP 分页（如 page limit=2）须在首轮形成固定结果前完成，**它的 cursor 与固定结果的 read offset/limit 是两层分页，不要求来源 cursor 跨用户轮保活**。来源首版 revision 在准备时取实际版本，表中以 `V旧` 表示。

| systemId | objectId | entityId | 名称（V旧） | 任务关系 | 状态证据 | 数量口径 | geometry 与 position |
| --- | --- | --- | --- | --- | --- | --- | --- |
| p04-wuzhan | wz-11 | wz-e11 | 雾杉一号车 | U | 可用 | 1辆/entities/p04-vehicles | Point[121.011,31.011]；actual/resource |
| p04-wuzhan | wz-22 | wz-e22 | 雾杉二号车 | U | 可用 | 1辆/entities/p04-vehicles | Point[121.022,31.011]；actual/resource |
| p04-wuzhan | wz-33 | wz-e33 | 雾杉三号车 | U | 可用 | 1辆/entities/p04-vehicles | Point[121.033,31.011]；actual/resource |
| p04-wuzhan | wz-44 | wz-e44 | 雾杉四号车 | U | 可用 | 1辆/entities/p04-vehicles | Point[121.044,31.011]；actual/resource |

第一轮结束后，控制器按已冻结计划更新来源到 V新：`wz-11.name=雾杉一号车（新牌）`，`wz-33.geometry=Point[121.063,31.011]`、availability=unavailable（证据“制动故障”），其余事实相同。V新 revision 与 effectiveAt/asOf 用实际更新与响应值留存。V旧固定 resultRef 不得指向 V新。第二轮使用现有 `task_resource_query` 的 read 路径与同一 resultRef，以 offset=2/limit=2 读余下两条，再以 offset=0/limit=2 重读前两条；不重新 query 来源。若无法形成或读取真实固定结果，此项流程不成立，不能用模拟工具结果补齐。

**第二轮用户原文**：`继续读取第一轮那次查询剩下的两条；再打开当时保留的前两条核对。请分清续读的旧快照与来源现状，不用重新查询现状。`

人工预期：首轮只展示雾杉一、二号车；次轮续读 V旧 的雾杉三、四号车，三号车仍为 `[121.033,31.011]` 与旧可用事实；旧前两条仍为原名。可以说“这是首轮固定查询快照，不能据此断言当前状态”，不能无查询声称新状态。读取旧结果是续读/打开，不冒充新查询、重新保存或新建记录。

判分：**主任务**两轮事实与旧快照集合正确；更新不污染旧引用。模型若在首轮已读全4条，可以据既有证据正确回答第二轮，但未实际调用 read 时必须另记“固定结果续读/重读工具覆盖不足”，不能声称公开流程已验证。**解释**诚实说明旧快照与当前未知、不声称已经重查；未调用 read 不得假称“已重新打开/续读成功”。**关键约束**不让 V新 数据偷偷进入 V旧、不无据声称当前可用。**工具缺陷**真实固定结果读取失败、返回新版本数据或旧数据被覆盖是产品/流程问题；若无法核实数据或真实记录则先停止，不能宣称正式流程通过。

## N01：真零、已知部分、未知关系

**用户原文**：`分别说明“青埠台账”和“蓼湾调度”在我引用的“砾岸矩形”里有没有实际资源、查全没有、与本任务关系如何。不要把两个来源混成一个结论。`

初始显式引用 `A(N01)` 的 `n01-areas/n01-area`（砾岸矩形）：`R(121.00,31.00,121.04,31.04)`，无 resource。范围仅两个命名来源；车辆 scope=`n01-vehicles`，舟艇 scope=`n01-boats`。

| systemId / 来源名 | objectId | entityId | 名称 | 任务关系 | 状态证据 | 数量口径 | geometry 与 position |
| --- | --- | --- | --- | --- | --- | --- | --- |
| n01-qingbu / 青埠台账 | — | — | （该限定范围0记录，不创建空资源对象） | 无记录可判 | — | 无记录；统计数量0 | — |
| n01-liaowan / 蓼湾调度 | lw-car | lw-e63 | 蓼湾工程车 | U | 可用 | 1辆/entities/n01-vehicles | Point[121.012,31.017]；actual/resource |
| n01-liaowan / 蓼湾调度 | lw-boat | lw-e84 | 蓼湾轻舟 | U | 未知 | 1艘/entities/n01-boats | Point[121.029,31.021]；actual/resource |

HTTP 冻结计划：青埠只有一页空 items，hasMore=false，resourceCoverage=complete；蓼湾 page limit=1，两页依次是工程车、轻舟，同一固定来源快照，首有真实 nextCursor、末 hasMore=false，但两页均声明 `resourceCoverage={status:partial,reason:"只包含已接入站点，另有站点未同步"}`。任务关系为 unconfirmed，不以 U 行自动推出完整 task coverage。无后续用户事实。

人工预期：青埠在明确来源/范围/快照下真零，查询完整，仅说明该源无记录可判断任务关系；蓼湾已见内部车辆1辆与舟艇1艘，业务部分覆盖，两条关系未知。不可说“本任务资源为零/共2个/已经查全所有任务资源”。

判分：**主任务**两个来源分别给出存在性、完整性、任务关系三项，完成两页实际读取得到已见集合。**解释**区分限定来源真零与现实/任务全量；可用性不是任务关系证据。**关键约束**无部分冒充全量、无无据分配。**工具缺陷**重点检查空统计集合自校验中断；合法 data/task 任一路径中同根错误再现都算工具硬门槛失败，模型最后纠正无效。

## N02：五成员并集与单体受控副本

**用户原文**：`把“鹭桥车籍”的“晨组车辆汇总”和“暮组车辆汇总”去重，给我车辆名称名单和数量。图层里引用的“沄桥运输车副本”也要核对，别重复算同一辆。`

初始引用来源两个汇总对象与 `A(N02)` 的 `n02-copies/n02-copy-u`；来源 `n02-luqiao`，scope=`n02-fleet-entire`，数量都是车辆实体数。全部来源记录在同一 `systemId=n02-luqiao` 身份命名空间；参与数量去重的 category=vehicle、unit=辆、meaning=entities、scope、quantity.effectiveAt/validUntil 均相同，quantity.conditions 统一省略。coverage.scope 同为 n02-fleet-entire，查询 resourceCoverage=complete；capability 使用默认 identity task 映射和 explicit-task-relation 支援规则。来源可通过 situation_query 读到全部7行，下表各成员的 name/entityId 是真实可读映射，不依赖隐藏名单。两份汇总的 properties.memberRefs 分别是其成员单体的完整 ContextRef 数组，**不是新增字段**；是否读取它不影响可经单体字段独立证明姓名映射。

| systemId | objectId | entityId | 名称 | 任务关系 | 状态证据 | 数量口径 | 聚合成员 / 完整性 | geometry 与 position |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| n02-luqiao | lq-morning | — | 晨组车辆汇总 | U | 未知 | 3辆/entities/n02-fleet-entire | {lq-e17,lq-e26,lq-e39}，完整 | null；无 position |
| n02-luqiao | lq-evening | — | 暮组车辆汇总 | U | 未知 | 4辆/entities/n02-fleet-entire | {lq-e26,lq-e39,lq-e48,lq-e56}，完整 | null；无 position |
| n02-luqiao | lq-u | lq-e17 | 沄桥运输车 | U | 可用 | 1辆/entities/n02-fleet-entire | — | Point[121.011,31.012]；actual/resource |
| n02-luqiao | lq-v | lq-e26 | 澄砾运输车 | U | 可用 | 1辆/entities/n02-fleet-entire | — | Point[121.017,31.018]；actual/resource |
| n02-luqiao | lq-w | lq-e39 | 榆汀运输车 | U | 可用 | 1辆/entities/n02-fleet-entire | — | Point[121.023,31.024]；actual/resource |
| n02-luqiao | lq-k | lq-e48 | 荻石运输车 | U | 可用 | 1辆/entities/n02-fleet-entire | — | Point[121.029,31.030]；actual/resource |
| n02-luqiao | lq-m | lq-e56 | 岚湾运输车 | U | 可用 | 1辆/entities/n02-fleet-entire | — | Point[121.035,31.036]；actual/resource |
| annotation / n02-copies | n02-copy-u | 关联 lq-e17（非手写entityId） | 沄桥运输车副本 | 与 lq-u 同一事实 | 与 lq-u 同一事实 | 与 lq-u 同一事实 | — | 由 lq-u 真实导入，坐标同上；actual/resource |

准备副本时仅可用授权的 AnnotationFromSource 操作导入 `n02-luqiao/resource/lq-u` 的实际 revision；必须检查回执和宿主生成的 resourceAssociation.source/sourceRevision/entityId。如导入后需要名称显示为“副本”，可通过正常标绘改名，不能改关联或事实。禁止给 lq-morning/lq-evening 填 entityId，禁止导入聚合体后伪造单体身份。

无后续用户事实。人工并集：晨∪暮=`{lq-e17,lq-e26,lq-e39,lq-e48,lq-e56}`；3+4−2=**5辆**。名称对应上表5个单体；沄桥副本仍为 lq-e17，不增加第6辆。原来源对象7条加标绘副本1条可共读到8个条目，这不是8个实体；两份汇总之和7也不是实体去重数。

判分：**主任务**列出5个名称（可附ID）且数量5、副本不重复；用户已明确要名称，真实来源也提供可读映射，只给ID不提供名称是主任务不完整。**解释**至少说明两集合重叠的 lq-e26、lq-e39 和副本对应 lq-e17，身份依据可追溯。**关键约束**只在同来源身份命名空间与同 entities/scope 口径合并，不发明跨源映射，不把条目数说成实体数。**工具缺陷**满足完整成员集合前提仍把7或8当精确实体数，触发重复计数硬门槛；entityCount=null但 quantity/成员输出正确不自动判工具错误。

## N03：一组未知重叠，另一组可精确

**用户原文**：`这四份汇总合起来多少，哪些还不能确定？请按它们各自的统计范围分别说明：车辆看“石苔车辆范围”，舟艇看“汀镜舟艇范围”，不要把不同范围硬拼成一个数。`

初始明确引用来源 `n03-shitai` 的 st-known、st-unlisted 和 `n03-tingjing` 的 tj-upper、tj-lower。来源查询完整，但成员覆盖如下；两个 scope 不是相同群体或可加总口径。各组内部同 systemId 身份命名空间，category/unit/meaning/scope/quantity.effectiveAt/validUntil 相同、quantity.conditions 统一省略，coverage.scope=quantity.scope；组间不建立身份或加总关系。capability 使用默认 identity task 映射和 explicit-task-relation 支援规则。聚合 geometry 均 null、position 省略，entityId 一律省略。无成员姓名要求，仅以ID说明名单/重叠依据。

| systemId / 来源名 | objectId | entityId | 名称 | 任务关系 | 状态证据 | 数量口径 | 聚合成员 / 完整性 | 位置 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| n03-shitai / 石苔台账 | st-known | — | 石苔明细车辆汇总 | U | 未知 | 4辆/entities/n03-shitai-vehicles | {st-e12,st-e24,st-e37,st-e49}，完整 | 无位置 |
| n03-shitai / 石苔台账 | st-unlisted | — | 石苔未列成员车辆汇总 | U | 未知 | 6辆/entities/n03-shitai-vehicles | memberEntityIds省略，complete=false | 无位置 |
| n03-tingjing / 汀镜台账 | tj-upper | — | 汀镜上段舟艇汇总 | U | 未知 | 2艘/entities/n03-tingjing-boats | {tj-e15,tj-e29}，完整 | 无位置 |
| n03-tingjing / 汀镜台账 | tj-lower | — | 汀镜下段舟艇汇总 | U | 未知 | 3艘/entities/n03-tingjing-boats | {tj-e44,tj-e58,tj-e63}，完整 | 无位置 |

数量依据逐字声明：石苔两汇总“各自数量为同一车辆范围内不重复实体数，但未列成员汇总未披露身份，未声明与另一组是否重叠”；汀镜两汇总“成员列表覆盖本汇总全部实体，使用本来源相同实体ID命名空间”。这些声明通过对应 quantity.evidence/coverage 的真实字段可读。无后续事实，不追加“其实不重叠”。

人工预期：石苔已声明4辆与6辆，但身份交集未知，去重精确总数不能确定；若提供界限，只能在这些声明成立时给 **6至10辆**（交集0至4），不是已查得精确总量。汀镜两完整名单交集为空，因此 **5艘** 可精确；不能把汀镜也笼统说“都未知”。不同 scope/单位不形成一个实体数总计，不能输出“总共15辆/艘”或“全部11至15个”。

判分：**主任务**车辆未知与舟艇精确5同时正确；不强制输出车辆区间。**解释**说清未知的是重叠身份，不是来源分页未完或已知数量为零；舟艇依据完整互斥集合。**关键约束**无无据精确合并、无跨scope硬加、无把局部不确定扩散成全部未知。**工具缺陷**若工具直接精确合并车辆为10或跨scope给总数，触发缺乏合并依据硬门槛；如工具保持分组而模型乱加，则仅按模型业务失败计。

## N04：已分配与可用的交集、条件和状态冲突

**用户原文**：`核对“霁浦调度”和引用图层里的资源：哪些已经分配给本任务，而且现在能确认可用？请另列条件未确认、故障、过期或证据冲突等待核实项，并区分仅相关和潜在支援。平台里的引用本身别当成分配。`

初始引用 `A(N04)` 的 `n04-copies`；来源 `n04-jipu`（霁浦调度），scope=`n04-vehicles`。capability 使用共同规则的 identity task mapping 与 explicit-task-relation 支援规则。所有 quantity=1辆/entities/n04-vehicles，位置均为 actual/resource，全部来源记录可读。下面“条件”是 resource.availability.conditions 与同事实 evidence 的内容，不能解释成对用户额外施加要求。

| systemId | objectId | entityId | 名称 | 任务关系及证据 | availability事实及证据/时间 | geometry |
| --- | --- | --- | --- | --- | --- | --- |
| n04-jipu | jp-clear | jp-e10 | 桤岸保障车 | A，现行调度令 | available；“已放行，可出动；尚未收到通信回执，回执不是放行条件”，conditions=[] | Point[121.011,31.011] |
| n04-jipu | jp-cond | jp-e21 | 蕨港保障车 | A，现行调度令 | available；conditions=[“须完成承载复核后方可使用”]；证据“复核尚未确认完成” | Point[121.014,31.014] |
| n04-jipu | jp-expired | jp-e32 | 茶岬保障车 | A，关系仍有效 | available；reportedAt=T0-100分钟，effectiveAt=T0-110分钟，validUntil=T0-80分钟；没有续期 | Point[121.017,31.017] |
| n04-jipu | jp-dual-ready | jp-e43 | 柏屿保障车 | A，现行调度令 | available；“调度台报告可用”，effectiveAt=T0-10分钟，validUntil=T0+24小时 | Point[121.020,31.020] |
| n04-jipu | jp-dual-fault | jp-e43 | 柏屿保障车 | A，同一调度令 | unavailable；“检修台报告液压故障”，effectiveAt=T0-10分钟，validUntil=T0+24小时 | Point[121.020,31.020] |
| n04-jipu | jp-fault | jp-e54 | 榕坡保障车 | A，现行调度令 | unavailable；“制动系统故障，暂停出动” | Point[121.023,31.023] |
| n04-jipu | jp-related | jp-e65 | 枫埠保障车 | R，证据“仅与任务相关，未下达分配令” | available，无条件 | Point[121.026,31.026] |
| n04-jipu | jp-support | jp-e76 | 苔湾保障车 | S，证据“本任务潜在支援，尚未转为分配” | available，无条件 | Point[121.029,31.029] |
| n04-jipu | jp-unknown | jp-e87 | 沁洲保障车 | A，现行调度令 | unknown；“最新可用状态未核实” | Point[121.032,31.032] |
| n04-jipu | jp-refonly | jp-e98 | 槐堤保障车 | U，证据“关系未确认” | available，无条件；平台中可引用 | Point[121.035,31.035] |
| annotation / n04-copies | n04-copy-clear | 关联jp-e10 | 桤岸保障车副本 | 从 jp-clear 导入 | 同 jp-clear；真实宿主关联，不加新分配证据 | 由导入取得同坐标 |

准备说明：只有 jp-clear 单体经真实受控导入生成副本，检查回执/association；不得通过普通编辑写 association。jp-dual-ready 与 jp-dual-fault 是**同来源、同 entityId 的两个不同 objectId 记录**，两个当前有效事实地位相同、同 effectiveAt，无优先级、无撤销或覆盖声明。输入 availability.state 始终合法，不写不存在的 `conflict` 状态；冲突是工具/模型归并证据后的结论。taskRelations 与 quantity 时间默认有效，只有 jp-expired 的 availability 过期。**包括 jp-expired 在内，每条外层 SituationObject.effectiveAt=T0-10分钟、validTime={from:T0-10分钟,to:T0+24小时}，均仍有效**；不得把 availability.validUntil 复制为外层 validTime.to，从而让整条 jp-expired 被来源时效过滤掉。

无后续用户事实。人工预期：能确认已分配且可用只有 **桤岸保障车1辆**，副本不增加数量，未收到回执不取消已明确放行。蕨港=条件未确认；茶岬=可用证据过期待核实；柏屿=当前证据冲突待核实，不能择一当最终确定可用或确定故障；榕坡=明确故障不可用；沁洲=状态未知待核实；枫埠仅相关、苔湾潜在支援、槐堤关系未知，三者不能冒充已分配。10条来源记录是9个实体，加副本仍9个实体；用户没有要求总盘点，不必主动给总数。

判分：**主任务**交集只有桤岸，分列条件、过期、冲突、明确故障、未知及三类非分配关系。**解释**说明证据有效性、条件是否满足、冲突两事实及副本依据；特别不得把“未收到回执”改写为“未放行”。**关键约束**逐项检查无无据分配/可用、无副本重复、无自行消除冲突。**工具缺陷**若工具丢弃其中一个同entity有效事实或重复计数受控副本，记录实际故障及硬门槛适用性；模型忽略正确工具证据则不误报工具回归。

## N05：实际位置、边界、无实际位置与各项时间

**用户原文**：`按实际位置统计我引用的“鹤砾矩形”内车辆和舟艇，边界及没有可判定实际位置的资源分别列出；同时说明每项的数据时间、读取时间和统计范围。站址、计划位置不能当成员实际位置。`

初始只引用 `A(N05)` 的 `n05-areas/n05-area`（鹤砾矩形），`R(121.00,31.00,121.04,31.04)`；并在正常当前任务可见目录中提供两个相关来源 `n05-hekai`（鹤开车辆）、`n05-luting`（芦庭舟艇）。区域快照 `createdAt/ref/hash` 必须实读；准备完成后冻结，在整个任务内不变。

两来源快照有意不同：鹤开来源响应的 asOf 计划为 T0-20分钟，记录 reportedAt=T0-25分钟、effectiveAt=T0-30分钟；芦庭 asOf 为 T0-90分钟，reportedAt=T0-95分钟、effectiveAt=T0-100分钟；有效期均 T0+24小时。以上是合成来源真实 HTTP 响应的冻结计划。两个查询的真实 queriedAt 在执行后取得，不能提前填写为 T0。版本也分别保留来源真实 revision，**不能因 revision 都是整数就宣称同一版本/时刻**。

| systemId | objectId | entityId | 名称 | 任务关系 / 状态 | 数量口径 | 聚合成员 / 完整性 | geometry 与 position |
| --- | --- | --- | --- | --- | --- | --- | --- |
| n05-hekai | hk-all | — | 鹤开车辆全组 | U / 未知 | 4辆/entities/n05-hekai-vehicles | {hk-e13,hk-e27,hk-e42,hk-e68}，完整 | Point[121.02,31.02]；actual/**site**，站址 |
| n05-hekai | hk-in | hk-e13 | 青芒运输车 | U / 可用 | 1辆/entities/n05-hekai-vehicles | — | Point[121.01,31.01]；actual/resource |
| n05-hekai | hk-edge | hk-e27 | 银菰运输车 | U / 可用 | 1辆/entities/n05-hekai-vehicles | — | Point[121.00,31.02]；actual/resource |
| n05-hekai | hk-out | hk-e42 | 赭砂运输车 | U / 可用 | 1辆/entities/n05-hekai-vehicles | — | Point[121.05,31.02]；actual/resource |
| n05-hekai | hk-none | hk-e68 | 紫苇运输车 | U / 可用 | 1辆/entities/n05-hekai-vehicles | — | null；position=unknown/resource，证据“未获取实际坐标” |
| n05-hekai | hk-plan | — | 鹤开拟设车辆位 | — / — | — | — | Point[121.03,31.01]；meaning=planned_location，granularity=individual，position=planned/resource |
| n05-luting | lt-all | — | 芦庭舟艇全组 | U / 未知 | 4艘/entities/n05-luting-boats | {lt-e16,lt-e33,lt-e57,lt-e81}，完整 | Point[121.02,31.02]；actual/**site**，系泊站址 |
| n05-luting | lt-in | lt-e16 | 鹭纹救生艇 | U / 可用 | 1艘/entities/n05-luting-boats | — | Point[121.03,31.01]；actual/resource |
| n05-luting | lt-edge | lt-e33 | 荻帆救生艇 | U / 可用 | 1艘/entities/n05-luting-boats | — | Point[121.04,31.03]；actual/resource |
| n05-luting | lt-est | lt-e57 | 浦灯救生艇 | U / 可用 | 1艘/entities/n05-luting-boats | — | Point[121.015,31.025]；**estimated/resource**，证据“仅为估计位置” |
| n05-luting | （无单体对象） | lt-e81仅见于完整成员表 | （仅已知成员ID lt-e81） | 未提供单体关系/状态事实 | 已含在lt-all的4艘中，不添加quantity | 不创建虚构单体 | 没有成员geometry/position；不得拿系泊站址补齐 |

最后一行是聚合成员身份的展开说明，不生成来源 SituationObject。hk-all 的 properties.memberRefs 为四个车辆单体引用；lt-all 的 memberRefs 只能指向实际存在的 lt-in/lt-edge/lt-est，不构造 lt-e81 的假可读对象。完整成员ID已足以确定4艘的身份口径，缺的是其中成员实际位置。

无后续用户事实。人工预期（所有数量都在各自 scope 内）：

| 口径 | 严格内部 | 边界 | 外部（可作范围解释） | 无可判定实际位置 | 已知成员总数 |
| --- | --- | --- | --- | --- | --- |
| 鹤开车辆 | 青芒1辆 | 银菰1辆 | 赭砂1辆 | 紫苇1辆 | 4辆 |
| 芦庭舟艇 | 鹭纹1艘 | 荻帆1艘 | 0艘 | 浦灯lt-e57、lt-e81共2艘 | 4艘 |

站址两个点不增加资源数量，也不能把两组各4全部定位进矩形；计划位不计实际车辆。浦灯有几何点但不是实际位置，必须列到“无可判定实际位置/仅估计”而非严格内部。可以给内部加边界的闭区域已知结果为车辆2辆、舟艇2艘，但必须同时保留边界单列和未知位置，不能称这是可能处于区域内的完整总数。不能把车辆与舟艇跨scope相加成一个业务数量。完整成员依据允许上述4与4及已知空间分组，不应被泛泛“身份可能不可靠”警告抵消成所有数量未知。

判分：**主任务**两个范围的内部/边界/缺实际位置集合与数量正确，不把站址/计划/估计当成员实际坐标。**解释**必答来源各自 asOf/业务事实时间、真实 queriedAt、区域固定 ref/revision/createdAt，以及 scope/单位；可用易读时间表，不强求逐条重复相同时间。**关键约束**不造 lt-e81 坐标、不伪造平台时间、不将不同快照冒充同步现状、不部分冒充区域全部。**工具缺陷**若工具依据完整成员仍多计聚合/单体或用站址代替成员几何，记录真实输出；前者触发重复计数硬门槛，后者为独立空间产品错误。

## N06：单一区域真歧义，先问再完成

**用户原文**：`查北区内本任务可用资源，边界单列。`

初始显式引用 `A(N06)` 的 `n06-areas` 整个图层，正好有两个同名“北区”，没有选中对象附件、隐藏偏好或默认区域。两个 polygon note 可读：西侧北区、东侧北区。来源 `n06-rongchi`（榕池调度），scope=`n06-vehicles`，所有单体关系A且当前有效，因此无需再凭“本任务”猜分配口径。

| systemId / 图层 | objectId | entityId | 名称 | 任务关系 | 状态证据 | 数量口径 | geometry 与 position/注记 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| annotation / n06-areas | n06-west | — | 北区 | — | — | — | R(121.00,31.00,121.04,31.04)，note=西侧北区 |
| annotation / n06-areas | n06-east | — | 北区 | — | — | — | R(121.06,31.00,121.10,31.04)，note=东侧北区 |
| n06-rongchi | rc-w-in | rc-e14 | 榕荫保障车 | A | 可用 | 1辆/entities/n06-vehicles | Point[121.02,31.02]；actual/resource |
| n06-rongchi | rc-w-edge | rc-e25 | 池杉保障车 | A | 可用 | 1辆/entities/n06-vehicles | Point[121.00,31.03]；actual/resource |
| n06-rongchi | rc-w-fault | rc-e36 | 苍苔保障车 | A | 不可用，“电气故障” | 1辆/entities/n06-vehicles | Point[121.03,31.01]；actual/resource |
| n06-rongchi | rc-e-in1 | rc-e47 | 檀浦保障车 | A | 可用 | 1辆/entities/n06-vehicles | Point[121.07,31.01]；actual/resource |
| n06-rongchi | rc-e-in2 | rc-e58 | 雀榆保障车 | A | 可用 | 1辆/entities/n06-vehicles | Point[121.09,31.03]；actual/resource |
| n06-rongchi | rc-e-edge | rc-e69 | 萤湾保障车 | A | 可用 | 1辆/entities/n06-vehicles | Point[121.10,31.02]；actual/resource |

**仅在实际询问北区选哪一个时发送**：`选东侧北区，经度121.06到121.10、纬度31.00到31.04的那个。` 对结构化选项选择同一区域，留存选项到实际 objectId 的映射。若问法未能让人区别两个同名对象，可回复同一句既定事实，不补新的资源状态。

人工预期：先聚焦消歧；选定后东侧内部檀浦、雀榆2辆，边界萤湾1辆，均本任务已分配且可用。不输出西侧结果为最终目标，不自动合并两个北区。可以在询问时列两个区域的坐标/注记作区分，但不要先完成两区业务统计当作已经满足任务。

判分：**主任务**实际提出并等待必要消歧，收到冻结选择后完成东侧集合/数量；自行合并双区直接主失败。**解释**最终说明选择后的范围与边界口径；不能把初始缺少偏好归咎用户或按隐藏偏好扣分。**关键约束**不凭名称/默认顺序选择，不绕过等待而用双区答案替代。**工具缺陷**歧义应来自真实可读的两对象，追问输入记录必须可信；追问未送达属流程无效，已经送达但模型忽略属产品业务失败。

## N07：明确比较两个北区，不强迫选择

**用户原文**：`两个北区分别有哪些可用资源？请比较，内部和边界分开说明，不需要把两区合成一个总数。`

初始显式引用 `A(N07)` 的两个固定区域对象 `n07-areas/n07-w`、`n07-areas/n07-e`，均名“北区”，注记分别是西北区、东北区。来源 `n07-shilu`（石鹭资源），scope=`n07-vehicles`。所有单体可用当前有效、任务关系U；用户没有要求已分配，因此不可追加任务关系门槛。

| systemId / 图层 | objectId | entityId | 名称 | 任务关系 | 状态证据 | 数量口径 | geometry 与 position/注记 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| annotation / n07-areas | n07-w | — | 北区 | — | — | — | R(121.00,31.00,121.04,31.04)，note=西北区 |
| annotation / n07-areas | n07-e | — | 北区 | — | — | — | R(121.02,31.00,121.06,31.04)，note=东北区 |
| n07-shilu | sl-w | sl-e18 | 石芽运输车 | U | 可用 | 1辆/entities/n07-vehicles | Point[121.01,31.01]；actual/resource |
| n07-shilu | sl-shared | sl-e29 | 鹭羽运输车 | U | 可用 | 1辆/entities/n07-vehicles | Point[121.03,31.02]；actual/resource |
| n07-shilu | sl-e | sl-e41 | 砂汀运输车 | U | 可用 | 1辆/entities/n07-vehicles | Point[121.05,31.01]；actual/resource |
| n07-shilu | sl-w-edge | sl-e53 | 苇穗运输车 | U | 可用 | 1辆/entities/n07-vehicles | Point[121.00,31.02]；actual/resource |
| n07-shilu | sl-e-inneredge | sl-e67 | 青菱运输车 | U | 可用 | 1辆/entities/n07-vehicles | Point[121.02,31.03]；actual/resource |
| n07-shilu | sl-e-outeredge | sl-e79 | 霜菊运输车 | U | 可用 | 1辆/entities/n07-vehicles | Point[121.06,31.02]；actual/resource |
| n07-shilu | sl-out | sl-e83 | 卵石运输车 | U | 可用 | 1辆/entities/n07-vehicles | Point[121.07,31.03]；actual/resource |

无后续用户事实；模型若要求“请选择一个北区”，不发送隐藏选择来救场。人工预期：西北区内部={石芽,鹭羽,青菱}=3辆，边界={苇穗}=1辆；东北区内部={鹭羽,砂汀}=2辆，边界={青菱,霜菊}=2辆。两区各有闭区域4辆，但共享鹭羽与青菱，其中青菱对西侧是内部、对东侧是边界；卵石在两区外。不要求/不提供联合总量来替代分区比较。

判分：**主任务**直接完成两区分别查询与比较，不强迫单选；各集合、数量、边界正确。**解释**指出共享成员及其空间分类差别，避免称两区各4意味着8辆不同车。**关键约束**不强行任务关系门槛、不越范围、不无据合并身份。**工具缺陷**若两个合法 polygon 选择的几何/范围丢失或同一实体分区事实被错误覆盖，记录产品错误；若仅模型过度追问而工具正确，不归三项工具回归。

## N08：固定图层两轮口径，拒绝无关补查

**第一轮用户原文**：`只看我引用的“沚灯现场图层”中的实际资源，告诉我有哪些、分别在哪里。`

初始显式引用 `A(N08)` 的 `n08-target` 图层（沚灯现场图层），不是整个草稿；版本在首轮固定。同一草稿另有未引用图层 `n08-other`，且账号可读独立来源 `n08-yulan`（榆岚外部台账），它们都不在问题范围内。以下 annotation 行的系统定位均用真实 A(N08)，不伪装成来源系统。

| systemId / 图层 | objectId | entityId | 名称 | 任务关系 | 状态证据 | 数量口径 | geometry 与语义 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| annotation / n08-target | n08-note | — | 白砾观察点 | — | — | — | Point[121.011,31.013]；普通点，无 resource，informationRole=observation |
| annotation / n08-target | n08-plan | — | 芦影计划泊位 | — | — | — | Point[121.019,31.021]；resource.meaning=planned_location，position=planned/site，informationRole=plan |
| annotation / n08-target | n08-car | — | 沚灯运输车 | U | 未知，合成声明 | 1辆/entities/n08-vehicles | Point[121.027,31.029]；actual_resource/individual，position=actual/resource |
| annotation / n08-target | n08-boat | — | 菰湾救生艇 | U | 未知，合成声明 | 1艘/entities/n08-boats | Point[121.035,31.037]；actual_resource/individual，position=actual/resource |
| annotation / n08-other | n08-other-car | — | 枫沙运输车 | U | 可用，合成声明 | 1辆/entities/n08-other-vehicles | Point[121.02,31.02]；actual_resource/individual，position=actual/resource |
| n08-yulan / 榆岚外部台账 | yl-extra | yl-e64 | 榆岚运输车 | A | 可用 | 1辆/entities/n08-external-vehicles | Point[121.03,31.03]；actual_resource/individual，position=actual/resource |

只有目标图层4个点是可回答集合；不相关来源存在可读权限不等于有必要读取。不把外部数据或其他图层的数据放进初始显式引用。无控制器暗中更新版本，无额外业务事实。

**第二轮用户原文**：`同一图层全部点分别在哪里？`

人工预期：首轮只列沚灯运输车 `[121.027,31.029]` 与菰湾救生艇 `[121.035,31.037]`，无需追问任务分配或可用状态。次轮读/沿用同一固定版本目标图层全部4点，按表列出名称与坐标，并把普通观察点、计划泊位、两个实际资源清楚区别；不能因为首轮只要实际资源而次轮漏前两点。两轮均不读取 `n08-yulan` 或未引用的 n08-other 来补答案。正常目录/引用解析时只见来源名称不等于读取该源数据；审阅以实际读取/query行为为准。

判分：**主任务**首轮2个、次轮4个名称/坐标正确，固定引用一致；范围明确直接完成。**解释**准确解释第二轮“全部点”口径与首轮差别，未知任务/可用状态不是无法回答实际标绘位置的理由。**关键约束**不扩大到外部来源/其他图层、不把计划点说成实际资源、不换latest版本、不添加任务关系门槛。**工具缺陷**若固定图层选择漏失导致读取整个草稿或工具不能读取普通点，记录实际工具问题；模型主动无关补查则按范围约束失败，不自动归为工具缺陷。

## 冻结前的契约核对事项

1. `A(case)`、真实 task/session/owner 标识、来源 revision、固定 cursor/resultRef、createdAt/queriedAt/asOf 目前全是**待实际准备后读取映射**。不能在未获执行授权时为填表进行模型调用或测评，也不能把这些待准备项描述成已完成。最终冻结需审阅数据实际读回与本表语义是否一致。
2. N02/N04 的真实受控单体导入必须具备现有授权路径与回执；若只能手工编辑 association，题目准备无效，不能改写为伪造关联。聚合没有 entityId 是固定约束。
3. P04 使用现有 task_resource_query 的 query→resultRef→read offset/limit 固定结果路径，来源 HTTP 分页在首轮完成；不要求源 cursor 跨用户轮。获准准备时需留存实际 query/read 轨迹，证明旧结果可继续读且未被来源更新污染。未实际 read 而仅据首轮证据回答的，业务答案可正确，但这项工具流程覆盖不足，不能伪称已经验证。
4. N05 的几何分类是“有可用实际资源位置”口径，估计位置和站址均不用于实际成员定位；lt-e81 只有成员ID，其余字段不得补造。上述数据时间与平台真实版本时间是不同事实，最终题包必须保存实际响应，而非把相对公式当API回执。
5. 每道正式题第二遍可重新生成平台UUID与相对时钟，但必须逐行核对逻辑实体、来源命名空间、成员集合、数量、条件、追问文本和几何分类等价；不按第一遍表现调整难度、答案或评分。
