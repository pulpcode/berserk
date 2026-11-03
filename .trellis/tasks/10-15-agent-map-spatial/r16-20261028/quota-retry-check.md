# R16 配额重置后重试：独立检查

2026-10-28。依据用户“额度已重置，重试继续”及 `quota-retry-authorization.md`。只检查评测入口与现有证据，未调用外部模型。

**结论：通过，可按专用入口执行本次286项。**其中Q07-1-GS是唯一允许重试一次的旧中断项，另外285项此前未开始；GST和G0两项完整结果复用。仍须在旧2项加新10项后检查首12关口，再继续276项。不是允许自动循环重试或扩充题目。

最终冻结哈希：`8e113cae33e7a9a21f66f39c9c4e7f951466feab3c36aa035228343b8453cd2e`。reviewer实际执行 `sourceFreeze(await loadQuotaRetry())`，与 `frozen-quota-retry.json`完全一致。

## Findings (fixed)

- `live.ts`：专用 `retry-r16-after-quota` 入口绑定原两批冻结、旧claim、明确槽位和原始用量。新claim独占创建，第二次登记被拒绝。旧完整结果不重跑，新GS使用独立会话和blindId，旧GS中断记录仍单列。
- 独立审查提出仅检查HTTP429不足以准确对应本次授权。owner已补核原 `provider-0007-error.txt` 的 `AccountQuotaExceeded`，以及原meta的GS身份、429状态和完成标记；不同429错误码在离线反例中被拒绝。
- 合并索引保留三种来源：旧GST、续行G0、本次新任务。GS新槽位标记attemptNumber=2并指向旧中断证据；`prior-interrupted-attempts.json`另保留原失败尝试，不占第289个评分槽位。
- 合并用量保留旧11请求、1次未知用量和约24.794已知AFP。新ledger独立从0开始，历史未知仍显示在总账，不冒充0费用，也不阻止已获授权的本次重试。再次发生错误仍立即停批。

所有实现由runner owner完成；reviewer没有修改源文件。

## Findings (not fixed)

没有发现阻止本次执行的问题。当前余额与超额付费设置无法重新通过网页确认；账户文件明确记为未知，数值0只是保守下界，不能报告为实际余额为0或已确认充足。用户确认重置、原重置时点已过，且取消了人工金额门槛；没有启用账户设置、增加付费探测或另设余额启动条件。

旧未知费用仍无法由现有响应还原。最终报告应显示已知费用加1次未知，不能因为重试成功删除旧费用或旧中断。真实业务正确率仍待正式执行与评分，本次离线通过不代表模型通过。

## 核对重点

| 项目 | 结果 |
| --- | --- |
| 指定重试 | 仅Q07-1-GS，原状态incomplete、首轮未完成/次轮未发、原第7请求AccountQuotaExceeded；其他已开始任务不能混入。 |
| 唯一调度 | 旧2+新286=原288个唯一ID，顺序完全一致；新286=指定重试1+未开始285。复用按既定完整槽位选择，不按分数择优。 |
| 首四组 | 新GS/GT先全部准备，彼此canonical相同，并与旧GST/G0及旧GS夹具校验一致；模型请求前即核对。 |
| 首12关口 | 旧2+新10，审批绑定新freeze与原前12个ID；通过后才派发后276。故障/中断不进入审批。 |
| 旧证据 | 初始1062、续行838个文件及两份旧claim哈希一致；旧停止状态、旧blindId和分数不覆盖。 |
| 冻结范围 | 相对上一续行仅live.ts改变，新增live.quota-retry.test.ts；产品/Skill/工具/数据/题干/分类逻辑/评分/模型保持不变。初始27份、续行28份driver快照和1268个保护文件均完整。 |
| 失败停止 | 新GS再遇429只发1次请求，后续任务不执行；新claim不允许再次启动。历史unknown1加新unknown1得到unknown2，不能归零。 |

## Verification

- **Lint：通过。** reviewer运行全部R16 TS，使用harness-lab配置。
- **TypeCheck：通过。** reviewer运行R16 tsconfig的 `tsc --noEmit`。
- **合同单测：1/1通过。** reviewer独立重跑；验证指定槽位、288分母、额外中断索引、旧11请求unknown1、拒绝其他已开始项和不同429错误。
- **原生离线：2/2通过。** owner运行真实本机HTTP配假模型，reviewer核对代码与最终日志。成功路径执行14个新槽位、30次假请求，验证旧2+新10审批后才继续4项、旧证据未动及再次登记拒绝；失败路径新429只请求一次即停止。
- **新冻结：一致。** 实际重新计算并deepEqual；29份当前driver与新冻结匹配。所有历史快照/保护文件的哈希再次核对通过。

证据：`quota-retry-check-evidence.json`、`quota-retry-offline-logs/runner-contract.log`、`quota-retry-offline-logs/runner-native.log`。没有修改旧报告或旧门禁；主会话应生成独立 `quota-retry-offline-gate.json`，不得覆盖之前两份门禁。
