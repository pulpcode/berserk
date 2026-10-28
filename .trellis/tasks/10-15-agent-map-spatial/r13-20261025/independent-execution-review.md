# R13 揭盲后的独立执行核验

> 2026-10-26。先完成并落盘 `blind-semantic-review.json/.md`，收到主会话明确允许后才读取mapping、正式batch和execution-audit。未读取root语义评审作为判据；没有外部模型调用、补测、重试或修改冻结代码。下述验证使用独立只读脚本核对实际文件，未仅引用主会话汇总。

## 结论

真实传输、配置、共同基准、配对初态、账本与证据一致；**存在1项评测驱动误停，正式任务仅9项完整执行，另1项只执行首轮。** 盲审原判不变。

| 指标 | E0：关闭推理 | E1：开启推理 high |
| --- | --- | --- |
| 主任务 | 4/5通过，1待定 | 5/5通过 |
| 严格 | 3/5通过，1解释错误，1待定 | 5/5通过 |
| 实际请求 | 22 | 24 |
| 输入token | 413505 | 484291 |
| 输出token（已含思考） | 4002 | 7828 |
| reasoning_tokens观测 | 0 | 3649 |
| 有思考信号的响应 | 0/22 | 23/24 |
| spatial-analysis正文实际送达任务 | 2/5 | 4/5 |
| map-annotations正文实际送达任务 | 0/5 | 0/5 |

完整可比的是F01/F02/F03/F05四对：E0严格3/4、E1严格4/4；1对改善、3对都通过、0对退步。F04-E0未收到第二轮，不能把该对算作E1改善。没有达到本轮“至少两对严格改善”的进一步验证信号，更不能证明正式90%目标或建议直接切产品默认设置。

总计46次真实请求、897796输入、11830输出、未知用量0；均在96次/250万输入/40万输出预算内。没有自动重试或追加。原生宿主usageSummary独立累计同为46次，输入按input+cacheRead+cacheWrite合并后完全一致；没有真实compaction或子代理模型调用，46份请求均为父会话。两组总成本不可当作完全同工作量比较，因为E0少执行了保存轮。

## 实际请求与证据核验

逐一解析46份原始SSE（仅程序比较私有思考，不将其作为语义依据），确认：

- 每份HTTP200、唯一response id、终止事件和finish_reason有效；tool调用、usage与attempt/ledger逐项一致，无失败请求或已知请求被漏账。
- 实际request model均`deepseek-v4.1-flash`，实际response model均`deepseek-v4-1-flash-261017`。
- 每次E0为thinking disabled且不传effort；每次E1为enabled/high。两组均max_tokens32768、top_p1、不传temperature。
- native与wire输入除批准的生成字段外逐项相同，messages、tools未被改写；tool continuation中的非空reasoning_content与上次真实响应一致，未混入公开content。
- 第36次请求（F04-E1，第二用户轮）为有效tool_calls响应，thinking内容和reasoning_tokens均0；已正常继续执行并完成保存。按批准规则保留该响应，不把零观测当传输失败。
- 输入预留确为实际wire UTF-8字节数+4096；每次响应实际usage与共享ledger一致，reasoning_tokens没有重复加到输出。
- 校验421项原始任务证据hash，以及46份响应SHA和wire payload SHA，均一致。十项固定schedule、独立会话与批次一次性声明范围一致。

## 共同基准、Skill与配对

核对freeze中全部R13驱动/协议/规则/辅助文件、五份历史fixture、实际HTTP/夹具脚本；两组运行时各247个归档文件，合计494项，与准备时hash一致，allowedDiff为空。安装SDK及lock hash一致。两组确实来自6a631a4共同产品归档，没有混入工作树R12候选。

五对canonical业务快照逐项相等，会话ID各自独立。已有显式路径规范化保留业务名称、坐标、属性与当日业务日期，不因身份字段不同误判，也不抹平业务差异。

直接从实际wire messages核对Skill正文，而非只看工具名：十项首请求都只有目录、没有这两份Skill正文；后续正文出现与成功skill_read相符。

- E0：F02/F03收到spatial-analysis；F01/F04/F05未收到。
- E1：F02/F03/F04/F05收到spatial-analysis；F01未收到。
- 两组均未读取map-annotations；E1保存成功仍缺少该方法读取，这是可单列的Skill遵守诊断，不临时改评分规则扣除已正确完成的事实结果。
- 读取率是按需机制的诊断；本轮不因简单来源查询没读Skill判失败，也不将E1较高读取率直接解释为普遍改善。

## F04误停的真实原因

F04-E0实际只有一个用户消息、一个turn-input和一个turn快照，原生lastResult为succeeded，真实buffer500m已返回，草稿仍revision1/16对象，完全没有保存操作。后续预定保存消息根本未发。

完成答复末尾是：

> 若需要，我可以把这个 500 米范围保存为草稿中的新标注（例如放入「派生」图层），或基于该范围继续做范围筛选、邻近排序等分析；若保存或后续分析需要指定名称、图层或候选来源，请告知。

冻结 `cases.ts` 的 `plainClarificationKind` 豁免包含“如需/如果需要”，但不包含“若需要”。随后宽泛的 `请(?:确认|选择|明确|提供|告知|补充)` 匹配“请告知”，于是返回unsupported。`live.ts` 将其记waiting_user_unmapped_plain_question并中止，且completedUserTurns在判断之后才递增，造成日志连已经完成的首轮也记成0。

这是对完成后可选建议的误分类，不是模型缺事实、要求新增授权、额度不足或拒绝执行。保留原始waiting_user/0计数；结果报告应另注明实际首轮完成、第二轮未观测。不能自动补发、将缺失轮算成功，或把缺失轮算模型真实失败。

## F04保存成功项及唯一明确解释错误

F04-E1：第一次buffer固定结果与第二轮annotation_from_analysis.resultRef一致；成功回执beforeRef1→afterRef2，objectIds仅temp-range。独立比较全部before/after内容：派生层恰新增“临时范围”，几何与首次结果完全相等，原16对象和全部图层元数据逐项不变，publications/current不变。没有重算、提前保存、发布或采用。

F02-E0：500m→1500m→首次500m筛选的依赖正确，主任务零命中和只读状态正确。最终“纬度22.5000～22.5045”漏掉南半边；真实buffer纬度约22.495503～22.504497。严格失败来自额外数值说明，不是空间工具或候选选择失败。

## 历史保护及后续边界

独立重新核对4532份历史文件、7份产品文件、整个harness-lab Git diff SHA，均与 `history-before-20261026.json` 一致。没有改旧R11/R12原始失败、评分或冻结R13代码。

应先修复并离线覆盖“完成后的条件性建议”与“真正阻塞澄清”的区别，再由用户决定是否仅补齐未执行的保存轮或做新的受控验证；本轮不自动补测。任何后续修订另建版本，保留这次真实驱动误停，不能通过重写评分/原始日志制造完整10项。

## 可追溯入口

- 正式批次：`.local/spatial-r13/batch-20261026`
- 冻结清单：`.local/spatial-r13/freeze-20261026.json`
- 盲审原判：`blind-semantic-review.json` / `.md`
- 揭盲映射：`.local/spatial-r13/blind-mapping-20261026.json`
- 主会话协议审计：`execution-audit.json`，本次独立核验各总数一致。

盲审原判SHA（揭盲后未改）：
- `blind-semantic-review.json`：`bc31e6edd5469ee118ac22763fe8f275e02f83a6644a7097121178f81d96b871`
- `blind-semantic-review.md`：`2169fe82e532b5ff3b5661f8a682af54fc180844d874181132daed6c58c4448e`
