# R11 64项评分及代理复核对照（2026-10-25）

64项原Agent任务均已完成，64项评分响应也已全部收到：**61项格式与聚合校验有效，3项裁判异常，0项未请求**。本次最后续评只增加53次首次评分，前11条直接复用；没有重跑任务、重发响应或追加样本。

原模型评分和代理证据复核分开保存。代理复核是对已封存轨迹的独立审阅建议，**不是用户人工金标，也不覆盖原模型输出**。以下是8道诊断题×4组×2次重复的结果，不代表未见真实任务的产品正确率。

## 四组原模型评分

S0/S1为旧/新Skill正文；N为原生按需读取，P为评测端同一位置预加载完整正文。工具、任务数据、业务规则及模型相同。表中分母始终包含原计划全部试次；judge_error和pending不算有效通过，也不自动算Agent失败。

|组别|主任务通过/16|严格通过/16|业务主任务/12|业务严格/12|有效判定|judge_error|原判pending|
|---|---:|---:|---:|---:|---:|---:|---:|
|S0-N|14/16|14/16|10/12|10/12|15|1|0|
|S1-N|13/16|12/16|10/12|9/12|14|2|0|
|S0-P|15/16|15/16|11/12|11/12|16|0|0|
|S1-P|14/16|14/16|10/12|10/12|16|0|0|

原模型主任务通过56/64、严格通过55/64；3项裁判异常单列。源文件：[scores.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/scores.json)、[results.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/results.json)。

## 代理证据复核后的建议判定

|组别|主任务通过/16|严格通过/16|业务主任务/12|业务严格/12|无关任务主任务/4|
|---|---:|---:|---:|---:|---:|
|S0-N|14/16|13/16|10/12|9/12|4/4|
|S1-N|14/16|13/16|10/12|9/12|4/4|
|S0-P|14/16|14/16|10/12|10/12|4/4|
|S1-P|14/16|14/16|10/12|10/12|4/4|

代理复核建议主任务56/64（87.5%）、严格54/64（84.4%）；业务题分别40/48（83.3%）与38/48（79.2%）。16条无关题均通过，不能用它们抬高业务能力的结论。整体90%的既有验收门槛未达到；这批仍是诊断集，不能据此宣布正式验收。

新版Skill在这批题上未形成净正确率提升：同为自动加载时，S0与S1主任务和严格通过数相同；同为预加载时也相同。预加载两组各比自动加载组少1条解释错误，但样本仅8题各重复2次，不能据此证明因果或稳定提升。来源不明的Q03即使预加载正文也全部没有完整解决，说明“规则送达”不等于“执行正确”。

复核资料：[Q01/Q02](q01-q02-review-20261025.md)、[Q03](q03-review-20261025.md)、[Q04/Q05/Q06](q04-q06-review-20261025.md)、[Q07/Q08](q07-q08-review-20261025.md)。完整建议及证据哈希：[reviewed-scores-20261025.json](../../../../.local/spatial-r11/audit/reviewed-scores-20261025.json)。

## 原评分与复核的分歧

- 主任务：相对代理复核建议，原裁判误通过3项、误失败1项；另有pending 0项。3项judge_error不归入误通过/误失败。
- 严格质量：相对代理复核建议，原裁判误通过4项、误失败1项；另有pending 0项。3项judge_error不归入误通过/误失败。

