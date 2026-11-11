# R12 B 来源处理：12 项结果语义复核

> 2026-10-25。Agent 逐项复核，不是人工金标；评分口径为 [review-rules.md](review-rules.md)。原始回答、工具参数和状态均保留，没有重跑任务、调用裁判或追加测评。

## 结果怎样理解

| 组 | 完成记录 | 主任务完成 | 严格通过 | 过程/最终事实 | 只读边界 |
|---|---:|---:|---:|---:|---:|
| B0 当前指引 | 6/6 | 6/6（100%） | 6/6（100%） | 各 6/6 | 6/6 |
| B1 来源候选指引 | 6/6 | 5/6（83.3%） | 5/6（83.3%） | 各 6/6 | 6/6 |

B1 唯一失败是 B03：草稿内的计算和解释都正确，但没有发现另一来源的同名区域，也未消歧或完整分别回答。事实轴只判断已说内容是否有据；漏答和来源错误单列，并使主任务与严格总评失败，不能拿“说出的数字都对”当整体通过。

六对中五对都通过，一对为 B0 通过、B1 失败；本批没有 B0 主任务失败可供修复，修复数为 0。未达到“至少修复两项基准失败且无指定场景退步”的扩展信号。单题一次差异不能证明候选稳定退化，更不能归因某一条 Skill 文案；本组同时调整来源指引与相关工具说明。

这只是六类开发诊断，不能解释为真实功能正确率、独立保留集验收或已达到整体 90%。没有自动扩大样本。

## 每项的四步证据

完整公开原句和真实调用参数保存在 [source-reviewed-scores.json](source-reviewed-scores.json)，可用 messageId 定位 review.json；原始证据目录为仓库下 `.local/spatial-r12/source-batch-20261025/<id>/`。B05 包括两轮，其余各一轮。

### B01-B0：主任务 pass；严格 pass

- 来源发现：用户明确指定草稿 region / resources；annotation_read 读取草稿，未查询来源。
- 歧义处理：明确来源，无需澄清。
- 计算输入：classify_points：input=草稿 resources；target=草稿 region；5 个候选，内部 2、边界 2、外部 1。
- 解释核验：4 个命中名称及内部/边界分类与回执一致；未以 ready 筛选。
- 定位：`.local/spatial-r12/source-batch-20261025/B01-B0/review.json`；公开消息 `eb9e02f2`, `673a2c66`；实际参数见同目录 `tool-arguments.json`。

### B01-B1：主任务 pass；严格 pass

- 来源发现：用户明确指定草稿；annotation_read 后直接按两个标识计算，未查询来源。
- 歧义处理：明确来源，无需澄清。
- 计算输入：classify_points 正确使用 layerIds=[resources] 与 objectIds=[region]。
- 解释核验：名单、4 个命中、4 个 ready 有回执支持；“你自己画的点”由题干“我画的点”支持。
- 定位：`.local/spatial-r12/source-batch-20261025/B01-B1/review.json`；公开消息 `bccd31a5`, `654724bf`；实际参数见同目录 `tool-arguments.json`。

### B02-B0：主任务 pass；严格 pass

- 来源发现：situation_query(query=西区) 得到 area/resource/road，hasMore=false；未读草稿。
- 歧义处理：明确 situation 来源，无需澄清。
- 计算输入：按 objectType=resource 及 availableCount 属性区分点数与车辆数，无须强制空间工具。
- 解释核验：资源名称、1 个点、availableCount=4 辆正确；时间、版本、完整查询均由回执支持。
- 定位：`.local/spatial-r12/source-batch-20261025/B02-B0/review.json`；公开消息 `2239bb11`, `023a4837`；实际参数见同目录 `tool-arguments.json`。

### B02-B1：主任务 pass；严格 pass

- 来源发现：只查询 situation，返回西区 area、resource、road，hasMore=false。
- 歧义处理：明确 situation 来源，无需澄清。
- 计算输入：筛选资源对象并读取属性，未把 area/road 算为车辆资源点。
- 解释核验：1 个资源点、4 辆属性数量及三个时间字段均与回执一致。
- 定位：`.local/spatial-r12/source-batch-20261025/B02-B1/review.json`；公开消息 `854eca86`, `6a5c17b8`；实际参数见同目录 `tool-arguments.json`。

### B03-B0：主任务 pass；严格 pass

- 来源发现：主动 annotation_read + situation_query，实际发现草稿与来源两个西区。
- 歧义处理：明确说明两定义，完整分别回答草稿与来源；未合并，非末尾另查冒充澄清。
- 计算输入：草稿 classify_points；来源 relate contains（闭区域，含边界）；两组区域/候选来源分别对应。
- 解释核验：草稿 4 个命中/5 候选；来源 1 个资源对象、4 辆属性数量。全部与实际回执和 fixture truth 一致。
- 定位：`.local/spatial-r12/source-batch-20261025/B03-B0/review.json`；公开消息 `33d6b161`, `4cc19b56`, `d15d59e2`；实际参数见同目录 `tool-arguments.json`。

