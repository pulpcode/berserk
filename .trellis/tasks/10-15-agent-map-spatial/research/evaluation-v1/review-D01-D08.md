# D01—D08 独立证据审阅
审阅者：agent:spatial_evaluation（AI代理审阅，不冒称人类）。代码、Skill、冻结用例和score均只读。

已审阅 72/72；维度全通过 44，存在失败维度 28，含评分器缺陷独立裁定 9。未完成项不计通过。维度通过不覆盖原score，相关adjudication须与原评分并列。

评测设计勘误（root已核实，冻结产物保持原样）：D18纯改名是非空间分析负向用例，原requiresSkill标记因category!=basic被错误设true。最终Skill加载率应并列报告原冻结分母及剔除D18的原计划分母；D18仍保留完整语义与副作用评分，不扩大排除其他边界用例。

共享契约歧义：D07的工具方法仅写32 steps，未说明每象限；全部9条回答转述完整缓冲为32段，而独立检查实际环129点=128条边。按统一claims规则记普通失败，非critical；7份旧审阅已快照保留。仅此术语导致失败的条目为D07-1-B、D07-2-A、D07-2-C、D07-3-B、D07-3-C；忽略此单一问题的敏感性上限为49/72五维通过，不能替代正式44/72。
实际工具使用要求保持冻结：D08-3-A口头几何答案正确但无空间计算调用，method仍为false。
全部72条before/after版本、绑定、发布和current已做精确相等断言；annotation-backed结果及referenceItems逐一比对原始身份、版本及几何；合法派生buffer目标逐坐标比对可信前序结果。没有发现真实未授权写入或权限突破。

## D01-1-A：维度通过
- 实际固定origin/north几何和版本一致；distance=1111.950802m，与解析子午线预期及回答1111.95m一致。完整检查助手全文和前后状态，没有写入。
- 末尾进一步椭球测距属于条件性后续建议，当前已明确球面近似；不据此新增失败条件，但记录现有工具并无椭球测量入口的能力措辞风险。

## D01-1-B：维度通过
- 先错误使用source引用遭CONTEXT_UNSUPPORTED_FILTER，随后同一次原生循环改为正确annotation固定引用；最终distance、范围、单位和限制正确，无写入。
- 记录参数误调用与自恢复；未重开试次，未把被拒绝调用包装成成功。

## D01-1-C：维度通过
- 固定origin/north及revision1，distance=1111.950802m；回答1112m/1111.95m、同经线解释与原始坐标相符。前后状态完全一致。

## D01-2-A：维度通过
- 正确分辨annotation引用而非source，真实固定2点球面测距1111.950802m；回答单位、scope、快照时间和限制正确，无写入。

## D01-2-B：存在语义问题
- 实际固定origin/north测距1111.950802m与解析预期一致，无写入。
- 但完整回答称只读取并使用了参照对象图层中的这两个点，未涉及该图层其他对象；真实annotation_read query.fields=[geometry]未加选择条件，返回草稿16对象全部几何。计算范围仅2点正确，读取范围却被错误缩称2点，claims=false；未将不完整候选伪称全量，无关键错误。

## D01-2-C：维度通过
- 实际revision1 origin/north measure distance，1111.950802m，全文1112m/1111.95m及正南北解释正确；固定快照和非路网/椭球限制准确。原始对象及前后状态完全一致。

## D01-3-A：维度通过
- measure固定origin/north修订1，1111.9508023355m与独立0.01°子午线球面弧长一致；全部回答数值/坐标/范围以及球面非路程限制核对正确。
- 前后草稿版本、绑定、发布和current一致；return-line确实沿同经度经过两点，额外线路长度建议未冒充路网结果。

## D01-3-B：维度通过
- 首次误以source引用草稿对象得到CONTEXT_UNSUPPORTED_FILTER，后明确自纠为annotation固定修订1；正确measure origin/north，1111.95m与独立球面弧长相符。
- 最终来源、坐标、球面方法和路程/派遣限制准确；未写入或发布。原生自恢复不自动判方法失败。

