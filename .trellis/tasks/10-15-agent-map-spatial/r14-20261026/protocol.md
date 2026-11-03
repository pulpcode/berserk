# R14 执行协议

2026-10-26，用户批准“提交git，然后开始”；方案已提交 `ccb4a11`。本轮144个完整任务，预算、题干和停止规则见 [plan.md](plan.md)。本协议落实已批准范围，不授权重跑。

## 固定配置

| 组 | 请求模型 | 思考 | 强度 | 预期实际版本 |
| --- | --- | --- | --- | --- |
| A | deepseek-v4.1-flash | disabled | 不发送 | deepseek-v4-1-flash-261017 |
| B | deepseek-v4.1-flash | enabled | high | deepseek-v4-1-flash-261017 |
| C | deepseek-v4-pro | enabled | high | deepseek-v4-pro-ga-260813 |

只使用 Agent Plan `https://ark.cn-beijing.volces.com/api/plan/v3`。三组不主动发送 temperature/top_p。实际模型必须符合上表，D01正式三项负责核验；不额外付费探测，身份不符即停，不把任意首个返回接受为基准。

**输出限制的实施澄清：** 方案规定每次32,768 token且包含思考。2026-10-26复核方舟Chat文档后，将实际wire字段统一为 `max_completion_tokens=32768`，删除 `max_tokens`，避免Pro的 `max_tokens` 仅限制回答而遗漏思考。保持原来批准的总长度和预算；不是增加输出上限。原生SDK请求经隔离传输适配后保存差异，正式D01验证兼容，异常不重试。

## 夹具与代码隔离

产品src、Skill、依赖固定归档6a631a42b99b01de334cd2017c07bf0d9d58a560。新增数据需要的改变只在隔离测试scripts中：固定合成日期；载入对应题目的来源初态（缺几何及指定坐标）；D04数量字段缺失改放在草稿属性中，符合当前接口。继续使用真实mock来源服务、原生查询工具和状态API，不伪造工具回包。明确记录允许变化及哈希，三组完全相同。旧轮和未提交候选由 `protected-before.json` 保护。

24题与评分材料留在评测侧，不放进模型工作区；模型只能看到正常业务背景、原生Skill目录和本题用户原话。每槽新账号/会话/状态；同题三组启动前确认业务初态等价。D12仅在已规定用户轮之间通过真实模拟来源更新API将4改为1，三组相同。

## 预算与运行

144槽位、1600请求、36,000,000输入、3,000,000输出、12,000AFP各自为上限。三组开始前预留60请求、1,500,000输入、262,144输出、1,000AFP；单次预留保守输入和完整输出上限。模型的正常工具往返继续至自然完成，不设10次调用截断。工具有进展不按总时长截断；300秒空闲、网络/HTTP/流异常或未知usage则停。

AFP按(input+output)×系数/10,000估算：Flash1.25、Pro5.5；思考包含于输出，不重复计数。启动前记录账户5小时、周、月余额；本地消耗从观察余额保守扣减，额外留1000AFP应对其他使用。额度不足不自动跨窗口恢复，不启用超额后付费。账户核验缺失不能被旧截图替代。

仅D05/D06允许一次预先冻结的选择回复；D04/D08按缺口题评分。其他明确题无必要确认记失败继续，未预设的真实必要澄清停批次。已经完成后的可选邀请不能阻止下一用户轮；有效tool_calls必须执行。错误答案不追问修正；零可见思考不单独触发停测。

原始证据、claim、请求账本仅追加不覆盖。开始过的槽位不得换目录重发；中断后补测须另授权。所有子调用/压缩/失败尝试计入；不增加外部裁判或探测。

## 只读核验依据

核对日期2026-10-26；以下是公开契约核对，不代表账号或模型已实测通过。

- [方舟深度思考](https://console.volcengine.com/ark/region%3Acn-beijing/docs/deep-thinking)：列出Flash261017和Proga260813的enabled/disabled与high支持。
- [Chat API](https://docs.volcengine.com/docs/ark/chat-api?lang=en)：max_completion_tokens包含回答和思考，与max_tokens互斥。
- [Agent Plan接入示例](https://docs.volcengine.com/docs/ark/agent-plan-personal-zcode?lang=en)：套餐入口及Flash/Pro名称。
- [三方工具接入](https://docs.volcengine.com/docs/ark/integrate-third-party-tools?lang=en)：套餐与按量API入口区分，OpenAI兼容契约。
- [AFP抵扣规则](https://docs.volcengine.com/docs/ark/agent-plan-personal-afp-credits-billing-rules?lang=en)：Flash限时1.25至2026-12-30，Pro5.5；本地按此估算，账户账单另对账。

## D04修订授权

2026-10-26用户确认：“只要题目和问答保持一致且和当前的系统不冲突就可以”。据此将D04从来源缺数量改为草稿 vehicle-points 属性缺数量；三处坐标及甲4、乙未知、丙2、已知6/总数未知的目标不变。同步题干、数据、真值、评分后做受影响离线检查，不改产品校验。旧502离线失败记录保留；其他23题、三组两遍144项、预算与无自动追加规则不变。
