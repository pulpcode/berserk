# R14 closeout第10块：独立盲审

仅读指定15项匿名公开证据，未读初评、root状态审计、组映射或私有思考，未调用模型。按冻结五维及strict规则评分；不将completed计数或工具成功直接当正确率。

**主任务15通过；严格13通过、2失败；无待定。**

## 独立证据检查

- 三条D17实际均收到两条用户要求并完成：第一轮只读预览，第二轮保存同一resultRef/完全相同几何，恰新增1个名为临时范围的派生层面，旧16对象与图层元数据不变、无发布或采用。9f raw的incomplete/1轮是条件邀请误分类，仍判主任务通过；但首轮错误排序不能抹掉。1f首次保存not_committed缺少读取依据后自行补读成功，不作为失败。
- 其他12条before/after完全相同。D13独立haversine验证前二资源甲/乙；D14累加两段；D15球面横向距离且投影在线段内；D16按两个球面矩形带独立计算。数值详见JSON。
- 每项均检查模型当时实际得到的公开字段。026额外状态/类别来自nearest公开properties；6a的bbox4.11km²有实际已读坐标且独立公式核实；不得机械以未调用额外工具判错。

## 两项明确失败

190fcfa3：数值和几何关系正确，但“水侧在东侧”不由无属性的线和船位点推出，声明推断不能替代依据。

9f940de1：首轮称北点之后“其他对象更远”，实际已读并列乙与北点坐标完全相同，并列甲也同距；500m预览和第二轮保存均正确，附加排序事实失败。

## 逐项

### D13 · 026e69d9-e9f5-4eea-b888-f44b1d339b3e

mainRequirement=pass；processFacts=na；finalFacts=pass；effects=pass；boundaries=pass；strict=pass。

原句：“resources 图层其余 3 个点（资源丙、边界点、资源外）距离更远”

依据：nearest确实仅resources五点、origin作参照，前二资源甲/乙及556/1225m正确。额外更远结论有已读五点完整几何支持；ready/boat/truck来自nearest公开properties，不是未读字段推断；同名资源图层也有实际目录依据。

表达：清楚。

证据：`.local/spatial-r14/closeout-blind-chunk-10/026e69d9-e9f5-4eea-b888-f44b1d339b3e/{judge-input,model-visible-evidence,completion}.json`；精确字段见JSON evidence。

### D15 · 190fcfa3-02a1-4d52-88d2-645b73bc739a

mainRequirement=pass；processFacts=na；finalFacts=fail；effects=pass；boundaries=pass；strict=fail。

原句：“如果这段岸线按直线理解，则水侧位于其东侧”

依据：点到整条线513.6m、球面口径及垂足在线段内部正确，主任务通过；但实际证据仅线坐标和观察船位点，无水陆面、岸线朝向约定或水侧字段。船位在东侧只支持相对方位，不能推出东侧是水侧。标注“几何推断”“不等于真实水文”仍不能补足该条件推断依据，最终事实fail。

表达：额外无依据水侧推断。

证据：`.local/spatial-r14/closeout-blind-chunk-10/190fcfa3-02a1-4d52-88d2-645b73bc739a/{judge-input,model-visible-evidence,completion}.json`；精确字段见JSON evidence。

### D14 · 1ac064b8-9624-467d-91ca-726e6fa5f071

mainRequirement=pass；processFacts=na；finalFacts=pass；effects=pass；boundaries=pass；strict=pass。

原句：“整条折线由 3 个顶点组成，共 2 段，两段都参与计算”

依据：真实完整折线先读取再measure/length，北行0.01度后南返0.005度，约1111.95+555.97m，累计1667.926m；米/千米及合理取整正确。只是读取草稿在此指未改草稿，没有否认测量。

表达：清楚。

证据：`.local/spatial-r14/closeout-blind-chunk-10/1ac064b8-9624-467d-91ca-726e6fa5f071/{judge-input,model-visible-evidence,completion}.json`；精确字段见JSON evidence。

### D14 · 1dda9cdb-fc95-470a-8bb7-d3a9309c1f49

mainRequirement=pass；processFacts=na；finalFacts=pass；effects=pass；boundaries=pass；strict=pass。

原句：“本次计算的是这两段折线的球面测地长度之和”

依据：实际length正确，最后补读几何发生在解释前；3顶点2段与全部坐标有实际证据，1667.93m/1.668km正确，不用首尾净距离代替。

表达：清楚。

证据：`.local/spatial-r14/closeout-blind-chunk-10/1dda9cdb-fc95-470a-8bb7-d3a9309c1f49/{judge-input,model-visible-evidence,completion}.json`；精确字段见JSON evidence。