## D01-3-C：存在语义问题
- 真实measure对origin/north固定修订1，距离1111.9508023355m与独立子午线0.01°球面弧长相符；坐标、单位、方法及只读副作用准确。
- 最终称两点近乎正南北所以误差影响很小，工具只给球面非测绘级限制，没有误差界或用户容差依据；方位本身不能支持此精度承诺。与先前同类精度过度表述按同一标准保留claims失败。

## D02-1-A：维度通过
- 实际输入origin点、line线，固定同一revision1；point_to_line=1111.985122m，独立子午线近似预期误差0.0344m，在2m容差内。回答范围/地理距离与非行车距离限制正确。开头提附近来源但实际结果仅使用草稿，最终说明正确。

## D02-1-B：存在语义问题
- 对象、point_to_line方法、1111.985m结果及固定版本正确；状态未变。
- 完整答复称“此处为短线基测距，实际误差可忽略”，工具只声明球面近似、非测绘级，没有给出与椭球/真实位置的误差界，也没有用户容差依据。该精度结论超出证据，claims=false；不是权限或完整性关键错误。

## D02-1-C：维度通过
- 正确固定origin/line，point_to_line实际值1111.985122m，回答约1112m，说明非厘米精度及非路网时间，几何与来源时间相符，无写入。

## D02-2-A：维度通过
- 先列草稿对象再定向读取origin/line几何，point_to_line=1111.985122m，与独立球面近似预期一致。答复正确区分其余对象未核对几何、仅读两项几何及非道路距离，状态不变。后续线上落点建议未宣称当前已算。

## D02-2-B：维度通过
- 首个combined selection参数无效遭SPATIAL_INVALID_INPUT，模型在同试次分开input点/target线后得到1111.985122m；正常自恢复，不重开。最终说明正确区分整线最短距离/端点及路网，范围版本与原始几何一致，无状态变化。

## D02-2-C：维度通过
- 正确固定origin点到line线point_to_line=1111.985122m；全文约1112m及1111.99m、球面非行车限制准确，未扩张候选或精度承诺，无状态变化。

## D02-3-A：维度通过
- 正确point_to_line origin→line，真实数值1111.9851m；最短点约[114,22.51]和0.01°经差约1.028km均可由原始几何及独立球面公式交叉验证。
- 读取全部16对象后仅分析两个，最终明确为分析范围而非读取范围；只读状态前后相同，没有把最短地理距离说成道路能力。

## D02-3-B：维度通过
- 正确固定修订point_to_line，1111.99m/1.112km换算准确；asOf与provenance一致。回答范围、完整度及非路程/非椭球精度限制准确，前后无写入。

## D02-3-C：维度通过
- 正确point_to_line对固定草稿origin与完整line，1111.9851m落在独立0.01°纬差球面期望2m容差内；全部坐标/范围/最短地理距离/非测绘限制与实际证据一致，草稿及发布current未变。

## D03-1-A：维度通过
- 读取return-line实际三顶点往返几何后measure/length=4447.803209m；解析R×0.04°同值，回答去返各2223.9m正确，没有误取端点距离零。前后状态一致。

## D03-1-B：维度通过
- 整条return-line的length=4447.803209m，与独立解析预期一致；单程推断明确标注不是工具另测。全文未扩展候选范围或道路通行能力，无写入。asOf被简称读取时间但固定快照时间值正确，记录为措辞问题。

## D03-1-C：维度通过
- return-line三顶点固定快照、measure/length及4447.80m一致；实际annotation_read列出16对象，回答全列出与仅测一条线的区别准确，未把端点同位置当长度零。无状态变化。

## D03-2-A：维度通过
- 正确读取固定revision1 return-line几何并length求和，4447.803209m/4.45km与独立解析值一致；candidateCount1明确为所选测量范围，没有误述草稿全部只有一个对象，未写入。

