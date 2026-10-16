# P0 评分器校准与历史证据离线回放

日期：2026-10-16。状态：确定性校准和离线回放完成，完整自然语言语义仍待独立审阅；不据此改变 AC10 未通过的结论。

## 实施与边界

- 新评分器 `spatial-facts.v2` 分离工具路径覆盖、核心事实断言、完整回答审阅、Skill 加载与实际/尝试写入。自动通过不是语义通过，`semanticReview` 仍为 `pending_review`，`semanticSuccess` 仍为 `null`。
- 原始固定标绘与独立来源快照核对完整身份、属性和几何。标绘 ID 的 JSON ref 键顺序不改变身份；伪造 ID、跨来源/版本替换仍拒绝。实际 provider toolCallId、参数和原始成功消息相互核对。
- 按实际参数解析依赖，支持生成几何经中间结果 items 传播；固定范围必须参与最后相关资源筛选。数值绑定请求对象和指标。预先声明的逐对象关系、筛选后人工分类、完整排序后取前 N 等价路径有对应校准例。相关结果存在矛盾时不靠选择最后一条隐藏矛盾。
- 点缓冲另外使用独立球面径向与角度覆盖断言；不宣称它验证任意线缓冲。完整答复中的附加判断、边界拒答是否正确、人工取前 N 是否正确转述仍需审阅。
- 保存检查精确 resultRef、图层、对象 ID、名称、几何及其他原始图层未变。工具调用与发布/采用、实际草稿改变分开记录。
- 下一版夹具标记 `spatial-fixtures.v2`：D18 不要求加载空间 Skill；H04 的 r2 实际缺少 category。旧捕获夹具/分数不变；历史 H04 不构成缺字段覆盖证据。
- 新准备阶段经真实认证的 `/api/context/situation` 分页保存独立 sourceSnapshot、sourceAreaIds、sourcePages。来源缺位置故障在保存的有效原始响应中可见，不能拿空间结果反推准备快照。
- D13/D17/H06 的预设能力边界可进入 `boundaryWaitingReview`，与协议完整完成分开；预算取消及普通可完成任务的拒答不获此豁免。是否正确澄清/拒答仍需审阅。离线旧轮保留原 protocol 判定，不追溯修改运行事实。

## 验证

- `npm run typecheck`：通过。
- `npm run lint`（含依赖边界）：通过。
- `npx vitest run tests/probe-spatial-evaluation.test.ts tests/probe-spatial-evidence.test.ts`：2 文件、30 测试通过。
- D14/H04 真实 `--prepare-only`：均 prepared、providerCalls=0。新目录 `/private/tmp/spatial-remediation-p0-prep-d14-r2` 与 `/private/tmp/spatial-remediation-p0-prep-h04-r2`。D14 sourceSnapshot 为 0（实际缺几何故障），H04 独立来源对象 6 个，r2 缺 category。此前错误 task 级来源路由造成的 404 准备失败保留，修复为实际 seat 级端点后使用新目录验证。
- 以上为工程测试和脚本准备验证，无真实模型调用；校准例由实现者编写并经代码审查，不宣称经过独立人工业务裁决。

## 离线回放结果

最终证据目录：

- `/private/tmp/spatial-eval-20261016-p0-replay-v2-final/summary.json`
- `/private/tmp/spatial-eval-20261016-p0-replay-v2-final-focused/summary.json`

每条输出包含新旧断言差异、原因、旧人工评审原样副本、输入 SHA-256；summary 保留评分器源码 SHA-256。读取原 plan.spec；不以新夹具改写旧试次，不覆盖原 score/manual-review，不调用模型。开发中 r1—r4 中间回放目录全部保留，以 final 的源码哈希和结果为此次基准。

| 批次 / 条件 | 实际重评 | 旧自动通过 | 新自动通过 | 自动通过→失败 | 自动失败→通过 |
|---|---:|---:|---:|---:|---:|
| v1 / A | 72 | 48 | 57 | 0 | 9 |
| v1 / B | 72 | 60 | 67 | 0 | 7 |
| v1 / C | 72 | 56 | 66 | 0 | 10 |
| v1.1 聚焦 / A | 3 | 2 | 2 | 0 | 0 |
| v1.1 聚焦 / B | 3 | 3 | 2 | 1 | 0 |
| v1.1 聚焦 / C | 3 | 3 | 3 | 0 | 0 |

首轮 216 条均可读取并完成新评分；新自动通过 190/216。这里的 26 条自动失败→通过主要涉及等价方法与合法中间结果传播，**不是 26 条完整任务已经证明误判失败**：回答、范围表述与实际效果仍需结合独立评审。更不能将 B/C 自动分数高于 90% 当作满足整体 90% 门槛。

聚焦轮 9 条均可读取。D11-2-A、D11-2-B 含来源依赖但原批次没有独立来源准备快照，标记 `input_snapshot_or_prior_result_unavailable` / `unverifiable`；其中 B 是自动通过→失败的 1 条，属于证据不足，不据此判为真实模型失败。不能从分析输出制造缺失的独立快照。

原完整回答评审及历史验收结论没有被覆盖。最终效果报告仍须按冻结新版本、独立完整回答审阅、新保留集和既定 90% 门槛完成；此次只建立更可靠的事实检查基础。

## 后续预算边界校准（同日，未重跑历史 225 条）

代码审查发现：同一事件既触发 pending interaction 又超过 600 秒时，旧处理顺序会先锁定 unanswered_interaction，掩盖预算耗尽。现先选预算原因，再记录交互与取消；持续记录 budgetExceeded，即使首次取消原因已锁定也不允许当作正确边界等待。边界等待还必须是 cancelled，failed/succeeded 等结束状态不获得此豁免。

新增确定性回归覆盖同时到达的 wall/tool 预算、精确阈值、普通完成、边界等待及失败状态。历史回放没有可用于这项事件优先级校准的完整时序预算材料，故按授权不重跑 225 条、不改旧快照/score/review；此前 final 目录的哈希继续准确标识当次离线使用的代码。下一轮 CLI 使用新冻结快照。

`probe-spatial-evaluation.ts` 的 SHA-256：

- 历史 final 回放：`7b28f11b4e49818329879e82b892b67e4bb9992a60e447bdd36ab79300bfb80b`
- 本次预算修正后：`c6e6d8603b3a2f4a06f9317d392de2f9388517d56544a8a3221bb7126e9aeb32`

上述源码哈希差异仅说明 CLI/协议处理随后修正，不能将旧回放结果描述为新 CLI 的真实模型运行结果。

预算修正后的验证：定向 2 文件共 31 测试通过；完整 `npm run typecheck`、`npm run lint`（含依赖边界）通过。未调用模型。
