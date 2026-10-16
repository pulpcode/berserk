# D09—D16 独立证据审阅（72 条完成）

审阅者：agent:spatial_backend（AI 证据审阅，不冒称人类审阅）。冻结代码/Skill未修改；原 score 保留。逐条读取问题、全部原答复、原生工具参数及结果、原始/最终草稿和版本；不以程序分数代替语义判断。

已审阅：72/72。

| Entry | 语义失败维度 | 关键错误 |
|---|---|---|
| D09-1-A | claims | 0 |
| D09-1-B | 无 | 0 |
| D09-1-C | 无 | 0 |
| D09-2-A | 无 | 0 |
| D09-2-B | 无 | 0 |
| D09-2-C | claims | 0 |
| D09-3-A | claims | 0 |
| D09-3-B | 无 | 0 |
| D09-3-C | 无 | 0 |
| D10-1-A | method, claims | 0 |
| D10-1-B | 无 | 0 |
| D10-1-C | 无 | 0 |
| D10-2-A | objectScope, method | 0 |
| D10-2-B | objectScope, method, claims | 1 |
| D10-2-C | 无 | 0 |
| D10-3-A | objectScope, method, claims | 0 |
| D10-3-B | 无 | 0 |
| D10-3-C | 无 | 0 |
| D11-1-A | claims | 0 |
| D11-1-B | objectScope, method, numericGeometry, claims | 0 |
| D11-1-C | claims | 0 |
| D11-2-A | objectScope, method, numericGeometry, claims | 1 |
| D11-2-B | claims | 0 |
| D11-2-C | claims | 0 |
| D11-3-A | method, numericGeometry, claims | 0 |
| D11-3-B | claims | 0 |
| D11-3-C | objectScope, method, numericGeometry, claims | 0 |
| D12-1-A | claims | 0 |
| D12-1-B | claims | 0 |
| D12-1-C | method, claims, effects | 0 |
| D12-2-A | claims | 0 |
| D12-2-B | claims | 0 |
| D12-2-C | claims | 0 |
| D12-3-A | claims | 0 |
| D12-3-B | claims | 0 |
| D12-3-C | claims | 0 |
| D13-1-A | 无 | 0 |
| D13-1-B | 无 | 0 |
| D13-1-C | 无 | 0 |
| D13-2-A | 无 | 0 |
| D13-2-B | 无 | 0 |
| D13-2-C | claims | 0 |
| D13-3-A | method, numericGeometry, claims | 0 |
| D13-3-B | 无 | 0 |
| D13-3-C | 无 | 0 |
| D14-1-A | 无 | 0 |
| D14-1-B | claims | 0 |
| D14-1-C | 无 | 0 |
| D14-2-A | claims | 0 |
| D14-2-B | claims | 0 |
| D14-2-C | 无 | 0 |
| D14-3-A | 无 | 0 |
| D14-3-B | 无 | 0 |
| D14-3-C | 无 | 0 |
| D15-1-A | claims | 0 |
| D15-1-B | 无 | 0 |
| D15-1-C | claims | 0 |
| D15-2-A | claims | 0 |
| D15-2-B | 无 | 0 |
| D15-2-C | 无 | 0 |
| D15-3-A | claims | 0 |
| D15-3-B | claims | 0 |
| D15-3-C | claims | 0 |
| D16-1-A | 无 | 0 |
| D16-1-B | 无 | 0 |
| D16-1-C | claims | 0 |
| D16-2-A | method, numericGeometry, claims | 0 |
| D16-2-B | method, numericGeometry, claims | 0 |
| D16-2-C | 无 | 0 |
| D16-3-A | 无 | 0 |
| D16-3-B | 无 | 0 |
| D16-3-C | claims | 0 |

## 审阅口径与已确认现象

- 评分勘误另存各entry/adjudication.json，不覆盖score；合法派生buffer几何以及完整逐点关系等价方法可能被原评分误拒。
- 工具描述32 steps未注明每象限，模型多次转述32段；真实点缓冲129坐标/128边。普通claims错误与核心计算正确性分开记录，冻结期不改代码。
- D13同名候选透明分别测量、均给身份和数字，不擅自择一，按统一口径可作为有效消歧；额外调用单独观察。
- 首轮24条已核对全部结果原annotation几何/固定ref与before文档一致，共68次item出现；派生geometry与原resultRef结果几何逐项相等。
- 首轮D14/D15均未把缺几何或来源不可用当零命中；普通错误包括未返回几何扩大成来源不存在、误称基点也必须来自态势来源。
- 首轮D12 A/B保存几何与预览完全相同，去掉唯一新增对象后文档与before完全一致；C重复求确认，授权保存未完成，未冒称保存成功。

## 原始评分、语义审阅与敏感性上限