## D03-2-B：维度通过
- 固定return-line累计length=4447.803209m，解析两段子午线总长一致；全文区分显示到0.01m与实际精度、折线与端点距离，版本时间正确，无状态变化。

## D03-2-C：维度通过
- 真实return-line三顶点往返几何求length=4447.803209m，回答4447.8m与按两段相加的解释正确，候选仅该对象、无分页/写入，球面非道路里程限制清楚。

## D03-3-A：维度通过
- 正确length测完整return-line往返3顶点得4447.803209m，与独立0.04°球面弧长一致；单程2223.9m明确为推算，数值/范围/限制准确。
- 前言精确计算后最终明确球面非测绘级，没有构成实际精度保证；全部状态只读。

## D03-3-B：维度通过
- 固定草稿return-line实际length为4447.803209m，正确累加去返而非量端点；坐标路径和全部米/千米换算、对象范围及球面非道路限制一致。
- 未额外声称任务结果已发布或保存，前后草稿/绑定/发布/current相同。

## D03-3-C：维度通过
- 实际length对return-line完整往返3顶点测得4447.803209m，与独立2×0.02°纬差球面弧长一致；未误用端点0距离。
- 全部坐标/分段2.22km/总长4.45km及额外巡查线约2.06km可由固定几何核对；最终明确球面非道路里程且只读，前后版本及采用状态一致。

## D04-1-A：维度通过
- 固定region多边形measure/area=4568936.009283m²，与独立球面矩形公式相符；回答公顷换算456.89正确，范围、快照时间/查询时间与工具一致，状态未变。

## D04-1-B：维度通过
- 实际固定revision1 region求面积；4568936m²与4.57km²换算正确，候选仅一个面，说明球面近似和非工程精度，未把矩形包围盒代替任意面。全文及前后状态已核对。

## D04-1-C：维度通过
- region实际范围114–114.02/22.5–22.52与回答一致；area返回4568936.009283m²，单位/换算/固定快照正确，无状态变化。后续建议并未被当作已完成的差集计算。

## D04-2-A：维度通过
- 首次误用operation=area被schema拒绝后同试次改measure/area，实际region面积4568936.009283m²、回答换算与固定版本正确。全文明确其他面未纳入、净面积尚未执行，未将失败包装成功，无写入。

## D04-2-B：维度通过
- 真实固定region面measure/area=4568936.009283m²，与球面矩形解析预期一致；4568936m²/4.57km²换算、一个对象范围、非工程精度说明正确，无写入。

## D04-2-C：存在语义问题
- 用户所问region面积及m²/万m²/km²换算正确，实际measure/area与固定几何一致，无状态变化。
- 但额外声称禁入区是观察区的内含多边形、其顶点落在观察区内部。真实excluded经度113.999–114.001而region西边界114，禁入区一半在观察区外，并非完全内含；简单扣全部禁入面积的建议无依据，claims=false。

## D04-3-A：维度通过
- 正确area(region)固定修订1输出4568936.0093m²，与独立球面矩形面积吻合；456.89万平方米/4.57平方公里换算正确。
- 范围完整单对象、方法与潜在几何编辑影响说明准确；未写入或发布，前后状态一致。

## D04-3-B：维度通过
- 固定草稿region实际area4568936.0093m²，独立球面矩形期望吻合，约4.57km²正确；未把平面球面面积误称地形表面积。
- 范围/完整度/非测绘限制及未发布/采用/修改声明与前后状态一致。

## D04-3-C：存在语义问题
- 正确识别region并读几何后却尝试bash计算，固定驱动取消待审批交互，工具返回Operation aborted；没有实际空间分析结果或最终面积回答。
- 原对象/版本可识别，前后草稿/发布/current等完全相同，无实际写入关键错误。

## D05-1-A：维度通过
- 实际filter含边界contains，候选resources层完整5点，命中r1/r2/r3/edge；edge(114.02,22.52)为region东北角，结论独立成立。
- 额外类别/状态说明与工具实际properties一致，严格内部的边界排除属于几何推论而非伪造另一次工具结果。禁入区附加条件为未执行的后续讨论，全文明确本轮未叠加。草稿/发布/current/binding未变。