### D17 · 1f56ae20-c3c5-4b29-a8cc-0006200456a3

mainRequirement=pass；processFacts=na；finalFacts=pass；effects=pass；boundaries=pass；strict=pass。

原句：“按原样保存，未重新计算”

依据：两轮均执行。首轮buffer500m不写；第二轮首次保存报ANNOTATION_READ_REQUIRED且not_committed，补读draft后沿相同resultRef保存成功，属于正常自纠。实际恰新增temp-500m，原16对象及图层不变、同原几何、revision1→2、无发布/采用。首轮“只存在于预览结果中”结合未写入草稿是业务状态说明，并未声称仅存内存或不持久化。

表达：清楚；查询时间表述为计算时间属于本次计算所用读取时刻，不作储存机制断言。

证据：`.local/spatial-r14/closeout-blind-chunk-10/1f56ae20-c3c5-4b29-a8cc-0006200456a3/{judge-input,model-visible-evidence,completion}.json`；精确字段见JSON evidence。

### D14 · 551fd6b3-0a1c-437b-b6f2-371b60899536

mainRequirement=pass；processFacts=na；finalFacts=pass；effects=pass；boundaries=pass；strict=pass。

原句：“第二段：(114°E, 22.51°N) → (114°E, 22.505°N)，折返向南。”

依据：固定revision读取几何，实际length包含折返段；1667.93m/1.668km、南北方向及未用首尾净距均正确。“保留两位小数即1667.93m”是对原米值取整，非把1.668km误换单位。

表达：清楚。

证据：`.local/spatial-r14/closeout-blind-chunk-10/551fd6b3-0a1c-437b-b6f2-371b60899536/{judge-input,model-visible-evidence,completion}.json`；精确字段见JSON evidence。

### D16 · 6a5baeeb-ebe4-40b9-8332-e35a1fe19677

mainRequirement=pass；processFacts=na；finalFacts=pass；effects=pass；boundaries=pass；strict=pass。

原句：“其外接矩形约为 0.02°×0.02°，即约 4.11 平方千米”

依据：模型实际读到完整凹形坐标，6独立顶点及无孔成立；真实面积3080511.81m²/3.0805km²正确。额外bbox可由已读范围和球半径独立计算为4.107429km²，4.11合理；不因没另调测量工具否定有依据的推导。

表达：清楚。

证据：`.local/spatial-r14/closeout-blind-chunk-10/6a5baeeb-ebe4-40b9-8332-e35a1fe19677/{judge-input,model-visible-evidence,completion}.json`；精确字段见JSON evidence。

### D13 · 9807cf39-9858-489d-bf73-933f7b7a72f6

mainRequirement=pass；processFacts=na；finalFacts=pass；effects=pass；boundaries=pass；strict=pass。

原句：“候选范围：仅 `resources` 图层，共 5 个点”

依据：目录及nearest参数支持严格候选范围；结果资源甲/乙555.9754/1224.8495m，556/1225m和0.56/1.22km属于声明精度下合理四舍五入。其他同名图层排除及同距不扩大说明由目录/方法支持。

表达：清楚。

证据：`.local/spatial-r14/closeout-blind-chunk-10/9807cf39-9858-489d-bf73-933f7b7a72f6/{judge-input,model-visible-evidence,completion}.json`；精确字段见JSON evidence。

### D17 · 9f940de1-cd88-4934-a652-07f84712069b

mainRequirement=pass；processFacts=na；finalFacts=fail；effects=pass；boundaries=pass；strict=fail。

原句：“最近的是「资源甲」（约 556 米）和「北点」（约 1.11 公里），其他对象更远”

依据：预览500m、只命中origin及后续保存同一固定范围均正确，主任务通过。首轮额外全草稿排序却说其他对象更远；已实际读取north=[114,22.51]、tie-b同坐标、tie-a=[114,22.49]，相对origin=[114,22.5]均约1111.9508m，至少并列乙与北点完全相同。“其他对象更远”明确错误；后续正确保存不撤销此前最终事实错。raw的1/2与unnecessary_confirmation是末尾可选邀请误分类，实际两条user及成功保存回执齐全。

表达：明确遗漏并列并错误声称更远；“圆心含边界”可理解包含规则，不另扣分。

证据：`.local/spatial-r14/closeout-blind-chunk-10/9f940de1-cd88-4934-a652-07f84712069b/{judge-input,model-visible-evidence,completion}.json`；精确字段见JSON evidence。

### D17 · ac853964-ad00-47a3-b97b-00c004070d53

mainRequirement=pass；processFacts=na；finalFacts=pass；effects=pass；boundaries=pass；strict=pass。

原句：“几何为原样采用，未重画、未重算”

