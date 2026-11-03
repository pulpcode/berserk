# R16 续行配额中断：独立只读复核

2026-10-28。复核 `.local/spatial-r16/continuation-20261028` 的现有原始数据，未调用模型、未重试、未改评分或停止标签。

**结论：G0的Q07两轮已完成，建议严格通过；GS在计算成功后遭遇平台5小时用量配额限制，完整任务待定，中断前未发现公开事实错误。**当前原288项中仅3项开始过：旧GST首题、续行G0、续行GS；285项未执行。无法比较四组效果或声称整体正确率。

## 1. 停止原因与用量

GS本题的第三次Provider请求（续行总第7次）返回HTTP429。`Q07-1-GS/provider-0007-error.txt` 明确为：

> AccountQuotaExceeded — You have exceeded the 5-hour usage quota.

返回文本给出的重置时间为 **2026-10-28 19:30:46 +0800**。这是平台报告的5小时配额耗尽，不能据此说API Key无效、月套餐余额归零或已发生现金欠费。09:11 UTC的账户快照不是本次请求时的实时余额，尤其账户存在其他使用；不能把这一中断归因于本批已知14.802125 AFP用尽整份套餐。

| 范围 | 请求数 | 成功且有用量 | 失败用量未知 | 已知AFP |
| --- | ---: | ---: | ---: | ---: |
| 原首题GST | 4 | 4 | 0 | 9.991875 |
| 本次续行 | 7 | 6 | 1 | 14.802125 |
| 合计 | 11 | 10 | 1 | 24.794 |

续行已知输入115,813 token、输出2,604 token。第7请求没有返回usage，不能当作0费用，也不能估造数值补齐。表中AFP为按已核实费率计算的已知估算，非平台整账号最终扣费对账。旧4次记录保持原样。

## 2. G0：两轮完整，建议通过

记录为 `Q07-1-G0`，原题发送2/2、完成2/2、额外澄清0、未发送0。第一轮读取草稿与空间Skill，执行一次buffer700；第二轮零工具，直接使用历史工具证据回答。两轮原生结果均succeeded，无待响应互动，草稿、发布和任务当前状态前后完全相同。

不是因为 `recorded` 或工具成功就判通过；已核对公开过程与全部最终回答，并核对第二轮实际wire输入中的历史工具正文：

| 原句/结论 | 可见依据与状态证据 | 建议 |
| --- | --- | --- |
| “草稿reference层确认有1个点对象origin，现按它生成700米缓冲范围” | 说这句话前已收到无过滤draft读取，唯一层reference，total=1、hasMore=false；“现按它生成”是下一步动作说明 | 过程事实通过，没有提前虚报完成 |
| “该层共1个对象，本次全部参与” | 完整draft读取证明全层1个；buffer只选该层origin，candidateCount=1 | 通过，不是从局部buffer数推断全层 |
| 中心origin、700米、Polygon、complete、固定resultRef | buffer参数和返回正文逐项匹配 | 通过 |
| 生成时间10:00:10.373Z、来源asOf 09:59:55.495Z、queriedAt 10:00:10.372Z | 第二轮wire输入的createdAt/provenance完全匹配 | 通过 |
| Turf7.2.0、AEQD、每象限32段、点缓冲约128边、近似边缘 | 工具method/limitations明确提供 | 通过 |
| “没有保存、发布或设为任务当前” | 实际只读工具链，无写入工具；两轮状态未变 | 通过，描述本次分析结果及自身动作 |
| 第二轮“没有重算或再次读取该结果” | 第二轮工具调用为0，沿用上次结果 | 通过，无需额外工具证明复用 |
| “任务当前采用状态本轮未查询，因此不作判断” | 未调用任务当前查询；前文限制为本次结果未被本次操作采用 | 按全文理解不矛盾：结果自身动作与全局任务当前查询分开 |

两处表达可改进，但依据现有“全文合理理解”的评分口径，不建议机械判错：

- “偏差在段化精度内”没有量化误差界，也没有声称毫米级保证；上下文明确是近似圆弧，工具也明确近似边缘可能与阈值不同。建议只说“近似边缘可能与严格阈值不同”，不把这句话当成已经测量了最大误差。
- 第二轮以“本轮实际做的操作”列出先前读取和buffer，措辞容易让人误以为当前这次又调用了工具。但开头明确“依据上一次buffer，未重新计算”，结尾也明确没有重算或再次读取，整体是在回顾本次任务。建议标题改成“此前实际执行的操作；本次续问未新增调用”。

