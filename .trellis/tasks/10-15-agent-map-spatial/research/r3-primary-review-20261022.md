# Research: R3 独立语义审阅 A

- Query: 独立审阅首轮 R3 的144个预定槽位，区分主任务、交互边界、完整解释和实际修改效果。
- Scope: internal
- Date: 2026-10-22

## Findings

当前状态：全部144槽位独立审阅完成并锁定，含120开发槽位、24保留槽位；锁定前未阅读另一位审阅者结论。144条review.json哈希、4046个索引原始证据文件哈希全部匹配。全部614次真实provider输入逐项核对，Skill目录、完整正文送达状态及正文SHA与loading证据一致。实际native组72槽位中68项未收到两项Skill正文，4项收到spatial-analysis正文；显式组72项分别有45项收到map-annotations、27项收到spatial-analysis。加载送达不等于语义通过。

### 审阅约定

- JSON输出为 `Review[]`，符合 `r3-20261022/scoring.ts` 的 Review 类型；审阅者固定为 `r3-primary-independent-A`。
- `transcriptHash` 使用对应槽位 `review.json` 文件原始字节的 SHA256，而不是仅末条回复；锁定前再次核对。证据路径以仓库根为起点，消息、轮次、结果位置附在路径后。
- 按实际全部可见 messages 的时间顺序审阅，核对真实 tool args/results、fixture独立真值、前后版本、其他会话、发布/采用与原始预览geometry。`review.json`为索引，信息不足时读取原始provider或原生记录。
- 技术流程完成不等于主任务/严格通过。先对 core / claims / effects / boundary 分别判定，再按冻结评分函数汇总。
- D04合理问询且无用户选择，主任务和严格为pending；D12–D14边界完成不计计算成功。非必要提问保留并严格不通过。模型探索其他合法对象或成功纠正参数错误不自动标为主要目标错误。
- 按冻结的展示精度/半个末位规则核对距离；不事后加百分比宽容。整数尾零精度真正歧义时pending，不擅自选有利口径。
- D15/D16/H04逐坐标核对保存几何与首次真实预览；D16主动重读避开冲突可完成业务要求，另记冲突路径是否实际覆盖，不能要求为了覆盖故意提交过期版本。
- 实际加载只说明正文送达，不计入语义通过门槛。检查真实provider输入的首次送达与关键决定顺序，不能拿事后读Skill证明先前已收到。
- 未执行/中断槽位不能删除。六个正文组×加载条件分别统计，各自再分20开发题和4保留题；不混为产品总体正确率。
- 先锁定本人全部结论，再读取或讨论其他审阅者评分；未知项保留pending，不根据对方结论调整原始审阅文件。

### Files found / code patterns

- `r3-20261022/review-rubric.md`：事实真值、完整解释、数值舍入、实际修改与独立审阅规则。
- `r3-20261022/scoring.ts:5`：Review绑定entryId、caseId、reviewer、lockedAt及transcriptHash。
- `r3-20261022/scoring.ts:13`：score按核心/边界、陈述、效果、不必要提问计算严格结论。
- `r3-live-execution-20261022.md`：已获授权执行方式、题间预算、不得自动补测/追加。
- `r3-20261022/live.ts:167`：每槽review.json包含entry、truth、fixture、final、after、actualResources、交互/事件和冲突记录。

### Related specs

- `.trellis/spec/backend/agent-scenario-validation.md`：语义独立审阅、保留原始全过程及失败。
- `.trellis/spec/backend/spatial-analysis.md`：独立真值、固定结果精确保存、加载/工具成功不代表模型正确。

### External references

无外部检索，仅使用冻结源码、事实夹具和本轮实际原始证据。没有付费模型调用。

## Caveats / Not Found

- Agent审阅而非人类标定；审阅可看到组别，不能宣称双盲。
- 自动脚本只用于哈希/结构/几何核对与聚合，不以正则判断自然语言对错。
- 全部144项已审。下表仅A独立判断，不代表双审最终裁决；分歧应另外形成adjudication，不能回写本锁定原稿。

### 自然语言澄清与交互链路覆盖分别解释

D11–D14正文确实询问用户，也计asked=true。没有ask_user就没有真实脚本answer/skip/cancel/pending证据；不能拿正文询问冒充实际交互。D12–D14未覆盖该链路时boundary fail，但core记录实际是否遵守不冒选、不计算；不能把该严格失败描述成误选对象。D14正文待答也需显式boundary fail，因评分函数仅检查asked与unanswered，不能单凭这两个字段证明pendingVerified。原始测试及评分函数不变。

### 锁定与完整核对

- JSON SHA256：`cd2d276e5edb03fd7947e96f58ef2f9b42066966cbc9bc4717e4b5517bffff85`。
- D08六项两会话状态均无改动；D15/D16/H04共18项保存几何逐坐标与首次真实预览完全一致，首轮均未写入；D16六项实际CAS冲突后恢复，外部origin备注完整保留；H04六项仅origin坐标移动到backup及derived新建原位置范围。publication/current均保持。
- D08-explicit-spatial-only仅输出“我来对这”，原始SSE finish_reason=stop且[DONE]，2输出token，宿主succeeded；属自然停止但任务未完成，不能当预算截断自动补测。
- 需要留给双审讨论的口径包括：正文中的额外实际问题与条件性后续服务建议如何区分；完整所需答案之外列出更大范围且明确限定时是否已完成；含歧义的定性描述按冻结规则记pending。全部原始判断保留。

### A独立结论按条件与数据集分开

计数按冻结scoring函数的布尔规则聚合本人手工判定，未用正则或程序产生语义结论。开发每条件20项，其中计算/查询/保存17项、边界3项；保留每条件4项均为主任务。

| 条件/数据集 | 严格通过 | 严格失败 | 待定 | 主任务完成 | 边界完成 | 不必要提问 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline/explicit/development | 11 | 9 | 0 | 9 | 3 | 4 |
| baseline/explicit/holdout | 3 | 1 | 0 | 4 | 0 | 0 |
| baseline/native/development | 12 | 8 | 0 | 11 | 3 | 3 |
| baseline/native/holdout | 3 | 0 | 1 | 4 | 0 | 0 |
| map-only/explicit/development | 11 | 9 | 0 | 12 | 2 | 4 |
| map-only/explicit/holdout | 1 | 3 | 0 | 4 | 0 | 1 |
| map-only/native/development | 9 | 11 | 0 | 10 | 3 | 4 |
| map-only/native/holdout | 3 | 1 | 0 | 3 | 0 | 0 |
| spatial-only/explicit/development | 10 | 9 | 1 | 11 | 1 | 3 |
| spatial-only/explicit/holdout | 2 | 2 | 0 | 3 | 0 | 0 |
| spatial-only/native/development | 11 | 9 | 0 | 13 | 2 | 4 |
| spatial-only/native/holdout | 4 | 0 | 0 | 4 | 0 | 0 |
| total | 80 | 62 | 2 | 88 | 14 | 23 |
