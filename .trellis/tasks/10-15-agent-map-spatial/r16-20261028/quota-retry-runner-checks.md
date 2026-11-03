# R16 额度恢复后的一次重试与续行

用户已明确“额度已重置，重试继续”。本次只适配评测器 `live.ts` 并增加专项离线测试；产品、Skill、六个工具、模型、题干、数据和澄清分类不变。

## 本次执行什么

| 原槽位状态 | 处理 |
| --- | --- |
| Q07-1-GST：两轮完整，原误停标签保留 | 复用原结果、blindId和评分，不再执行 |
| Q07-1-G0：两轮完整 | 复用原结果、blindId和评分，不按得分决定是否复用 |
| Q07-1-GS：AccountQuotaExceeded 429中断 | 只允许本次授权的一次新尝试，从独立新会话开始；旧尝试另存 |
| 其余285项未开始 | 按原调度继续 |

新批次执行286项，主结果仍按原288个唯一槽位汇总。旧GS是同一题的中断尝试，不增加一道题，也不从结果中删除。新的GS若再失败，仍立即停止，不能再次自动重试。

## 保留哪些记录

两个旧批次的claim、冻结、原始响应、错误、账本和评分均原样保留。新入口严格校验原两个冻结、唯一指定的旧GS中断状态、实际HTTP429与`AccountQuotaExceeded`错误码、两项完整结果和剩余285项未开始状态。旧证据逐文件哈希以及复用评分来源均绑定到新冻结。

新登记为 `quota-retry-claim.json`，只写一次。独立门禁为 `quota-retry-offline-gate.json`。不覆盖旧两个登记或旧门禁。

新输出中：

- `combined-runs.json`：原GST、原G0和新286项，共288个唯一槽位。
- `combined-evidence-index.json`：保留三批证据目录。GS标为第二次尝试，并指向其旧中断blindId和原始证据。
- `prior-interrupted-attempts.json`：原GS中断记录原样单列；不把它的pending评分混入新主288项评分。
- `combined-usage.json`：旧11次请求与新账本分别列出。旧未知用量1项仍是未知，累计金额和token只是已知部分，`knownUsageOnly`明确为true。

新的ledger从请求0、未知0开始；用户的明确授权允许在旧未知记录保留的情况下继续。旧未知并未被填成0，也没有被删除。新出现的未知用量或真实故障仍停批。

## 首12项如何组成

首Q07的新GS、GT两组全部准备完成后，与两批旧GST、G0的标准化初始数据核对一致，才发送第一条模型请求。

首12项关口为旧2项＋新10项。同一进程在关口等待root核对批准后，才执行原剩余276项。批准文件仍使用完整原首12项ids，格式为 `{freezeHash, ids, decision: "continue_remaining_276"}`。

## 离线验证

合同检查1/1通过，见 `quota-retry-offline-logs/runner-contract.log`：固定两个完成槽位、GS一次重试及285未开始槽位；拒绝其他已开始槽位、不同429错误码、换序或漏组；将G0评分设为失败后仍必须复用，防止按得分筛选。

原生假模型检查2/2通过，共128.9秒，见 `quota-retry-offline-logs/runner-native.log`：验证新GS独立会话、旧2＋新10关口及之后4项；验证三个来源的288项映射、旧中断另存、11次请求和未知1项合并；另验证新GS再次429后只发1次请求并停止，拒绝再次登记。最终通过结果见独立复核报告。

没有调用真实模型，不重复旧整套原生检查。账户快照按root记录使用用户已重置的确认及已知下界；不为此新增模型探测或变更账号设置。

## 正式执行入口

在 `experiments/harness-lab` 目录：

```sh
node --import ./node_modules/tsx/dist/loader.mjs ../../.trellis/tasks/10-15-agent-map-spatial/r16-20261028/live.ts prepare-quota-retry ABS_NEW_FREEZE.json
node --import ./node_modules/tsx/dist/loader.mjs ../../.trellis/tasks/10-15-agent-map-spatial/r16-20261028/live.ts retry-r16-after-quota ABS_NEW_OUTPUT ABS_NEW_FREEZE.json ABS_ACCOUNT.json 4807
```

新门禁的freezeHash必须匹配新冻结，`status: "passed"`且有非空证据列表。输出位于 `.local/spatial-r16` 的新目录。原claim不可删除，新claim不可复用。执行前完成离线与独立复核，执行期间保持所有冻结源和旧证据不变。
