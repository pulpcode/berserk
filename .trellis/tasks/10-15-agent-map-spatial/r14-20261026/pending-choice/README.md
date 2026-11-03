# R14：只补五个原会话未发送的内容

2026-10-27用户已批准按[原轮次补齐附录](../unissued-turns-addendum.md)继续原范围。此入口仅处理下列五个原槽位，不新增第145题、不重跑原已发送请求；实施/检查代理不调用真实模型。真实执行须由主会话在第五段11项结束及独立检查通过后发起。

| 固定顺序 | 原记录 | 仅发送的内容 | 配置 |
|---|---|---|---|
| 1. D06-1-A | 第一段 closeout-20261026 | `clarificationReplyForTurn`精确返回的原预设选择 | Flash disabled |
| 2. D10-1-A | 第二段 closeout-second-20261026 | 原fixture.prompts[1]、prompts[2]，依序 | Flash disabled |
| 3. D10-1-B | 第二段 closeout-second-20261026 | 原fixture.prompts[2] | Flash enabled/high |
| 4. D18-1-B | 第三段 closeout-third-20261027 | 原fixture.prompts[1]、prompts[2] | Flash enabled/high |
| 5. D20-2-C | 第三段 closeout-third-20261027 | 原fixture.prompts[1] | Pro enabled/high |

D06回复精确为“选择 layerId=rescue-coast 的“救援资源”图层。”，实际字节直接复用函数；D10原题干从原fixture读取，不改写。D10-A原600米结果、D10-B原600/1200米结果保留，模型收到原生历史及真实resultRef。新入口不重新建立首轮，不注入历史答案或评分。D12-C、D05-C、D09-A不在本入口名单内。

原`completedUserTurns`曾误记，因此以原生user消息、ObservedTurn和原题干的严格前缀核对已发送轮次。原记录不更改。恢复复用R13 restoreTrial，另由本子目录包装器只清理副本credentials.sessions缓存，再用原accounts经现有登录接口刷新planning/overall登录；原目录、账号角色权限、公共helper和Agent历史不变。恢复过程不发送业务消息或模型请求。R13 restoreTrial负责：完整复制原私有数据目录，保留相同sessionId、角色、草稿、原生消息/工具回执字节；实际SessionManager写入路径必须在副本。保留原本机端口，先检查空闲，不能杀其他服务。原路径与软链/别名路径均禁止作新输出。

## 预算必须按顺序结转

当前接续依据[第五段账本附录](../unissued-turns-fifth-ledger-addendum.md)，原五槽、7条消息不变。第四段D04回答完整，不补该题。

第五段 `.local/spatial-r14/closeout-fifth-20261027` 的最终累计ledger → D06-A新ledger → D10-A新ledger → D10-B新ledger → D18-B新ledger → D20-C新ledger。后续入口从前一个固定claim定位实际输出目录，检查其已结束结果和累计账本，不能跳过前置任务或各自复用第五段余额。

第五段必须原剩余11槽都已尝试且批次正常结束，所有usage完整。个别题`incomplete`且`stopScope=task`不是批次中断，不阻止补齐。账本须完整保留第四段609次请求数组前缀；此前159次、573次均已包含其中，不重复添加任何前段用量。沿用最新账本账户保守累计上限和外部使用预留，以及1600请求/36M输入/3M输出/12000AFP总预算，窗口刷新不扩大授权。

每个槽位独立freeze/gate/claim，claim为`.local/spatial-r14/pending-槽位-20261027-claim.json`。旧D06 pending-choice-claim如已消耗，也禁止换新入口重放。后继入口只能在前一补齐结算后prepare，原证据、旧state、结转账本及代码均按hash核对；原轮次补齐附录和第五段账本接续附录也纳入freeze。任何清单外漏轮不自动加入。

## 停止与评分

每条已批准用户原文只发一次，合法参数纠错可由原生工具循环完成，不能自动重试模型请求或追加提示。出现真实必要澄清、未知用量、技术故障、版本/源码漂移或预算耗尽，停止补齐链。若仅本题隔离草稿违规，须通过根runner相同的归属/来源/宿主指令/发布/任务当前状态核验，判该题失败并结束该题，允许下一独立补齐；不继续该题后续用户轮。无法证明隔离或合并其他越界仍停止全链。

API对已明确事项的冗余提问也只结束本题，不代答；D06已发送固定choice后，普通文字再次询问同一预设选择也只结束本题，混合新事实/权限要求仍停止全链；需要新事实或权限的问题仍停全链。300秒没有真实provider/SSE进展停止全链，每30秒检查；10分钟仅警告，计时器最终清理。

正常主任务失败不靠提示纠正。D10-A补发1200米轮后若没有实际第二个结果，不发送依赖该结果的筛选轮。D18-B必须在原第二用户轮生成可验证的1200米基点范围，才发送原保存轮；保存核对将完整原轮次及新轮次交给现有fixedPreviewEvidence/criticalEffect，检查保存几何确为第二个固定结果。D20-C不生成新范围、不写草稿，原“仅在内存中”错误保留在完整评分证据中。补齐结果分别记录taskStop、batchStop、已发送/完成轮次、carried/newUsage/cumulative；盲审材料连接旧轮及新轮时间线，原错误解释保留。补齐不是新的独立样本，自然结束也不代表语义通过。

## 命令

从`experiments/harness-lab`执行，每个槽位按上表顺序单独prepare、独立审核并run：

```sh
node --import tsx ../../.trellis/tasks/10-15-agent-map-spatial/r14-20261026/pending-choice/runner.ts prepare D06-1-A NEW_FREEZE
node --import tsx ../../.trellis/tasks/10-15-agent-map-spatial/r14-20261026/pending-choice/runner.ts run D06-1-A NEW_OUTPUT FREEZE INDEPENDENT_GATE
```

后续依次将槽位换为D10-1-A、D10-1-B、D18-1-B、D20-2-C。gate须为`status:passed`、匹配`sha256(JSON.stringify(冻结对象))`的freezeHash与非空evidence数组。各输出目录必须全新；本入口无自动恢复和额外重试。测试使用显式mock与r14-offline-*独立声明，不接触正式claim或真实模型。私有恢复目录含凭据，禁止输出或提交Git。

## D06唯一零请求认证恢复

依据[认证恢复附录](../unissued-turns-auth-recovery.md)，原D06补齐在本地GET原会话时401，attempts为空、无turn-input、累计仍650请求。旧输出与旧claim全部保留，不能删除旧claim重放。

只对这一精确失败提供显式`prepare-recovery` / `run-recovery`。新声明固定为`.local/spatial-r14/pending-D06-1-A-auth-recovery-20261027-claim.json`，输出及freeze/gate必须新建。入口逐项核对原401原因、零尝试/零消息、原650完整账本、原生历史与原证据hash。出现任何尝试、用户轮文件、历史变化或用量变化都拒绝。恢复声明也只允许消费一次，失败后无自动重试。

```sh
node --import tsx ../../.trellis/tasks/10-15-agent-map-spatial/r14-20261026/pending-choice/runner.ts prepare-recovery D06-1-A NEW_FREEZE
node --import tsx ../../.trellis/tasks/10-15-agent-map-spatial/r14-20261026/pending-choice/runner.ts run-recovery D06-1-A NEW_OUTPUT FREEZE INDEPENDENT_GATE
```

D10-A随后从这个固定恢复claim读取D06最新结算账本；如果恢复失败或尚未结算，不能继续。其他四槽仍用普通prepare/run，均在隔离副本正常登录，不新增Agent话语。旧失败记录与新恢复证据都纳入freeze检查，新补齐只计原槽位一次。