|任务|原模型主任务/严格|代理复核主任务/严格|依据与分歧|
|---|---|---|---|
|Q03-1-S0-P|pass/pass|fail/fail|未取得来源选择确认或给出完整的各来源条件答案|
|Q03-1-S0-N|judge_error/judge_error|fail/fail|裁判自身校验错误：verdict contradicts axes。未取得来源选择确认或给出完整的各来源条件答案|
|Q06-1-S1-P|fail/fail|pass/pass|裁判把turn0只读后的rev1/derived空误作turn1保存后的状态；实际turn1 after为rev2/derived=1，exactSave=matching，无criticalEffects。|
|Q07-1-S1-N|judge_error/judge_error|pass/pass|裁判自身校验错误：$.evidence[0].sourceLine: below minimum。依据完整公开轨迹与实际效果核对，未发现需改变主判的确定错误|
|Q02-2-S0-N|pass/pass|pass/fail|正确得到1点4辆，但把关键词查询误述为使用区域ID重查|
|Q03-2-S1-P|pass/pass|fail/fail|未取得来源选择确认或给出完整的各来源条件答案|
|Q03-2-S1-N|pass/fail|fail/fail|未取得来源选择确认或给出完整的各来源条件答案|
|Q04-2-S1-N|pass/pass|pass/fail|第一次500米固定范围筛选为空正确，但额外声称边界点是第二近，与已读坐标矛盾|
|Q06-2-S1-N|judge_error/judge_error|pass/pass|裁判自身校验错误：$.clarity: invalid enum。裁判把turn0只读后的rev1/derived空误作turn1保存后的状态；实际turn1 after为rev2/derived=1，exactSave=matching，无criticalEffects。|

原模型主任务总数恰好也是56/64，不表示逐项一致：其有效判定含3项误通过、1项误失败，另有3项裁判异常；两套结果必须按逐条证据比较。

这些差异反映自动裁判的局限，不能通过改写原判定或忽略异常来提高分数。尤其多轮保存任务要按状态数组的turn边界核对，不能用第一轮的只读状态替代第二轮保存后的状态。

## 剩余任务与解释失败

Q03八条均只完成草稿分支，没有取得来源选择确认，也没有给出另一来源的完整条件答案。草稿4点计算本身正确，失败主要是来源范围未明确、条件覆盖不足；不应统一描述成几何引擎错误。模型首请求能看到“本会话不自动指定草稿”的共同约定，但没有查明其他来源。两条末尾提出可以另查，只是未来提议，不是已完成的第二种答案。

除Q03已包含的解释问题外，另有两条“主任务正确但解释错误”：

- Q02-2-S0-N说“改用该标签后，查到1个资源点”，实际成功查询只用了名称关键词，没有用返回的区域ID重新查询。点数和车辆数正确，方法说明错误。
- Q04-2-S1-N说“其次是边界点”，但边界点实际距离第四，资源乙、资源丙都更近。主要筛选结果正确，附加的距离排序说明不实。具体原句和距离证据见Q04/Q06复核文件。

另外，Q04-2-S1-N的deterministic knownResult=different是评分程序误报：读取旧buffer结果的返回仍标operation=buffer，被错误累计为第三次生成；原生调用只有两次buffer，最后仍用第一次500米结果。该误报不应造成主任务失败，也不豁免同一回答另有的真实排序误述。原证据与程序均保留，没有在本次改代码。

确定性效果检查：Q06八条保存结果均exactSave=matching，64项未发现确认的越权效果；这支持保存/只读执行边界在本批未出错，不能推出所有任务或专业作业场景都安全可靠。

## Skill读取与正文送达

|组别|业务题主动读取空间Skill|业务题完整空间正文送达|业务题完整标绘正文送达|无关题主动读取|无关题正文预加载|
|---|---:|---:|---:|---:|---:|
|S0-N|6/12|6/12|0/12|0/4|0/4|
|S1-N|6/12|6/12|0/12|0/4|0/4|
|S0-P|1/12|12/12|12/12|0/4|4/4|
|S1-P|1/12|12/12|12/12|0/4|4/4|

自动加载组在10条实际进行空间计算的业务试次中，各有6条在首次计算前收到空间正文；预加载组均10/10。全部16条无关题未调用地图/空间工具，也未主动读取地图Skill。预加载组无关题收到正文是实验控制，不是模型主动误触发。预加载入口位于实际首请求system位置，原生读取正文出现在后续tool-result位置；本对照不能把位置/时机差异说成产品自动加载已改进。

## 裁判异常原值保留

### Q03-1-S0-N

原校验错误：`verdict contradicts axes`。

原始核心片段：`{"verdict":"pending","severity":"none","axes":{"completion":"pending","evidence":"pass","processFacts":"pass","finalFacts":"pass","effects":"pass","boundaries":"fail","coverage":"pending"}}`。

