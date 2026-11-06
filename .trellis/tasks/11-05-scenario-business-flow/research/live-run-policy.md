# 首批真实模型测评边界（2026-11-06）

依据用户批准的 v0.2/S4，仅在新建临时数据目录执行一次十二步/十三条来报的完整事件演示。不会读取线上任务、向实际席位发业务消息或修改线上服务。

## 冻结项

- 复用用户已授权的火山方舟 Agent Plan Key，密钥仅进程内加载，不输出、不写入证据或 Git。
- provider：volcengine-agent-plan；模型：deepseek-v4.1-flash；端点：https://ark.cn-beijing.volces.com/api/plan/v3 。禁止自动发现、其他模型回退、HTTP 重试和重定向。
- SDK 输出上限 8192 token；提供方输入上界按已核验的 1048576 token 预留，独立于宿主用于压缩的上下文窗口估计。
- 一条来报最多一次自动预处理；每步等待原生完成证据和总体席投递后再推进。任务创建与可选工作交接为明确的脚本操作，记录为脚本操作，不冒充 Agent 自主行为或真实人员验收。
- 脚本、预算守卫、场景数据及实际配置的 hash 由驱动保存。失败批次保留，不原地覆盖或自动重新运行。

## 预算上限

| 项目 | 上限 |
| --- | --- |
| 实际提供方 HTTP 请求 | 80 次 |
| 输入 token，含缓存 | 2000000 |
| 输出 token，含提供方报告的推理消耗 | 131072 |
| 批次时长 | 1200 秒 |
| 保守费用估算 | 10 元人民币 |

费率按输入 2 元/百万 token、输出 8 元/百万 token 估算，缓存也按全额输入计。根据 2026-11-06 读取的[火山方舟官方模型价格表](https://docs.volcengine.com/docs/ark/model-pricing?lang=zh&redirect=1)的 deepseek-v4-1-flash 高峰单价；[Agent Plan 超额规则](https://docs.volcengine.com/docs/ark/agent-plan-personal-over-quota-postpaid-rules?lang=zh)引用同一价格页。该值用于测评限额，不冒充实际账单或套餐积分抵扣量；不改账户的超额付费设置。

守卫在实际请求前预留已核验输入上界和实际 max_tokens 对应的输出上界，再按真实 usage 结算。额度不足、usage 缺失、端点/参数异常或预算耗尽即停止后续调用；证据保留未结算预留，不能按零费用继续。

## 结果口径

protocolCompleted 只证明接收、原生处理、投递及脚本操作链条完成。semanticReviewPending 保持到独立核对；后续本代理对公开答复、实际工具和业务状态的离线核查明确标为代理审阅，不称为独立人工评注。确定性测试、真实模型处理、语义核查与用户最终检查分别记录。