## D05-1-B：维度通过
- relate contains的input=region、target=edge，固定同一revision1，实际matches=true；edge为真实东北角，闭区域结论正确。
- 回答明确仅关系判定，不把几何关系当作可用/调度事实；其他区域未判、任务current未查询等边界说明符合真实调用，无状态变化。

## D05-1-C：维度通过
- 固定region/edge先relate再完整resources filter，matches=true且4/5命中；全文正确指出edge东北角与r1左边界、r2/r3内部、outside外部。
- 额外严格内部说明为几何推论，未伪装执行另一种关系算法；工具限制说明克制。前后状态完全一致。

## D05-2-A：存在语义问题
- 实际region contains edge=true、edge intersects region=true，固定版本/几何正确；一次多目标错误已自恢复，未写入。
- 但附带断言禁入区完全落在观察区内部，与同时列出的坐标113.999–114.001矛盾：region西边界114，excluded跨界。此为具体空间关系误述，claims=false；未实际伪造几何或越权。

## D05-2-B：维度通过
- 先多目标/方向错误的relate分别被AMBIGUOUS/UNSUPPORTED拒绝，随后正确filter resources全5点 against region contains，edge被包含且4/5命中；原生自恢复，不重开。
- 最后边界角点、包含语义、固定版本和scope与原始数据一致，无草稿/发布/current变化。记录错误参数尝试，未据此把最终正确任务判失败。

## D05-2-C：维度通过
- 固定region contains edge=true，实际东北角重合；全部额外坐标比较均与原始草稿一致，尤其正确识别r1西边界、excluded跨西边界部分重叠、ties一外一边界。未逐项工具判读的部分明确标为坐标推断，无写入。
- 全文有关于其他工具开环、未来口径约定的泛化建议，记录为冗长/易混淆措辞；未据此改写本次闭区域方法或实际结论，不额外提高冻结验收要求。

## D05-3-A：存在语义问题
- 未读取草稿也未调用空间工具，虽上下文给了固定草稿版本，但未解析已存在且名称明确的region/edge；仅复述通用含边界口径并要求用户补充现成对象。
- 没有完成题面要求的实际对象关系判断，故对象范围、方法、几何结论及回答完成性不通过；其自述未读/未写如实，前后状态无改变，不列伪造或权限critical。

## D05-3-B：维度通过
- 正确固定region contains edge，实际matches=true与原始东北顶点坐标一致。回答明确本次仅二对象及含边界语义，未声称筛完所有资源。
- 工具无strict interior选项的限定准确；没有用intersects冒充严格内部，精度限制和只读副作用说明与证据一致。

## D05-3-C：维度通过
- 首次多目标relate报歧义后原生恢复为完整resources contains筛选，再对edge/outside二点筛选；edge命中outside不命中，固定对象身份几何均正确。
- 最终列出矩形顶点与edge角点、inclusive四点、严格内部会排除edge等事实正确；关于当前草稿稳定性的说明结合其明确非实测精度限制理解，不作现实误差保证。没有虚构已执行写入。

## D06-1-A：维度通过（另有评分器裁定）
- 评分器缺陷：先批量relate触发SPATIAL_AMBIGUOUS，随后同试次对资源层完整5点逐个relate/contains，r1/r2/r3/edge=true，outside=false。最终名单、数量、坐标及分类均正确，属于冻结契约允许的等价执行链。
- score的method_coverage和exact_selected_objects仅寻找filter而误判；保留原score，不覆盖程序结果，不让summary自动将人工通过替代score。须在最终报告单独裁定此等价链评分缺陷。实际全部版本/几何与before一致，无写入。

## D06-1-B：存在语义问题
- 主体正确：resources完整5点filter contains命中4点，固定region与原始几何一致，无写入。
- 末尾建议换用intersects/disjoint“以区分边界接触与内部包含”。对于点与多边形，边界点和内部点均intersects=true、disjoint=false，不能作此区分；这是具体方法能力误述，claims=false，非权限/完整性关键错误。