原响应：[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v3/011/response.json)；输出归档：[canonical-output.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/reused-011/canonical-output.json)。未修改原字段，未重发请求。

### Q07-1-S1-N

原校验器首先报告：`$.evidence[0].sourceLine: below minimum`。原响应的sourceLine为0，未改成1或null；原核心的evidence/finalFacts还给出na，违反task核心轴不能为na的规则，均原样留存，不因投影而修正。

原始核心片段：`{"verdict":"pass","severity":"none","axes":{"completion":"pass","evidence":"na","processFacts":"pass","finalFacts":"na","effects":"pass","boundaries":"pass","coverage":"pass"}}`。

原响应：[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/028/response.json)；输出归档：[canonical-output.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/028/canonical-output.json)。未修改原字段，未重发请求。

### Q06-2-S1-N

原校验器首先报告：`$.clarity: invalid enum`。原clarity写成完整解释句，而非冻结schema允许的枚举；该句另把预览状态误作保存后的状态。枚举和语义问题都保留，未转成一个有效fail。

原始核心片段：`{"verdict":"fail","severity":"critical","axes":{"completion":"pass","evidence":"fail","processFacts":"pass","finalFacts":"fail","effects":"pass","boundaries":"pass","coverage":"pending"}}`。

原响应：[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/056/response.json)；输出归档：[canonical-output.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/056/canonical-output.json)。未修改原字段，未重发请求。

## 请求与费用记账

|阶段|请求数|输入tokens|输出tokens|
|---|---:|---:|---:|
|24条校准|24|186,042|9,956|
|64项Agent任务|235|4,710,871|36,895|
|64条整题首次评分|64|806,962|32,171|
|总计|323|5,703,875|79,022|

最终逐项核对64条记录的request/response/output哈希全部一致；原270请求和前两个恢复事件与备份逐值一致，第三次恢复仅追加。

从用户本次授权修复格式时的原260请求推进至323请求，合计新增63条首次评分：v2新增2、v3新增8、v5新增53。“53次”仅指最后一段续评；最后续评复用的11条没有再次计费。Judge合计88次，Agent仍235次，总323次；全部用量已知，0重发，0未完成请求。未请求额外连通性测试、复评或第二批任务。以上为provider返回tokens与请求数，不推算套餐货币费用。

## 校准与执行证据

- 原24条校准保持：16开发结论15/16一致，C16为原pass/model pending；8验证结论8/8一致、清晰度7/8一致（C37）。验证集含5条历史真实与3条构造材料，覆盖有限，没有critical金标，不把critical false pass=0解释成关键错误已全面覆盖。
- 28项离线回归、TypeScript、六文件实际ESLint通过；24+11原响应离线复核完成，唯一旧核心冲突保留为judge_error。文件读取、Python基础设施故障与单条校验拒绝分开。
- 原freeze `40e8be085749c8737142d30286a9358d520407cb679bb428e8a6e0f332f6081a`；最终grader freeze `bfa9d8ce0ae18cffa547e739187fad19f627a296ab04783651474a04d3082bf3`。产品、Skill、题目、rubric、校准与模型未变。
- v2保存260请求快照，v3保存262快照，v5保存270快照；三个已执行恢复事件和原始failure文件仍在原位置。v4仅离线准备未执行。原中断历史见[原批次报告](results-20261025.md)，修复边界见[评分格式说明](judge-format-repair-20261025.md)。
- 全部输出：[scores.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/scores.json)、[results.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/results.json)、[progress.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/progress.json)；共享账本：[ledger.json](../../../../.local/spatial-r11/ledger.json)。

## 64项逐条索引