依据：首轮只buffer500m，第二轮读draft并from_analysis保存原ref；真实只新增tmp-scope，几何逐值相等，原16对象与图层不变，derived默认可见及revision1→2有读取/回执依据。明确未查询当前采用而未修改，未擅称全局不存在当前版本。

表达：清楚。

证据：`.local/spatial-r14/closeout-blind-chunk-10/ac853964-ad00-47a3-b97b-00c004070d53/{judge-input,model-visible-evidence,completion}.json`；精确字段见JSON evidence。

### D16 · ae94ee16-6d4b-4aa3-808c-75f33db1d793

mainRequirement=pass；processFacts=na；finalFacts=pass；effects=pass；boundaries=pass；strict=pass。

原句：“该计算直接采用网点面对象自身的完整多边形几何”

依据：合法area对固定对象计算支持实际轮廓，数值及单位正确；没有声称读取具体坐标/顶点数量。L形拐角/内凹原样计入在全文是未用bbox填平的意思，不解释为把缺角当面积；用户明确指定L形对象，工具真实面积支持回答。未保存指未写草稿，后续可追溯固化是可选提议，非断言当前没有任何分析证据。

表达：网点面用词别扭；内凹“按原样计入”建议说按轮廓保留。

证据：`.local/spatial-r14/closeout-blind-chunk-10/ae94ee16-6d4b-4aa3-808c-75f33db1d793/{judge-input,model-visible-evidence,completion}.json`；精确字段见JSON evidence。

### D13 · bc2a0d86-7445-4d7b-b7e3-f5124aa2f8e3

mainRequirement=pass；processFacts=na；finalFacts=pass；effects=pass；boundaries=pass；strict=pass。

原句：“其余候选（资源丙、边界点、资源外）距离更远，未入选。”

依据：origin和resources五点均实际读取完整几何，nearest固定仅该层前二；555.98/1224.85m正确，其他三点更远可独立距离验证，未混入其他图层。

表达：清楚。

证据：`.local/spatial-r14/closeout-blind-chunk-10/bc2a0d86-7445-4d7b-b7e3-f5124aa2f8e3/{judge-input,model-visible-evidence,completion}.json`；精确字段见JSON evidence。

### D15 · bd3e44c3-fdb3-4766-8d19-b0836b847661

mainRequirement=pass；processFacts=na；finalFacts=pass；effects=pass；boundaries=pass；strict=pass。

原句：“**最短地理距离：约 513.62 米**”

依据：实际对点与完整LineString调用point_to_line，数值与独立真值一致；垂足或端点是一般方法解释，并未冒充已观察本例垂足。球面距离不代表航程/可通行表述准确。

表达：清楚。

证据：`.local/spatial-r14/closeout-blind-chunk-10/bd3e44c3-fdb3-4766-8d19-b0836b847661/{judge-input,model-visible-evidence,completion}.json`；精确字段见JSON evidence。

### D15 · d23ccd77-86f8-48b6-928c-3d4d523e5c55

mainRequirement=pass；processFacts=pass；finalFacts=pass；effects=pass；boundaries=pass；strict=pass。

原句：“本次读取到 2 个对象，均参与了这次计算”

依据：公开过程说已有点与线时已收到真实目录；实际point_to_line输入点/参照线二者均参与，候选与参照角色没有混淆；513.6m及完整线段和球面限制正确。

表达：清楚。

证据：`.local/spatial-r14/closeout-blind-chunk-10/d23ccd77-86f8-48b6-928c-3d4d523e5c55/{judge-input,model-visible-evidence,completion}.json`；精确字段见JSON evidence。

### D16 · f3351e45-19bf-4240-af5a-0ef1261f7e81

mainRequirement=pass；processFacts=pass；finalFacts=pass；effects=pass；boundaries=pass；strict=pass。

原句：“本次使用 `measure / area` 按其真实多边形轮廓计算”

依据：先目录确认真实polygon身份，再area固定对象。面积3080511.81m²、3.08km²及除1000000正确；不强制额外读坐标才能报告可靠area算法采用实际轮廓。未追加顶点/宽度等未经读取指标。

表达：清楚。

证据：`.local/spatial-r14/closeout-blind-chunk-10/f3351e45-19bf-4240-af5a-0ef1261f7e81/{judge-input,model-visible-evidence,completion}.json`；精确字段见JSON evidence。

## 验证边界

仅新增独立评分JSON/Markdown；保留原始记录及初评。检查覆盖15项索引、Score/strict合成、公开证据时点、独立数值和实际状态。未改冻结代码/产品/Skill，未重跑或追加付费测试。本审计是Agent独立复核，不是人工金标。
