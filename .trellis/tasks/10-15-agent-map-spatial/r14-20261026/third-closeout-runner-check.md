# R14 第三段110项：运行器实现与离线检查

2026-10-27。依据用户已确认的[本段授权协议](third-closeout-protocol.md)实施。本代理没有调用真实模型、没有启动正式批次、没有创建正式claim，也没有提交Git。

## 实现范围

- `live.ts`新增显式停止范围参数，默认仍保持全批停止。只有新第三段授权入口会启用隔离草稿单题停止；旧批次与旧停止记录不改。
- `closeout-third.ts`固定读取原批次、第一段及第二段证据，只接受原144槽位中的剩余110项，从D12-1-A开始。D12-C等已启动34项不重复。D06-A和D10-A/B原未发送轮次由独立接续程序处理，不混入这110项。
- `cases.ts`仅修标题变更的违规分类：前后草稿元数据标题与文档标题各自一致时，错误改标题属于`original_document_changed`；不一致或身份变化仍不降级。题干、夹具、产品、Skill、评分不变。

## 哪些只结束当前题

仅以下四个确定的草稿内容违规码可以结束当前题、继续下一道独立题：`unauthorized_draft_change`、`wrong_saved_result`、`original_document_changed`、`wrong_rename`。这仍是任务失败，不是通过。

必须同时证明：

1. 来源系统、发布记录、任务当前版本、业务指令均未变。
2. 当前草稿可写，session/task/workspace/ownerSessionId/setId归属与原本题一致。
3. 草稿绑定未变；仅内容对应的revision/hash/updatedAt及一致的标题元数据可变化。
4. 当前原生回合正常完成、没有待答交互、没有已有全局故障或用量问题。
5. 最终文本没有新的未预设必要澄清。

任何条件无法确认，或遇到其他身份/绑定错误，仍停止全批。真实必要澄清保留`waiting_user_unmapped_plain_question`停止原因，原`criticalEffect`也同时保留。

本题取消只设置本题的`active.stop`，不会设置`observer.fatal`或`ledger.halted`。下一题会创建新的active状态。原始违规状态、回合证据和`stopScope: task`保留供评分；不清空或覆盖旧故障。

## 预算与冻结

继承第二段完整159条请求：3032768输入、61051输出、873.5313AFP。新的请求从160编号。原34条及第一段75条已经包含其中，不能再相加。原上限1600请求、3600万输入、300万输出、12000AFP不增加。

合成业务日期仍固定`2026-10-26`，不会随实际执行日变化。刷新账户后仍取“旧累计窗口上限”与“新余额加已用AFP”的较小值，并扣除累计消耗和1000AFP共享预留；不会因账户5小时窗口重置而恢复本轮已花额度。

新入口每次请求前验证全部3764份旧证据及新freeze。新旧配置比较只允许声明的评测器变更，模型、数据、Skill、产品、评分、原预算与顺序保持一致。新一次性claim为 `.local/spatial-r14/closeout-third-remaining-claim.json`，门禁为 `third-closeout-offline-gate.json`，更换输出目录不能重复执行。

## 离线结果

- [third-closeout-final-offline.log](third-closeout-final-offline.log)：**6/6通过，76.59秒**。包含真实本地HTTP/Pi工具调用的三种模拟：只改草稿后下一题继续；同时改草稿与来源仍全批停；草稿违规同时提出必要澄清仍全批停。provider传输均为mock，真实模型请求为0。
- 单题继续模拟中，D12-A实际通过`annotation_from_analysis`写入未请求对象，保留失败并停止其后续轮；D12-B仍能执行两个用户轮。累计请求159→165，只有6次mock新增量，没有重复收费或observer/ledger残留故障。
- [third-closeout-final-guards.log](third-closeout-final-guards.log)：最终标题/权限小修后的**4/4纯检查通过，7.76秒**，覆盖四类内容违规、来源/指令/当前版本/发布/身份/只读状态等反例，核对110清单、3764旧文件和159请求账本。
- 全R14 TypeScript、责任文件ESLint、`git diff --check`通过。独立检查代理另做最终7项及既有provider/停止回归，最终门禁以独立检查报告为准。

## 主会话命令

工作目录为 `experiments/harness-lab`。先生成freeze，独立检查通过后由主会话生成与freeze匹配的门禁，再执行：

```bash
node --import tsx ../../.trellis/tasks/10-15-agent-map-spatial/r14-20261026/closeout-third.ts prepare /绝对路径/third-closeout-freeze.json
node --import tsx --env-file=.env.local ../../.trellis/tasks/10-15-agent-map-spatial/r14-20261026/closeout-third.ts run /绝对路径/新第三段目录 /绝对路径/third-closeout-freeze.json /绝对路径/third-closeout-account-preflight.json 4687
```

输出`runs.json/attempts.json`仅列本段新任务和新请求；`ledger.json/budget.json`是累计账本；`third-closeout-summary.json`分别记录继承、新增与累计用量。后续独立接续程序必须使用本段完成后的最新累计账本，不能与本段并行消费同一初始额度。