### B03-B1：主任务 fail；严格 fail

- 来源发现：仅 annotation_read，未 situation_query；未发现第二来源的具体候选。
- 歧义处理：没有普通澄清或交互 API，也未分别回答来源；默认把“本会话”绑定为草稿。
- 计算输入：在自选的草稿范围内计算正确，但未经用户指定/澄清的范围不能代表完整问题。
- 解释核验：草稿 4 个命中及分类/状态均正确；缺少来源分歧处理，属于漏处理而非几何数值算错。
- 定位：`.local/spatial-r12/source-batch-20261025/B03-B1/review.json`；公开消息 `43305d22`, `d0bad110`；实际参数见同目录 `tool-arguments.json`。

**失败原句**：> 位于西区范围内（含边界）的资源点共 4 个

**反证**：用户未指明草稿；workspace 明确“本会话”不自动指定草稿。真实 sourceBefore 及 truth 另有 situation 西区和 1 个资源点；轨迹仅 annotation_read/classify_points，无来源查询、澄清或来源分项答案。4 点是已选择草稿口径下正确结果，但不是完整问题的唯一依据。

结论：不是工具几何错误、没有正文送达或未接上合理澄清。

### B04-B0：主任务 pass；严格 pass

- 来源发现：首个 provider 请求已带真实 annotation_read/situation_query 的 providedQueries；据此识别两个来源。
- 歧义处理：完整分别回答两个来源；末尾邀请选一组为后续建议，不计本轮澄清。
- 计算输入：草稿正确；来源首次 areaIds 包含非点，工具拒绝；随后 objectRefs 收窄到 resource，成功得 1 内部点。
- 解释核验：草稿 4 点、来源 1 点/4 辆正确，未把失败调用谎报为成功；全文分开两来源。
- 定位：`.local/spatial-r12/source-batch-20261025/B04-B0/review.json`；公开消息 `ce072f21`, `f85152b5`；实际参数见同目录 `tool-arguments.json`。

### B04-B1：主任务 pass；严格 pass

- 来源发现：首个请求已收到真实两来源候选，直接利用。
- 歧义处理：分别回答两来源，不合并/去重，未要求必须调用交互 API。
- 计算输入：两次 classify_points，分别草稿 region/resources 与来源 area/resource，均成功。
- 解释核验：草稿 4 点且 ready/boat2/truck2；来源 1 内部点及 availableCount=4，均有依据。
- 定位：`.local/spatial-r12/source-batch-20261025/B04-B1/review.json`；公开消息 `0e707689`, `8f1b3624`；实际参数见同目录 `tool-arguments.json`。

### B05-B0：主任务 pass；严格 pass

- 来源发现：第 0 轮用户明确草稿对象/图层；第 1 轮按此前指代读取，不重新猜测来源。
- 歧义处理：前文已唯一指定，无须重复澄清。
- 计算输入：第 0 轮仅确认；第 1 轮草稿 classify_points，5 候选/4 命中。
- 解释核验：两轮公开说法和当轮状态一致；没有把确认轮说成已经读取/完成计算。
- 定位：`.local/spatial-r12/source-batch-20261025/B05-B0/review.json`；公开消息 `9ef0dc3f`, `f53fd812`, `a9c61c6d`；实际参数见同目录 `tool-arguments.json`。

### B05-B1：主任务 pass；严格 pass

- 来源发现：第 0 轮明确草稿；第 1 轮定向读取 region 几何与 resources 属性。
- 歧义处理：沿用已明确前文指代，无多余消歧。
- 计算输入：第 0 轮无工具；第 1 轮 layerIds/objectIds 分别正确，5 候选/4 命中。
- 解释核验：第 0 轮 setId/revision 来自宿主真实自动会话上下文，不是未读先猜；几何、个数在第 1 轮取证后报告。
- 定位：`.local/spatial-r12/source-batch-20261025/B05-B1/review.json`；公开消息 `3cedd7e7`, `0d4319e1`, `5c3ad757`；实际参数见同目录 `tool-arguments.json`。

### B06-B0：主任务 pass；严格 pass

- 来源发现：annotation_read + situation_query，分别取得草稿候选与来源区域。
- 歧义处理：用户明确跨来源两个角色，无须澄清，不合并资源集合。
- 计算输入：classify_points：input=草稿 resources；target=来源 area；未改用草稿面或来源资源。
- 解释核验：仅 r1/资源甲 内部，其他 4 点外部，boundary=0；“边界点”名称不代替几何。
- 定位：`.local/spatial-r12/source-batch-20261025/B06-B0/review.json`；公开消息 `2cd0a7b6`, `a26a6a2b`；实际参数见同目录 `tool-arguments.json`。

