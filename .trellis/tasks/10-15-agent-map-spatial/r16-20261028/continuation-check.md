# R16 修复后继续：独立检查

2026-10-28。依据 `continuation-authorization.md` 中用户“修复后继续”的授权。只检查本轮评测修复与继续执行入口，没有改产品、Skill、题目或真实模型配置，没有调用外部模型。

**结论：通过。可使用新冻结版本和独立 `continuation-offline-gate.json` 执行尚未开始的287项。**旧首题不重跑、不改原始waiting_user账本；首关口仍需核对旧1项加新11项的真实证据，再继续剩余276项。不得提前审批、再次领取同一继续执行批次或自动追加。

冻结哈希：`9abeb5c4b600e53b2adf6dba22260f39ffedeeb3db8d16b0bed9f466bd273aee`。独立重新运行 `sourceFreeze(await loadQ07Continuation())`，与 `frozen-continuation.json` 完全一致。

## Findings (fixed)

1. `cases.ts`：去掉“当前轮必须有新工具”的可选邀请识别条件，按真实 `lastResult.requestId` 选本轮答复。Q07第二轮可以复用历史证据。`none`只表示没有需要脚本回应的问题，不产生语义通过评分；没有证据或答错的回答仍交给评分器判断。
2. `cases.ts`、`cases.test.ts`：独立检查先发现两条“已知半径、仍需中心”的反例，又发现“还没有生成范围，如果要继续需要天气”的反例。owner补充明确参数请求和当前继续依赖检查，已知中心按原白名单回应，未知天气保留uncertain。真实Q07未来保存条件仍判none。只修本次发现的边界，没有用隐藏正确答案决定是否继续。
3. `live.ts`：新增本次专用继续入口和独立claim/gate。旧1+新287合并索引保留两套执行来源；初次假模型检查因等待最终cases修订而主动中断，顺带发现关口先于fatal检查的问题。owner已使中断/失败优先退出，不进入审批回调。原中断日志保留，不算通过。
4. `live.ts`：复用评分同时校验旧终评、独立复核、裁决的实际源哈希；不只保存一段引用字符串。原评分与报告不能被后续总报告覆盖。

源文件由各owner修改，reviewer只做复核与报告；没有并发改动其代码。

## Findings (not fixed)

无阻止本次继续执行的问题。保留以下限制：

- 这不是通用自然语言意图分类器。真实未知问题仍停批，不能保证所有未来措辞都已覆盖；本次不继续穷举句式。
- 假模型检查证明接线、状态和调度，不证明模型分析正确。正式首关口仍需看实际结果；模型业务错误不能因流程结束而变成通过。
- 旧首题在误停调查中已知组别，因此复用分数不声称独立盲评。两轮证据完整、产品/题干/配置一致；修复影响发生在完整回答之后，故复用这一次结果合理。
- 新目录 `runs.json` 是287项。最终评分须使用 `combined-runs.json` 和 `combined-evidence-index.json` 合并旧1项；不能把287项直接当整批，也不能机械将旧waiting_user重新记为语义待定。后续结果另存，不覆盖受哈希保护的旧报告。

## 授权与调度核对

- `loadQ07Continuation`只接受原冻结哈希及首题 `Q07-1-GST`，要求其两轮原生succeeded、无待响应交互、已有独立通过分数，旧4次Provider请求全部结束且用量完整。
- 另外287项必须仍是not_executed、没有开始时间/盲ID/原题发送记录；调度与原288逐项一致。独立加载验证旧1+新287恰好288个唯一ID，无重无漏。
- 新claim以独占创建方式落盘，旧claim只读；再次启动即拒绝。新代码不会读取失败后自动恢复或重试的通用路径。
- 首批只准备Q07其余三组，彼此数据相同且canonical哈希必须与旧首题一致；随后按原四组顺序继续。没有重新派发首题目录或复制一份新成绩冒充执行。
- 第三个批组结束后形成旧1+新11的首12关口，包含旧blindId、原始waiting_user和旧4次用量。关口审批必须匹配新freeze与原前12个ID；故障/中断不会进入审批。余下276项属于原批准范围。
- 新冻结包含继续授权、复用评分及旧批次1062个文件的哈希；每次请求前重新校验。旧27份driver快照均与原冻结一致，归档子目录不混入新顶层driver集合。
- 初始driver仅 `cases.ts`、`cases.test.ts`、`live.ts` 改动；新增 `live.continuation.test.ts`。数据、题干、调度、评分规则、runtime、provider、预算配置没有改变。1268个受保护文件无漂移。
- 人工金额上限取消的授权继续有效；实际错误、未知用量、版本变化、未知必需澄清等仍停批。不启用超额后付费。

## Verification

| 检查 | 结果 |
| --- | --- |
| 最终Lint | reviewer执行全部R16 TS，使用harness-lab实际配置：通过。 |
| 最终TypeCheck | reviewer执行R16 tsconfig的tsc --noEmit：通过。 |
| 用例/Provider/评分单测 | reviewer独立运行25/25通过：cases 8、provider-budget 7、review-tools 10。 |
| 继续执行合同 | owner最终1/1通过，reviewer已读代码与 `runner-contract-final.log`。覆盖拒绝重复/乱序/跳过ID、拒绝已开始槽位与错误复用分数。 |
| 最终原生继续链路 | owner最终1/1通过，真实本机HTTP配假模型执行15个新槽位。前三组Q07完整两轮且第二轮零新工具；旧1+新11关口触发并校验后再发4项。旧批次、旧claim和正式claim不变，新claim拒绝二次使用。 |
| 未知澄清停批 | owner最终2/2通过：普通文字与交互API未知问题均保留waiting_user，停止后续任务，不自动回复或重试。 |
| 初次离线中断 | `runner-native.log`保留。人为SIGINT时关口观察到10而非11项，属被中断检查，不计通过；已修关口顺序后使用独立最终日志。 |
| 最终冻结 | reviewer实际重新生成内存冻结并与新文件deepEqual，28份driver全部匹配；原27份快照和1268保护文件无变更。 |

最终原生检查位于 `continuation-offline-logs/runner-native-final.log`；未知问题检查为 `runner-unmapped-final.log`。检查记录及文件哈希见 `continuation-check-evidence.json`。旧check.md、旧offline-gate.json和原始误停报告保持原样。本报告仅允许进入已授权继续流程，不声称287项已经执行。
