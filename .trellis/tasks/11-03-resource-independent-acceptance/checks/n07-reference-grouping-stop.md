# N07-1：引用分组断言导致冻结批次停止

2026-11-03，执行槽N07-1在真实桌面发送之后、提供方HTTP准入之前停止。未改冻结文件或账本，未重试，后续槽未启动。本页是离线根因记录，不是修复或语义评分。

## 实际与预期

实际POST由两次“引用此对象”操作产生，setId均为`5a18f16b-2285-4944-a384-19b494a8d0ae`、revision均为1：

```json
[
  {"setId":"5a18f16b-2285-4944-a384-19b494a8d0ae","revision":1,"objectIds":["n07-w"]},
  {"setId":"5a18f16b-2285-4944-a384-19b494a8d0ae","revision":1,"objectIds":["n07-e"]}
]
```

冻结预期是同一版本、同一对象集合的一条附件：

```json
[
  {"setId":"5a18f16b-2285-4944-a384-19b494a8d0ae","revision":1,"objectIds":["n07-w","n07-e"]}
]
```

两者固定版本身份一致、所选对象的并集完全一致，没有额外对象、图层或整版本引用；差别是数组分组。实际UI各次对象引用各形成一个附件，是产品正常的显式引用表示。题目要求引用这两个区域，不要求附件合成一条。

## 直接根因

`browser.ts:52`对每个objectId分别点击“引用此对象”；`browser.ts:68`随后将实际annotationRefs与`selection(trial, turn).annotationRefs`做结构deepEqual。N07的cases.ts一个selector含两个objectIds，因此实际分组与预期结构不一致。`run.ts:116`将AssertionError置为`integrity_or_protocol_assertion`，账本停住，result为`batch_halted`。这不是发现产品版本hash漂移，也不是模型回答错误；是执行器未覆盖多对象引用分组的协议错误。

前期桌面离线覆盖P01的图层+单对象、N02的单个导入对象+来源、N03的来源引用，没有覆盖N07同版本多个对象的分组。这是漏掉的分支，不以此前通过的离线检查掩盖。

## 原始证据与计数

批次：`.local/resource-independent-acceptance/20261103-live-01`。

- `N07-1/browser-turn-1/sent-message-bodies.json`：实际1次UI发送，两个附件均是真实固定引用。
- `N07-1/browser-turn-1/failure.json`与`failure.png`：完整断言与页面。
- `N07-1/result.json`：batch_halted、原错误、stateChanged=false。
- `N07-1/execution-audit.json`：实际/预期分组、证据hash、0 provider attempts与状态检查。
- `N07-1/native-history/*.jsonl`：真实composer输入、user消息，随后assistant stopReason=aborted与原生request-result=cancelled。
- `final-snapshot.json`在关闭app之前取样，lastResult=null、active=generating；不能把这个中间快照当作关闭后仍运行。关闭后原生历史已记录取消，CLI进程退出。

原生宿主usageSummary记`modelAttempts=1 / unknownUsageAttempts=1 / actual=null`，对应出网前取消的宿主请求生命周期。提供方账本中N07-1没有任何attempt行，槽内无provider请求/响应文件；冻结Provider在出网前先记ledger.begin，因此真实提供方尝试为0，不是一次未知计费请求。这两套计数均保留，不改写宿主原记录。

全批次仍为**48次实际provider请求，输入1,624,623、输出35,216 token，pending=0、未知提供方用量=0**。真实响应型号`deepseek-v4-1-flash-261017`。完整逐槽状态与账本hash见同目录`formal-execution-stop.json`。

N01-1至N05-1均留有终答；N06-1因同一交互的额外边界确认没有冻结回复、且现桥接只支持单问，保留为未完成，east事实未发送。N07-1为本次协议失败。**尚未启动9槽**：N08-1、N08-2、N07-2、N06-2、N05-2、N04-2、N03-2、N02-2、N01-2。正式分母仍为原定16，不将停下的槽移出或声称整体验收完成。

## 最小修复建议与后续检查（未实施）

仅在新的、另行审阅冻结的执行版本中修正引用核对：比较同一固定版本、同一选择类型下的对象集合是否一致，允许同一对象集合拆为多条附件；保留实际浏览器POST原文，不合并或改写送给产品的消息，不改题目/数据/答案/Skill。不得把整版本、图层选择或不同版本当作等价。

补集合等价正例，并补缺对象、多对象、错误setId/revision、错用publication、图层/对象类型混淆与全版本引用的拒绝检查。再使用冻结产品、真实N07桌面双对象操作和确定性provider离线核对实际POST及原生历史。新版本另行记录hash；当前失败、账本及计划状态不可覆盖，任何实际恢复/重跑必须由主会话与用户按停止规则另行决定。本执行席未实施修复或发起额外请求。
