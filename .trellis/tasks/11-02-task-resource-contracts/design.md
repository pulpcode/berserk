# 第一批技术边界

## 现有缺口与落点
标绘严格字段白名单尚无资源语义；来源 resource 只有 availableCount + 辆；sourceRefs 是可编辑引用而非实体证明。必须在共享 contracts 与 AnnotationService 原有校验/提交链路承载新数据，不能只在模型输出端加提示。

## 最小数据流
来源适配或显式声明 → 共享字段解码 → 现有 AnnotationService 授权/版本检查 → 原有 JSON 快照 → 读回/公开投影。

建议一个 contracts/task-resources.ts 管理字段、共享校验和最小适配契约，AnnotationFeature 仅增加可选资源字段；必要的来源扩展维持旧 resource properties 可读。确定性小校验函数可新增，但不写第二批业务查询聚合器。
- 记录身份与实体身份分开。实际资源标志是声明，不自动认证存在/可用。
- 受控实体关联只由已验证的来源导入或服务操作生成，普通 add/update 不得直接填入受信关联。新来源数据有明确单体身份才建立单体关联，旧汇总 availableCount 不能擅自升级。
- 普通复制默认不继承受信实体关联；明确同一实体的可验证路径可保留。复制后的事实仍是固定快照，不自动刷新现实状态。
- 新字段可含来源事实引用，但不能让请求伪造授权或宿主确认字段。跨来源依赖与固定私有引用须走现有权限或公开投影，不能漏记来源系统。
- 元信息与 association 结构的确切名称由实施者结合现有服务最小化确定，并在本文件追加最终字段表；不需要用户选择字段名。
- 会话补充仅定义带出处的声明/引用契约，不新建自然语言抽取或记忆库。第一批不承诺验证用户陈述的客观真假。

## 兼容
沿用现有 optional schemaVersion 1 扩展模式，但所有严格读写/投影路径必须一起支持。旧数据不插入新默认字段；旧快照/哈希不改。公开投影的新增裁剪只能作用于新字段。不能把新语义丢弃后保存。新字段存在后回滚须保留读取能力。

## 预计改动位置
- src/contracts/task-resources.ts（新）：共享业务字段、校验与适配定义。
- src/contracts/annotations.ts、src/annotations/validation.ts、service.ts：字段读写和受控关联、权限/公开处理。
- src/contracts/context.ts、src/context/validation.ts 及必要的小型适配模块：来源扩展与旧属性兼容。
- src/pi/annotation-tools.ts（如需）：仅已有工具 schema/读取字段一致性，不改流程或 Skill。
- fixtures/task-resources-v1 与对应 tests：构造开发样例和服务/契约检查。
- 必要的共享历史解码/投影仅做兼容补齐；不改旧渲染文本。

不调整 UI、模型配置、空间引擎和运行中线上服务。遇到边界外改动先报告根会话。

## 第一批最终字段与生命周期实现

- `AnnotationFeature.resource?: TaskResource` 为可编辑声明；`meaning` 区分 actual_resource / planned_location / annotation / unspecified。category 使用固定首版目录，granularity 使用 individual / aggregate / unknown；缺省不补值。
- quantity 分开 value（null 是未知）、unit、meaning（entities / available / records）、scope；整数计数与类别单位、单体上限受共享校验。taskRelations、availability、position 各有独立 evidence、reportedAt/effectiveAt/validUntil、conditions；时间不补默认有效期。
- evidence 是 declaration、source 固定修订、annotation 固定对象。它定位被引用资料，不认证该资料支持当前声明；annotation 引用会核对实际对象和权限，source 系统与间接 annotation 来源都进入原有单调 requiredSystemIds。
- `resourceAssociation?: {source,sourceRevision,entityId}` 为宿主字段，只由 `annotation_from_source` 对已授权且明确实际单体+entityId 的 `SituationObject.resourceData` 生成。entityId 在来源系统命名空间内有效，不是跨系统自动匹配。普通 add_layer/add_object/update_object 不可填此字段。来源系统保留真正业务实体映射的责任。
- 普通 copy_object 清除 association；固定基线派生保留合法固定关联。编辑状态、时间、数量说明、计划位置/geometry 保留关联；resource meaning/granularity/category 改为不兼容单体含义时清除。sourceRefs/originFeatureRef 永不升级成关联。
- 来源 refresh 仍只更新原几何和 sourceRefs 修订/查询时间，保留业务 resource 与 association 的原固定依据；存在 association 时，新来源必须仍明确相同 source+entityId，否则拒绝整批刷新（缺失/汇总/改实体均拒绝），不暗换身份或更新资源可用事实。
- 发布共享 resource 声明值，private annotation evidence 变成明确声明“发布者共享的声明；私有依据未公开，未经来源认证。”，不含原私有 locator；同一投影用于公开读回、公开哈希和跨席位派生。原有 source 权限限制继续继承。
- SituationObject 可选 resourceData 为显式适配元信息；旧 availableCount+辆 原样保留、不自动补资源字段、不认证单体。新类别允许 resourceData 与空 properties；同来源 evidence 可用，适配器拒绝私有 annotation 和跨来源 evidence。
- ResourceSourceCapability / ResourceQueryScope / ResourceCoverage 与其解码是第二批交接契约；明确支援规则、taskIdMapping、筛选能力、固定修订分页和 complete/partial/unavailable/unsupported，尚无资源查询执行器。
- `partial` 同时支持“还有下一页”和“来源只覆盖局部、无法续页”：需有快照时间，并提供游标或非空白原因之一。`complete` 不带下一页游标；不可用/不支持必须说明原因，不能当零资源。
- ConversationResourceSupplement 仅定义具体 user message locator、task/resource 身份、时间和声明；本批不保存原生消息凭证、不抽取自然语言，后续 Pi 消费方仍须核实实际分支消息与授权。它不进入普通标绘 evidence，避免把未经解析的消息 ID 认证成事实。
- TypeBox 共享 schema 同时用于声明校验与现有 annotation_action 参数；annotation_read 可选读取 resource/resourceAssociation，普通摘要与历史包裹版本不变。无 SQL 迁移或旧哈希重写。
