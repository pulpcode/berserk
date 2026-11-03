# 第五段实施与离线检查

新增closeout-fifth.ts、closeout-fifth.test.ts、fifth-closeout-protocol.md、closeout-fourth-segment-manifest.json；未修改旧入口、live、产品、Skill或原始记录。cases.ts条件邀请修复由另一实施者负责，本入口明确只允许这一项旧driver差异。

## 已验证

- 5/5离线测试通过，耗时49.4秒，日志`/tmp/r14-fifth-runner-test.log`。
- 原计划144槽位只剩11个未启动，从D04-2-B开始，原D04-2-A不重跑。
- 第四段1127个原文件、39个归档driver及此前8399个原文件均逐hash保持不变。
- 原完整609请求、11713531输入、200888输出、3151.82035AFP只继承一次；原halt仅保存在继承来源，新账本不会重复扣前缀，也不重置累计窗口额度。
- 原生HTTP/Pi离线mock仅执行D04-2-B/C，各一次真实本地annotation_read后返回模拟模型最终回答。请求编号610—613，累计613请求、11713931输入、200928输出、3151.96885AFP；没有付费模型请求。
- 新D04B/C的canonical fixture与原D04A相同；重复使用claim被拒，旧目录不能覆盖。
- 原模型、live/provider、数据、题干、评分及预算变化被拒；允许的cases修复由新的freeze逐字固定。
- 当前缺字段回答已完成，末尾条件后续邀请分类none；原stop和原响应保持不变，none不是评分通过标志。
- 全R14 TypeScript检查、两个新增TS的ESLint及diff空白检查通过。独立checker结果另记，不把本报告当独立批准。

## 命令

工作目录为`experiments/harness-lab`。以下prepare/run由主会话在独立检查后执行，本实施者没有执行真实run。

```sh
node --import tsx --test ../../.trellis/tasks/10-15-agent-map-spatial/r14-20261026/closeout-fifth.test.ts
./node_modules/.bin/tsc --noEmit -p ../../.trellis/tasks/10-15-agent-map-spatial/r14-20261026/tsconfig.json
node --import tsx ../../.trellis/tasks/10-15-agent-map-spatial/r14-20261026/closeout-fifth.ts prepare ../../.trellis/tasks/10-15-agent-map-spatial/r14-20261026/fifth-closeout-freeze.json
```

新gate路径为`fifth-closeout-offline-gate.json`，必须status=passed、freezeHash与新冻结摘要一致，并记录离线及独立审核证据。准备freeze不会生成gate或豁免审核。

```sh
node --import tsx --env-file=.env.local ../../.trellis/tasks/10-15-agent-map-spatial/r14-20261026/closeout-fifth.ts run /Users/lau/.codex/worktrees/agent-result-grounding/berserk/.local/spatial-r14/closeout-fifth-20261027 ../../.trellis/tasks/10-15-agent-map-spatial/r14-20261026/fifth-closeout-freeze.json ../../.trellis/tasks/10-15-agent-map-spatial/r14-20261026/third-closeout-account-preflight.json 4687
```

导出接口：`verifyFourthSegment()`返回已验证旧队列、11个remaining、canonicalHashes及ledgerSeed；`fifthFreeze()`冻结本段；`runFifthCloseout(options)`执行；`fifthDirectory`为建议固定输出。pending-choice必须在本段停止或完成后串行继承第五段最新ledger，不能从旧609前缀并行运行。

剩余限制：账户沿用原观测，执行时仍检查5小时有效性；真实模型质量只能由正式回答评分，不由离线mock结果代替。原停止策略和总预算继续生效，不保证后续没有真实阻塞，不自动重试。
