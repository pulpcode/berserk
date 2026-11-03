# R15 服务商与额度核对

2026-10-27只读核对，无模型探测、无订阅设置变更。

- 沿用R14 deepseek-v4.1-flash，请求enabled/high，预期返回deepseek-v4-1-flash-261017；不切换Economy或V4 Flash。首个计划内请求核对实际模型与协议，异常即停。
- [Chat API](https://console.volcengine.com/ark/region:cn-beijing/docs/chat-api)确认max_completion_tokens包括思考与回答，不与max_tokens并用。沿用批准32768。
- [Flash说明](https://console.volcengine.com/ark/region:cn-beijing/docs/deepseek-v4-1-flash)支持high；读取思考字段作为观测，不以每次有可见思考为业务成功条件。
- [AFP规则](https://console.volcengine.com/ark/region:cn-beijing/docs/agent-plan-personal-afp-credits-billing-rules)当前Flash输入/输出系数均1.25。模型用量按返回总输出计，不重复加reasoning_tokens。
- 已登录套餐页面显示：近5小时用0/10000，周用3869.673/35000，月用5326.43/100000。冻结剩余额度见account-preflight.json；保留1000AFP给其他会话，本轮仍以2000AFP为上限。

页面把V4.1-Flash列为即将下线，当前仍可用。不自动迁移模型；真实响应改变则停批次并报告。