建议分项：mainRequirement=pass、processFacts=pass、finalFacts=pass、effects=pass、boundaries=pass、strict=pass。此为独立Agent证据复核建议，组别在排障时已知，不冒称盲评或人工金标。

## 3. GS：已观察过程正确，完整结果待定

记录为 `Q07-1-GS`。第一条用户要求已发送，但第一轮最终答复尚未返回；第二条原题未发。记录的completedUserTurns=0、sentOriginalUserTurns=1、unissuedOriginalUserTurns=1，与实际中断位置一致。

已发生的真实动作：读取spatial-analysis和map-annotations正文；读取草稿（limit20，total1，hasMore=false，query为空）；以修订1的reference/origin执行一次buffer700，成功生成固定Polygon。没有保存或其他写入，草稿/发布/任务当前前后相同。

唯一公开过程句：

> 已核实：本会话草稿（修订1）中图层reference（参照对象）内有1个点对象origin（名称“基点”）。下面生成700米缓冲范围用于预览。

该句之前的 `provider-0006-wire-input.json` 已含完整draft读取结果，名称、图层、修订和数量都可核实；“下面生成”是计划说明。没有观察到公开数字错误、虚报保存或把工具失败包装成成功。

第7请求本来要在buffer结果之后继续生成答复，却返回429；没有模型最终回答可供评价。原生请求因运行器按协议取消而显示cancelled，真实触发原因仍是provider_http_429，不能误写为用户主动撤销或模型拒绝任务。

建议分项：mainRequirement=pending、processFacts=pass（仅已观察公开句）、finalFacts=pending、effects=pass（仅实际发生效果）、boundaries=pass（仅已发生行为）、strict=pending。未发出的第二轮不推断为未来成功或失败；“工具已经生成正确范围”不能补成完整任务通过。

## 4. 调度、冻结和原始记录核对

- `combined-runs.json`共有288个唯一ID，与原调度对应。状态为旧waiting_user 1、recorded 1、incomplete 1、not_executed 285；“已开始3项”不是当前仍运行3项。
- 新 `runs.json`共有287项，仅G0/GS开始；GT及后续285项没有开始。没有自动重发429请求，也没有重跑旧GST首题。
- 原首题所在批次1062个文件逐项匹配新冻结保存的原始哈希；旧live-claim字节哈希不变。
- 新G0证据清单43项、新GS证据清单33项均与实际文件哈希一致。
- 新冻结28份driver逐项不变；freezeHash仍为 `9abeb5c4b600e53b2adf6dba22260f39ffedeeb3db8d16b0bed9f466bd273aee`。停止不是源漂移或配额观察硬上限，而是真实Provider错误。
- 尚未完成旧1+新11首关口，不应批准剩余276项。是否在平台重置后继续需要依现有中断流程另行决定；本复核不启动、等待后自动重试或追加。

目前可说两个完整实例（旧GST与本次G0）均建议通过、一个GS实例因平台故障待定。不能把“2个通过”报告成模型总体100%，也不能把待定GS当作Skill效果下降。

## 核对文件哈希

- `combined-runs.json`：`912efa00ba61d1eb1b84aae6dad45898c64a1e3c95c4f58dab619f6020b365b8`
- `runs.json`：`3d7dbcb83dd30974727d4016c3bb1e3740e808be599b6e747447effe1fd6472c`
- `ledger.json`：`42e6d71ea4817592a8fd2061d02a1c91f195c24a425ae173e1e0e1c548d9c44a`
- `Q07-1-G0/review.json`：`3ab887ad1858accc0875a28ced880a1bc1cdf01c6b9936b2683e5337dad652bc`
- `Q07-1-G0/provider-0004-wire-input.json`：`4f2ce1e57673ac1976f3cedf8c8b5e976a1e0ea903baf7c700d49d80613a17d3`
- `Q07-1-GS/review.json`：`df021f8033aa34ac37284e7e4025e3daea7831154ffb17f91f19a1f9d5e7fdc3`
- `Q07-1-GS/provider-0006-wire-input.json`：`8a337bbca8233a9ee8b6eeee18cad091d5e225c97b9f79d2ae81ec2af604e2dc`
- `Q07-1-GS/provider-0007-error.txt`：`bf4c064486b1b7118da13788bf055fdeb271da4068e2e71c3d0084e71cfc31fd`
