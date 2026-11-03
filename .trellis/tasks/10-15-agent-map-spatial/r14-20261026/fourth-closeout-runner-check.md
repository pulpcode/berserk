# R14 第四段21项：独立续跑入口检查

2026-10-27。实施范围见[fourth-closeout-protocol.md](fourth-closeout-protocol.md)。本代理仅做离线检查；真实模型调用0，正式第四段claim未创建，未提交Git。

## 停止核实

D08-2-B原题允许数据不足时说明缺什么，fixture.truth.scoring明确准确指出缺口即业务完成。最终回答已列甲222.39米、乙缺几何/无法计算，明确无法完整排序，没有虚构乙位置或将甲称为全局最近。

只读回放定位到唯一触发单元：标题“**缺少的信息**”被旧分类器判为`unsupported/current_task_dependency`。这是拆句后把说明标题当成新必要澄清，正文并没有需要额外回答才能完成本题的新任务。保留原stop、ledger.halted及公开回答，不重跑或自动答复D08；全文语义评分仍另行完成。

## 文件与执行边界

- 新增`closeout-fourth.ts`、`closeout-fourth.test.ts`和本段协议，未改任何既有根TS，包括live、cases、provider、budget、第三段入口。未改产品、Skill、原题、数据、评分或模型参数。
- 原第三段4635份raw及37份冻结driver已逐hash核验、不可覆盖地归档，见`closeout-third-segment-manifest.json`与`.local/spatial-r14/third-driver-before-fourth`。更早3764份也继续验证，合计8399份原证据。
- 仅原runs中的21项not_executed，从D07-2-A开始到D01-2-C。前三段及原批次已经启动的123槽位不进入新队列，D08不重跑。
- 原合成日期2026-10-26、三组初态比较、停止规则与单题隔离草稿违规策略保持原样。底层沿用原110项的政策授权标识，第四段freeze/目录/summary明确只包含余下21项。
- 新一次性claim为`.local/spatial-r14/closeout-fourth-remaining-claim.json`，独立门禁`fourth-closeout-offline-gate.json`；新旧驱动逐项比较，新增freeze不能使旧文件改动合法化。

## 用量

继承完整573请求、11056965输入、189716输出、2982.36455AFP一次；新的请求从574编号。剩余原上限为1027请求、24943035输入、2810284输出、9017.63545AFP。

直接继承第三段ledger.account累计cap及已批准third-closeout-account-preflight.json，不再次计算“新余额加已用量”。原1000AFP共享预留仍保留，按原5小时累计cap计算可用约6017.63545AFP；不因账户窗口重置恢复本轮额度。启动时原观察仍须在5小时内。

## 离线结果

[fourth-closeout-offline.log](fourth-closeout-offline.log)：**5/5通过，54.23秒**。

1. 原8399证据及37driver不变，队列恰为原schedule最后21项，拒绝写入旧目录。
2. 回放原D08完整回答、原题与评分口径，保留旧误停。
3. 573条用量仅继承一次，新请求574起；不能重复finish旧请求，不能替换余额观察或清零窗口。
4. 模型、来源数据、评分及所有既有driver变化均拒绝；新freeze固定21项及原日期。
5. 本地真实HTTP/Pi配mock模型，仅执行D07第二遍A/B/C，每项调用annotation_read后结束。新请求574—579，累计573→579，旧记录及claim不变；同一新claim再次启动被拒绝。模拟用量不是新增真实计费，也不是任务语义正确率。

TypeScript、责任文件ESLint、`git diff --check`通过。独立检查代理另做最终全5项复验，正式门禁以其报告为准。

## 主会话命令

工作目录`experiments/harness-lab`，先生成freeze；独立检查通过后主会话写匹配门禁，再执行：

```bash
node --import tsx ../../.trellis/tasks/10-15-agent-map-spatial/r14-20261026/closeout-fourth.ts prepare /绝对路径/fourth-closeout-freeze.json
node --import tsx --env-file=.env.local ../../.trellis/tasks/10-15-agent-map-spatial/r14-20261026/closeout-fourth.ts run /绝对路径/.local/spatial-r14/closeout-fourth-20261027 /绝对路径/fourth-closeout-freeze.json /绝对路径/third-closeout-account-preflight.json 4687
```

`runs.json/attempts.json`仅包含本段新项和新请求；`ledger.json/budget.json`是累计账本，不能再加前段。`fourth-closeout-summary.json`分列继承、新增和累计用量。pending-choice接续只能在本段结束后使用最新ledger串行运行。