## D06-1-C：维度通过
- 完整resources层5点与region固定面filter contains，4点命中集合与独立坐标判定一致，outside排除。全文单位、版本、候选范围和非现实实时数据限制正确，无状态变化。

## D06-2-A：存在语义问题
- 读取草稿后尝试bash计算，待审批交互被固定驱动取消并返回Operation aborted；无空间结果、无最终对象名单，未完成问题。
- 前后版本、绑定、发布及current完全相同，未发现实际写入或越权。

## D06-2-B：维度通过
- 先三次把多候选用于单对象relate触发AMBIGUOUS，最终同试次用filter resources全层+region contains，正确4/5名单；正常自恢复，保留错误调用观察。
- 最终回答范围、boat/truck属性、全部ready状态与真实返回一致，未声称原错误relate成功；前后草稿和发布/current完全一致。

## D06-2-C：存在语义问题（另有评分器裁定）
- 完整检查5次逐对象relate：r1/r2/r3/edge contains=true、outside=false；inclusive名单4个正确，固定草稿身份、版本及几何与原始对象吻合。
- 最终附加说严格内部为3个(r1/r2/r3)错误：r1经度114等于region西边界，应只有r2/r3两个；工具主结果无此错误。原评分器拒绝等价relate链另存adjudication。

## D06-3-A：维度通过
- 两次多对象relate歧义后自恢复为filter，完整5候选正确得r1/r2/r3/edge；各点坐标、类别及outside排除均与原始草稿一致。
- 最终明确只分析region关系、未扣excluded、含边界及非采用状态，前后未写入。

## D06-3-B：维度通过
- 实际对完整resources层5点contains(region)得到正确四点；所有对象类别状态、region经纬范围、edge顶点及outside坐标与固定修订吻合。
- 未把excluded当筛选条件，完整度、方法限制及只读状态均准确。

## D06-3-C：存在语义问题
- 连续5次把多候选用于单对象relate后，最终原生恢复为正确filter；完整resources5点筛得r1/r2/r3/edge，固定版本、对象几何和inclusive名单准确，方法按最终成功链评估。
- 最终把outside（资源外）属性写成truck/ready，原始夹具及真实annotation_read为boat/busy，属于对象属性事实错误；未修改实际属性，前后状态一致。

## D07-1-A：存在语义问题
- 生成1500m buffer后因遗漏geometry:true把结果items误作目标点，第一次filter失败，重复buffer后改用distanceM=1500筛选并summarize，最终r1/r2、boat1/truck1及原始草稿版本正确。距离筛选为允许等价方法，未修改状态。
- 但全文称缓冲结果未携带可复用几何，真实buffer.geometry存在且契约支持geometry:true；错误归因于工具能力。另声称edge约2.4km，独立球面核算约3027.64m，且远离1500m边界，不应按名称暗示阈值边缘不确定。claims=false，无越权或完整性关键错误。
- 补充复核：完整缓冲被转述为32段圆弧，但真实输出环129点=128条边；普通claims=false，非critical。工具32steps未注明每象限属shared_contract_ambiguity，责任不能全归模型。旧审阅保存在manual-review.previous.json。

## D07-1-B：存在语义问题（另有评分器裁定）
- 先source误引用遭拒后正常原生自恢复；实际buffer1500→filter引用同一resultRef+geometry:true→summarize引用filter，完整5候选得r1/r2及boat1/truck1。全文范围、单位、快照和边缘近似说明正确，无写入。
- score的fixed_identity_version_and_geometry为评测器缺陷：filter.referenceItems是合法派生buffer几何，其id和scope均为前序resultRef，逐坐标等于buffer.geometry。已独立核实并另写adjudication.json，保留原score，不能记作模型关键错误。
- 补充复核：完整缓冲被转述为32段圆弧，但真实输出环129点=128条边；普通claims=false，非critical。工具32steps未注明每象限属shared_contract_ambiguity，责任不能全归模型。旧审阅保存在manual-review.previous.json。