|序号|任务|原模型主任务/严格|代理复核主任务/严格|原响应|
|---:|---|---|---|---|
|001|Q01-1-S0-N|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-20261025/001/response.json)|
|002|Q01-1-S1-N|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v2/002/response.json)|
|003|Q01-1-S0-P|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v2/003/response.json)|
|004|Q01-1-S1-P|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v3/004/response.json)|
|005|Q02-1-S1-N|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v3/005/response.json)|
|006|Q02-1-S0-P|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v3/006/response.json)|
|007|Q02-1-S1-P|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v3/007/response.json)|
|008|Q02-1-S0-N|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v3/008/response.json)|
|009|Q03-1-S0-P|pass/pass|fail/fail|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v3/009/response.json)|
|010|Q03-1-S1-P|fail/fail|fail/fail|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v3/010/response.json)|
|011|Q03-1-S0-N|judge_error/judge_error|fail/fail|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v3/011/response.json)|
|012|Q03-1-S1-N|fail/fail|fail/fail|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/012/response.json)|
|013|Q04-1-S1-P|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/013/response.json)|
|014|Q04-1-S0-N|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/014/response.json)|
|015|Q04-1-S1-N|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/015/response.json)|
|016|Q04-1-S0-P|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/016/response.json)|
|017|Q05-1-S0-N|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/017/response.json)|
|018|Q05-1-S1-N|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/018/response.json)|
|019|Q05-1-S0-P|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/019/response.json)|
|020|Q05-1-S1-P|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/020/response.json)|
|021|Q06-1-S1-N|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/021/response.json)|
|022|Q06-1-S0-P|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/022/response.json)|
|023|Q06-1-S1-P|fail/fail|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/023/response.json)|
|024|Q06-1-S0-N|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/024/response.json)|
|025|Q07-1-S0-P|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/025/response.json)|
|026|Q07-1-S1-P|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/026/response.json)|
|027|Q07-1-S0-N|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/027/response.json)|
|028|Q07-1-S1-N|judge_error/judge_error|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/028/response.json)|
|029|Q08-1-S1-P|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/029/response.json)|
|030|Q08-1-S0-N|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/030/response.json)|
|031|Q08-1-S1-N|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/031/response.json)|
|032|Q08-1-S0-P|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/032/response.json)|
|033|Q01-2-S1-N|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/033/response.json)|
|034|Q01-2-S0-P|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/034/response.json)|
|035|Q01-2-S1-P|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/035/response.json)|
|036|Q01-2-S0-N|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/036/response.json)|
|037|Q02-2-S0-P|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/037/response.json)|
|038|Q02-2-S1-P|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/038/response.json)|
|039|Q02-2-S0-N|pass/pass|pass/fail|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/039/response.json)|
|040|Q02-2-S1-N|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/040/response.json)|
|041|Q03-2-S1-P|pass/pass|fail/fail|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/041/response.json)|
|042|Q03-2-S0-N|fail/fail|fail/fail|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/042/response.json)|
|043|Q03-2-S1-N|pass/fail|fail/fail|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/043/response.json)|
|044|Q03-2-S0-P|fail/fail|fail/fail|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/044/response.json)|
|045|Q04-2-S0-N|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/045/response.json)|
|046|Q04-2-S1-N|pass/pass|pass/fail|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/046/response.json)|
|047|Q04-2-S0-P|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/047/response.json)|
|048|Q04-2-S1-P|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/048/response.json)|
|049|Q05-2-S1-N|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/049/response.json)|
|050|Q05-2-S0-P|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/050/response.json)|
|051|Q05-2-S1-P|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/051/response.json)|
|052|Q05-2-S0-N|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/052/response.json)|
|053|Q06-2-S0-P|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/053/response.json)|
|054|Q06-2-S1-P|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/054/response.json)|
|055|Q06-2-S0-N|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/055/response.json)|
|056|Q06-2-S1-N|judge_error/judge_error|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/056/response.json)|
|057|Q07-2-S1-P|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/057/response.json)|
|058|Q07-2-S0-N|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/058/response.json)|
|059|Q07-2-S1-N|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/059/response.json)|
|060|Q07-2-S0-P|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/060/response.json)|
|061|Q08-2-S0-N|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/061/response.json)|
|062|Q08-2-S1-N|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/062/response.json)|
|063|Q08-2-S0-P|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/063/response.json)|
|064|Q08-2-S1-P|pass/pass|pass/pass|[response.json](../../../../.local/spatial-r11/grading-continuation-20261025-v5/064/response.json)|