### B06-B1：主任务 pass；严格 pass

- 来源发现：定向读取 resources 几何 + situation_query，取得两个指定角色的实际对象。
- 歧义处理：明确跨来源要求，按原意执行。
- 计算输入：input=草稿 resources，target=来源 area；全部 5 点计算完整。
- 解释核验：1 内部、0 边界、4 外部及名称正确，保留只读边界。
- 定位：`.local/spatial-r12/source-batch-20261025/B06-B1/review.json`；公开消息 `b34928a5`, `1166ff8b`, `b0c30836`；实际参数见同目录 `tool-arguments.json`。

## 争议措辞如何判

以下均按全文语义记表达问题，不把合理语境解读硬判成无依据事实。不是排除公开过程：对应原句、反证和判定理由全部保留。

- **B01-B0**：“结果范围已生成”。表达建议，不单独判错。同句明确没有添加草稿对象；结合 classify_points 的分析结果范围理解，不等同于宣称生成并保存面对象。
- **B01-B1**：“确认这两个图层（region 西区和 resources 资源图层）的实际几何与资源点”。表达问题，不单独判过程事实失败。region 实际是 reference 层的对象，确有类型口误；该句是将要读取的计划，实际计算及最终回答正确区分区域和资源图层，未声称已查询两个图层。若按术语逐字扣分，B1 严格数会由 5/6 降为 4/6，但不改变无改善结论。
- **B02-B0**：“该区域另外两个成员对象是区域本身和“西区通道”道路”。表达歧义，不按全文判事实错误。memberRefs 的确只有 road/resource，不含区域本身；但查询 items 有 area/resource/road，三者 areaIds 都为西区。全文在列查询结果并排除非车辆对象，未声称 memberRefs 含自身，允许“成员”泛指查询所得对象。应改称“返回的另外两个对象”。若坚持 memberRefs 狭义理解，B0 严格数为 5/6，仍无两项修复信号。
- **B03-B0**：“草稿“西区”是本次会话的标绘副本”。用词建议，不判无依据来源复制。句子紧接“与来源区域对象各有身份，同名不构成同一对象”，没有声称从 situation 复制；不扩写为原文没有的来源关系。建议直说“草稿标绘对象”。
- **B04-B0**：““本会话”对应的草稿里有两个名为“西区”的对象范围”。表达问题，全文已明确拆分来源。同一句后半及两个章节明确一组在草稿、一组在态势系统；实际两套计算也分离。不能孤立前半句判定模型实际混合了来源。

如果用户后续决定术语逐字口径更严，应另报敏感性或统一校准，不能悄悄修改本批分母或原始记录。上述表达仍值得改进，但没有证据支持把它们解释为已选错对象或错误保存。

## Skill 送达、交互与工具自纠

- `map-annotations` 与 `spatial-analysis` 各自实际正文送达 12/12 项、35/35 次请求，10 个有空间计算的任务均在首次计算之前收到两份正文；另 2 项仅查询来源属性，不要求调用计算工具。证据为 `provider-*-delivery.json` 的 `actual.skills.*.bodyPresent` 与实际 wire 输入。
- 主动 `skill_read` 为 0；两组都是同位置预加载，不能据此评估主动加载是否改善。B03-B1 失败发生在指引已送达后。
- B03-B0、B04 两组通过完整分别答两来源解决歧义。没有普通澄清或交互 API，未出现合理澄清未被驱动承接的问题；这一小批也没有覆盖澄清交互执行能力。末尾“如果需要再查/选一组”不计为已完成澄清。
- B04-B0 来源首次用 `areaIds` 取到非点，得到 `SPATIAL_UNSUPPORTED_GEOMETRY`；同一任务随后改为资源 `objectRefs` 后成功。原始失败调用保留，属于自主修正工具参数，不是重跑整项、付费裁判重试或新增试验。无需因中间失败机械判最终任务失败。

## 完整性与限制

- 原始 B 文件按每项目录的 evidence-hashes.json 核对，共 395 个，0 变化；历史 R11 4002 个文件也全部未变。
- 12 项地图/草稿状态均不变，没有新增、修改、发布或采用对象；全部实际工具调用只有读取/查询/空间分析。状态证据与语义判断分开记录。
- 原始实际工具回执与隐藏 truth 交叉核对；不把隐藏答案当作模型已知证据。B05-B1 第一轮所说草稿 setId/revision 确在宿主 wire 上下文中，不能误判为凭空猜测。
- 本次复核没有修改产品或冻结驱动，没有调用任何模型/API测试，没有追加真实任务。