## D07-1-C：存在语义问题（另有评分器裁定）
- 实际buffer→filter→summarize链完整，结果集合/类别/版本正确；合法buffer引用逐坐标一致，原score误判见adjudication.json。
- 全文额外称“靠近边界的点（如边界点）”可能受1500m阈值近似影响。edge=(114.02,22.52)，origin=(114,22.5)，独立球面距离约3027.64m，远离1500m边界；这是按名称误推空间位置，claims=false。无状态变化。
- 补充复核：完整缓冲被转述为32段圆弧，但真实输出环129点=128条边；普通claims=false，非critical。工具32steps未注明每象限属shared_contract_ambiguity，责任不能全归模型。旧审阅保存在manual-review.previous.json。

## D07-2-A：存在语义问题（另有评分器裁定）
- 首次filter漏geometry:true后原生恢复为同一buffer引用加geometry:true；正确得到r1/r2、boat1/truck1，完整5个候选和原始版本/身份均核验。
- 最终范围/单位/近似说明正确，未误称业务vehiclepool；filter派生几何与先前buffer完全一致，原评分器误报另存adjudication。
- 补充复核：完整缓冲被转述为32段圆弧，但真实输出环129点=128条边；普通claims=false，非critical。工具32steps未注明每象限属shared_contract_ambiguity，责任不能全归模型。旧审阅保存在manual-review.previous.json。

## D07-2-B：存在语义问题（另有评分器裁定）
- 首个buffer参数publicationId:null不合法，后原生自恢复；正确1500m缓冲、geometry:true筛选完整5个resources、对r1/r2分组boat1/truck1。
- 附加断言r3距origin约1.7km错误：原始坐标114.015/22.515与114/22.5，独立Haversine按半径6371008.8得2270.745883m，即约2.27km。
- filter目标派生几何逐坐标与前序buffer匹配，非伪造；评分器误报另存adjudication。
- 补充复核：完整缓冲被转述为32段圆弧，但真实输出环129点=128条边；普通claims=false，非critical。工具32steps未注明每象限属shared_contract_ambiguity，责任不能全归模型。旧审阅保存在manual-review.previous.json。

## D07-2-C：存在语义问题（另有评分器裁定）
- 完整原生buffer1500→filter(geometry:true)→summarize链，固定草稿版本与全部5候选核验，r1/r2入选、boat1/truck1；回答坐标、范围和近似限制准确。
- 派生target resultRef及几何与前序buffer逐坐标一致；原评分器误报另存adjudication。
- 补充复核：完整缓冲被转述为32段圆弧，但真实输出环129点=128条边；普通claims=false，非critical。工具32steps未注明每象限属shared_contract_ambiguity，责任不能全归模型。旧审阅保存在manual-review.previous.json。

## D07-3-A：存在语义问题
- 实际buffer1500后通过距离≤1500筛5→2，再真实resultRef按category得boat1/truck1；该夹具远离缓冲边缘，替代距离链得到正确集合，未写入。
- 完整回答中错误断言filter target不支持result（实际仅漏geometry:true）；末尾又称2500米范围boat1/truck1，真实参数全为1500，且2500会额外包含r3。两项均为实质claims错误。
- 32 steps转述32段的实现术语问题单独记录，不作为新增门槛。
- 补充复核：完整缓冲被转述为32段圆弧，但真实输出环129点=128条边；普通claims=false，非critical。工具32steps未注明每象限属shared_contract_ambiguity，责任不能全归模型。旧审阅保存在manual-review.previous.json。

## D07-3-B：存在语义问题（另有评分器裁定）
- 真实buffer1500→geometry:true filter→summarize链对全部5候选得r1/r2及boat1/truck1，原始身份及派生几何都正确。
- 将32 steps转述完整缓冲32段圆弧，实际输出环129点=128条边，claims=false，非关键错误。shared_contract_ambiguity：工具仅写32steps未说明每象限，接口措辞共同促成误述。
- 对edge临界性明确写按对象名推测可能，记录无价值推测风险；未把该猜测当确定事实判错。原评分器拒合法派生几何另存adjudication。

