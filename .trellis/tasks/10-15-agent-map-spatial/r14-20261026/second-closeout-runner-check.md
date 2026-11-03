# R14 第二段续跑运行器检查

本次仅修隔离评测器，模型调用为0；正式第二段claim未创建。

## 修复

- `cases.ts` 将“是否需要我…、要不要…、需要我…吗”中助手提出的可选后续工作，与当前必要输入、操作授权分开。需有后续动作与结果/额外工作线索，当前要求保存不能被当作可选工作。判断仅控制流程，不给予语义通过。
- D06前文列明两个“救援资源”图层和ID后，允许独立短句“请选择”“请回复序号或图层ID”使用这些上下文。授权请求、未知输入和当前缺口仍优先阻塞。原D06-A不重跑、不改记录，也不加入125项。
- 原D05-C两问API仍不自动回答。完整正文和实际API问题串是不同判断入口；测试分别记录，不能将正文的判别误当真实API分支行为。

## 第二段入口

新增 `closeout-second.ts`，固定输入原批次及第一段续跑，按原顺序只接受剩余125项，从D07-1-B开始。保留原19项；逐hash验证原1076份及第一段1169份证据、旧claims、旧freezes，绑定 `closeout-offer-fix-protocol.md`。不修改live、budget或第一段closeout入口。

继承第一段完整75请求、1355944输入、26692输出、350.66225AFP；旧34请求是其中的前缀，不再相加。新请求从76开始。总预算与1000AFP共享余量不变；账户累计cap仍取此前cap与新观察加已用量的较小值，不重置窗口余额。独立claim为 `.local/spatial-r14/closeout-second-remaining-claim.json`，独立门禁 `second-closeout-offline-gate.json`。

## 离线验证

- `second-closeout-final-offline.log`：15/15通过，21.95秒。包含11项澄清回归和4项续跑验证。
- 原生本地HTTP/Pi模拟只运行D07-B/C；两组初态与第一段D07-A一致，新请求76/77，累计用量仅增加这两次mock数值，旧19项没有重复执行或扣费。重复claim拒绝，原2245份证据不变。
- 对全部19条原回答逐条固定预期分类，D06-A应为allowed，D07-A为none；保留D05异常。类别不代表正确率。
- 独立复核后另补了跨句缺输入优先级和D05-C实际API问题串断言；由检查代理复跑澄清与纯检查及全静态，不重复无关原生集成。
- 本责任文件ESLint、全R14 TypeScript、diff检查已通过；最终补充断言以独立检查报告为准。

## 启动命令

从 `experiments/harness-lab` 执行，先生成新freeze，最终检查通过后主会话生成对应门禁。以下命令由主会话运行，本代理未执行正式续跑。

```bash
node --import tsx ../../.trellis/tasks/10-15-agent-map-spatial/r14-20261026/closeout-second.ts prepare /绝对路径/second-closeout-freeze.json
node --import tsx --env-file=.env.local ../../.trellis/tasks/10-15-agent-map-spatial/r14-20261026/closeout-second.ts run /绝对路径/新第二段目录 /绝对路径/second-closeout-freeze.json /绝对路径/second-closeout-account-preflight.json 4687
```

结果目录 `runs.json/attempts.json` 只包含本段新槽位和新请求；`ledger.json/budget.json` 为累计账本，不能与旧账本相加。`second-closeout-summary.json` 分列承接用量、新增用量和累计用量。
