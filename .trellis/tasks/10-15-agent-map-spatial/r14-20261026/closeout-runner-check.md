# R14 剩余136项续跑：运行器离线检查

2026-10-26。用户已明确授权误停修复与剩余任务。这里仅记录实现及离线检查，**没有调用真实模型，也没有创建正式续跑claim**。

## 范围与保护

- `closeout.ts` 只接受原 `.local/spatial-r14/batch-20261026/runs.json` 中的136个 `not_executed`，顺序与原144槽位一致。首项是 `D03-1-B`，原D03的A/C和另外6项不会重跑。
- 每次新模型请求前，逐hash核对原1076个文件；原目录不能作为输出或输出父目录。旧claim、ledger和原误停不修改。
- 同题首次三组只剩B时，将新B的归一化初态与原A/C保存的canonical hash比较。其他任务仍先准备三份独立初态并比较。
- 新旧freeze比较只允许本轮澄清/续跑驱动的声明变更；模型、Skill、产品、题干、数据、评分、预算及历史helper必须保持原值。新增续跑代码和协议进入新freeze。
- 独立门禁为 `closeout-offline-gate.json`，要求通过状态及新freezeHash一致；原 `offline-gate.json` 保留。正式一次性claim为 `.local/spatial-r14/closeout-remaining-claim.json`，更换输出路径不能再次执行。

## 预算怎样继承

新账本复制原34条已完成请求，保留原id、用量、组别和原停止原因；新的实际请求从35编号。旧请求不能再次finish或扣费。未知用量、未完成旧请求或原证据不一致均拒绝继承。

原已用：34请求、626034输入、12625输出、172.56015AFP。原总预算不变，因此剩余上限为1566请求、35373966输入、2987375输出、11827.43985AFP；套餐窗口仍独立约束。

新账户观察时间必须晚于原8项结束，启动时位于最近5小时内。每个窗口累计cap取：

`min(原preflight的剩余额度, 新观察实际剩余额度 + 原已用AFP)`

后续余额再减全部累计用量和至少1000AFP共享余量。这既不会把旧消耗扣两次，也不会因新目录或窗口重置恢复额度。按本次观察，初始5小时可用余量为约8827.43985AFP（已扣原消耗及1000预留）。新观测与合成累计cap都保存在新protocol/ledger中，不改变超额付费设置。

## 离线结果

[closeout-runner-offline.log](closeout-runner-offline.log)：**6/6通过**，终端会话53312，28.42秒。验证：

1. 原1076份证据、136项选择、已启动项排除、原目录写入拒绝。
2. 数据、模型、评分或日程变化拒绝，新旧freeze差异受限。
3. 继承旧34请求且第35开始，不重复扣费、不抹去原停止原因。
4. 新观察降低累计cap、旧观察/超时观察拒绝，不恢复额度。
5. 新freeze准确记录授权、原用量、剩余清单和一次性claim。
6. 真实本地HTTP/Pi离线模拟恰执行D03-B、D04-A/B/C四项；D03初态与原三组hash相等。模型传输为本地mock，原证据和旧claim不变，第二次使用同一续跑claim被拒绝。

模拟日志中累计请求35—38、累计AFP增加只用于验证账本算术，**不是新增真实计费**。真实provider调用仍为0。独立检查代理另跑既有预算和停止边界回归。

本责任文件 `live.ts`、`budget.ts`、`closeout.ts`、`closeout.test.ts` 的ESLint及整个R14 TypeScript已通过。静态检查命令与原R14相同，使用项目 `experiments/harness-lab/eslint.config.js`；无产品改动。执行前还需独立检查最终通过及主会话生成新freeze和门禁。

## 主会话命令

工作目录：`/Users/lau/.codex/worktrees/agent-result-grounding/berserk/experiments/harness-lab`。

仅生成冻结文件，不调用模型：

```bash
node --import tsx ../../.trellis/tasks/10-15-agent-map-spatial/r14-20261026/closeout.ts prepare /绝对路径/新closeout-freeze.json
```

独立门禁通过后，使用原已配置环境，主会话唯一一次启动：

```bash
node --import tsx --env-file=.env.local ../../.trellis/tasks/10-15-agent-map-spatial/r14-20261026/closeout.ts run /绝对路径/.local/spatial-r14/新续跑目录 /绝对路径/新closeout-freeze.json /绝对路径/r14-20261026/closeout-account-preflight.json 4687
```

离线复现：

```bash
node --import tsx --test ../../.trellis/tasks/10-15-agent-map-spatial/r14-20261026/closeout.test.ts
```

续跑结果目录的 `runs.json/attempts.json` 只有新136项/新调用；`ledger.json/budget.json` 是含旧34调用的累计账本，`closeout-summary.json` 同时列出原、新、累计用量。汇总时不能再把旧账本加到累计账本上。原8项与新136项由主会话按原schedule合并审查，不改原始记录。