## D07-3-C：存在语义问题（另有评分器裁定）
- 固定草稿正确buffer1500→geometry:true filter→summarize，全部5候选得到r1/r2、boat1/truck1；asOf按秒展示与真实时间一致，无写入。
- 将32 steps转述完整缓冲32段圆弧，实际输出环129点=128条边，claims=false，非关键错误。shared_contract_ambiguity：工具仅写32steps未说明每象限，接口措辞共同促成误述。
- filter.referenceItems几何和id精确匹配前序buffer；评分器误报独立adjudication，不覆盖其他claims问题。

## D08-1-A：存在语义问题
- 模型读取了真实草稿几何与属性，但未完成spatial filter；转而尝试bash执行Python，触发待确认交互后按预定规则取消。没有结果名单或完整任务答复，目标未完成。
- 原始SSE/interaction.json记录实际停止，不能替用户确认执行；前后草稿、发布、current、binding均不变，无确认后的写入或越权事实。

## D08-1-B：维度通过
- 实际filter同时使用resources全层、region contains与status eq ready；固定5候选得r1/r2/r3/edge，原始属性/坐标证实outside busy且区外。全文候选与命中数量分开、时间版本准确，边界解释与闭区域一致，无写入。

## D08-1-C：存在语义问题
- 用户要求的含边界+ready筛选实际参数和4点名单正确，固定版本/几何/状态一致。
- 但完整回答额外断言严格内部排除edge后命中数为3；r1=(114,22.505)也位于region西边界114，严格内部应仅r2/r3共2点。该额外数量推断错误，claims=false，非权限/不完整候选关键错误。

## D08-2-A：存在语义问题
- 实际完整5候选按contains+status=ready得正确4点，固定草稿版本/来源及未写入限制正确。
- 最终将r1列为区内部并断言严格内点r1/r2/r3三个错误：r1经度114为region西边界，严格内部仅r2/r3两个。对excluded仅说重叠及本次不扣减未造成额外实质错误。

## D08-2-B：存在语义问题
- 实际filter对resources全部5点同时应用contains(region)+status=ready，正确入选r1/r2/r3/edge，版本和几何与原始对象一致，状态未写入。
- 最终附加严格内部剩3个的断言错误：除edge角点，r1经度114也在region西边界；严格内部仅r2/r3两个。

## D08-2-C：存在语义问题
- 实际先空间筛5→4，再沿真实resultRef按status=ready筛4→4，正确入选r1/r2/r3/edge，所有原始身份及几何吻合。
- 最终附加严格内部是r1/r2/r3三个错误，r1位于西边界；严格内部仅r2/r3两个。

## D08-3-A：存在语义问题
- 读原始几何后口头比较坐标，正确列出r1西边界、edge东北角、r2/r3严格内部以及outside在外且busy，inclusive4/strict2、状态及excluded仅重叠均准确。
- 没有任何spatial_analyze结果，未满足冻结方案实际工具方法要求，故method=false并保留原score失败；不能因口头答案正确豁免计算链。其他语义维度可由原始坐标独立确认，前后无写入。

## D08-3-B：存在语义问题
- 完整5候选实际contains(region)+status=ready正确返回r1/r2/r3/edge，属性、来源、版本、快照及只读状态吻合。
- 最终附加排除边界后3个错误：r1同样在西边界，应只有r2/r3两个；区内措辞本身可包含边界，不据此判错，明确严格计数错误是失败依据。

## D08-3-C：存在语义问题
- 实际contains(region)+status=ready在完整5候选得正确r1/r2/r3/edge；状态、类别和outside双重不满足正确，未写入。
- 表中明确把r1列为观察区内部，并与edge边界对照；r1经度114等于region西边界，实际为边界点，属于实质位置事实错误。

