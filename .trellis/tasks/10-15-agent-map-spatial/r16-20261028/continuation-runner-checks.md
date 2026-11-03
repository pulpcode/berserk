# R16 本次续行：实现与离线检查

本文件只记录用户“修复后继续”授权后的评测器修复。原始批次、登记、冻结、评分、复核和最初离线日志均不覆盖。没有修改产品、Skill、工具、模型配置、题干或业务数据。

## 只继续剩余287项

新增专用入口 `continue-r16-after-q07`，不提供任意恢复功能。预检必须同时满足：

- 旧登记仍指向原冻结 `e37713a4…` 和原288项调度；唯一开始的槽位是 `Q07-1-GST`，其余287项均未执行，且没有其他已开始记录。
- 旧首题两条原题的原生结果均成功、没有待响应交互；四次模型请求用量完整。其主任务及严格通过结论由冻结的独立复核评分提供。
- 原产品、Skill、工具、模型、日期与调度不变。旧批次1062个证据文件、旧claim、授权和复用评分来源的哈希均纳入新冻结并持续核对。

新登记为 `.local/spatial-r16/continuation-after-q07-claim.json`，只写一次。旧 `live-claim.json` 原样保留。新输出只执行287项，原首题不重新调用模型，也不把它的原始waiting_user或1/2账本伪装成已修正。

新目录提供：

| 文件 | 用途 |
| --- | --- |
| runs.json | 新执行的287个原调度槽位 |
| combined-runs.json | 原首题加新287项，保留原始状态与blindId，共288项 |
| combined-evidence-index.json | 每个槽位实际证据目录、来源冻结及是否复用独立复核 |
| combined-usage.json | 原4次请求、新续行请求及合计用量，避免遗漏或重复计数 |
| protocol.json | 新冻结、原批次绑定、授权、账户观察和原评分快照 |

## 首12项关口

先为原Q07的其余三组重新创建独立会话和草稿。三组准备齐全、彼此及旧首题的标准化业务数据完全相同后，才允许第一条模型请求。

关口严格对应原调度首12项：旧1项＋新11项。完成后同一进程等待root核对并写入批准文件，才执行后276项。中断或真实故障后不进入此关口。原关口文件不覆盖，新门禁使用 `continuation-offline-gate.json`。

## 必要离线检查

- `continuation-offline-logs/runner-contract-final.log`：1/1通过。固定原首题及287未执行槽位；拒绝漏组、换序、重新派发旧首题、开始过的其他槽位及不通过的复用评分；核对288项映射和首12项组成。
- `continuation-offline-logs/runner-native-final.log`：1/1通过，93.2秒。15个指定假模型槽位、33次假模型响应。前三个Q07第二轮只利用历史证据、没有新工具调用，附未来保存说明后，原题账本均2/2完成；首12关口核对后才执行后4项。旧首题与claim不变，原始旧目录逐文件哈希不变，二次登记被拒绝。
- 原生检查中其他题故意给出不完整业务回答，仍能按原题顺序继续，说明流程推进没有偷偷依赖正确答案。它们没有被判为模型正确。
- 普通/API未知澄清最终回归2/2通过，41.3秒；两种都保留首次1请求并停批，后3项未执行。日志：`continuation-offline-logs/runner-unmapped-final.log`。最终汇总由独立 `continuation-check.md` 记录。

第一次原生尝试 `runner-native.log` 为等待并行分类修复而主动中断，保留原日志，不计通过。该中断暴露了关口先于停止条件检查的问题，现已修正：fatal或ledger halted时直接停止，不进入首12审批回调。没有重复最初14项整套原生检查。

所有上述调用均为离线假模型。本地标绘HTTP、Pi和工具真实执行，没有外部付费模型请求。

## 正式命令

在 `experiments/harness-lab` 目录，待全部离线及独立复核通过后：

```sh
node --import ./node_modules/tsx/dist/loader.mjs ../../.trellis/tasks/10-15-agent-map-spatial/r16-20261028/live.ts prepare-continuation ABS_FROZEN_CONTINUATION.json
node --import ./node_modules/tsx/dist/loader.mjs ../../.trellis/tasks/10-15-agent-map-spatial/r16-20261028/live.ts continue-r16-after-q07 ABS_NEW_OUTPUT ABS_FROZEN_CONTINUATION.json ABS_ACCOUNT.json 4807
```

`continuation-offline-gate.json` 用新freezeHash，仍需 `status: "passed"` 和非空证据列表。首12批准文件保持 `{freezeHash, ids, decision: "continue_remaining_276"}`；其ids是完整原首12项，包含旧首题。不删除任何原登记，不重跑旧首题，不自动重试或追加。