| 组 | 条数 | 原程序全检查通过 | 五语义维度通过且无关键错 | 原程序与语义同时通过 | 忽略仅32段术语争议的语义上限 | 有关键错误条数 |
|---|---:|---:|---:|---:|---:|---:|
| A | 24 | 14 | 7 | 6 | 10 | 1 |
| B | 24 | 18 | 13 | 12 | 18 | 1 |
| C | 24 | 17 | 12 | 11 | 16 | 0 |
| 合计 | 72 | 49 | 32 | 29 | 44 | 2 |

以上仅D09—D16子集，不能代表216条总体，也不能据此单独得出Skill效果显著性结论。原score没有改动。语义通过包含经证据裁定的等价正确链，原程序+语义同时通过则保留所有原断言。工具调用失败可恢复；缺几何/来源不可用时正确拒绝也是本题要求。ask_user消歧等待不等于未完成错误，已授权固定范围筛选却额外求确认则仍是未完成。

### 共享契约歧义与保留历史

工具仅描述32 steps，没有说明每象限；模型转成整个圆32段时，真实geometry为128边/129坐标。该错误是shared_contract_ambiguity，接口共同促成，不全归责模型。原样32 steps不算错误，明确32段才保留claims:false。补充说明前的旧review保存为manual-review.before-ambiguity-note.json，原评分及布尔判定不变。

仅该争议导致失败的12条：D11-1-C、D11-2-B、D11-3-B、D12-1-A、D12-1-B、D12-2-A、D12-2-B、D12-2-C、D12-3-A、D12-3-B、D12-3-C、D13-2-C。敏感性上限只忽略这些条目的该术语争议，不忽略错范围、未复用、未保存或其它错误。D11-2-B按名称猜edge可能靠边但明确未核实，没有作为确定空间结论，未另记失败。

## 关键错误及边界观察

- D10-2-B：实际nearest(count2)=[r1,north]、count5=[r1,north,tie-a,tie-b,r2]，终答却伪述count2选tie-a、count5顺序north在ties之后；还把ties目标扩成全草稿。实际回执与原答复均保留。
- D11-2-A：所有kind=result引用遗漏geometry:true而拿到原origin Point，最终成功筛选重取annotation origin+distanceM1500，仍声称直接复用固定旧buffer；第一轮对线/面与Point的关系也错称buffer关系。原reuses_fixed_result断言错误通过，另存false_positive，不只报告能提高通过率的误拒。
- D11-3-C同样遗漏geometry:true后改距离阈值，但最终明确承认没有复用固定Polygon，记方法/固定范围失败，无关键伪称复用。D11-3-A识别正确geometry:true却额外求确认，授权筛选未完成。
- D12共9条中8条确实按原resultRef精确保存500m范围，after仅derived新增指定名称对象，删除新增后document逐项等于before；均未发布或采用。D12-1-C仅预览未执行已授权保存，诚实说明未保存，不能把原save检查失败自动算成未授权写入。
- D13-3-A外部unsupported_filter误说无对应对象，随后bash测距被中止、终答空白，没有成功数字或消歧；method/numericGeometry/claims失败。raw protocol_completed:true仅表示宽松协议条件，不能替代完成语义。其余D13均正确先澄清或透明分别列两个真实候选，不擅自择一。
- D14/D15全部18条没有把来源缺几何/不可用当成成功零命中，也未拿草稿资源冒充全部来源；部分普通claims超出读取证据（如未返回位置扩大为来源永不存在、未读文档却断言内容、把草稿基点误当必须外部来源核对）。
- D16-2-A未读几何便开头声称无点，但后文明示撤回并承认无法判断，记矛盾声明及未完成，不当已证实结果。D16-2-B参数失败后明确未完成。其余7条核心无命中均有完整范围计算，个别额外几何/能力说明错误独立记claims。

## 测量勘误（原score保持不变）

共13份adjudication：12项误拒记录、1项漏检记录。

- 合法buffer派生referenceItems因无annotation/source而误拒：D11-1-A/C、D11-2-B/C、D11-3-B、D12-1-A。已逐坐标比对派生项geometry与原result.geometry，scope/resultRef依赖可信。
- 完整候选排序后明确取目标子集，或附加独立范围查询不替换主答案：D09-2-A、D09-3-A、D10-3-B。分别保留完整候选数、排序count、剔除依据与最终选择证据。
- 全资源逐点contains/disjoint等价正确：D16-1-C、D16-2-C、D16-3-C。全部五候选逐个有成功关系回执，最终无命中；原工具名/selected集合断言误拒。额外claims错误不因勘误消失。
- 固定结果复用漏检：D11-2-A，仅在某次参数见oldRef不足以证明最后成功计算依赖旧geometry。需沿成功结果scope/referenceItems回溯，保留false_positive裁定。

未修改冻结产品、Skill、评测夹具或原score；未重试任何模型调用。每条manual-review.json记录实际证据与失败维度，以上为人工式逐段AI审阅，不冒称人类评审。
