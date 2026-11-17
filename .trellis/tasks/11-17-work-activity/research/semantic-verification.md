# 真实模型语义验证

2026-11-17。全部输入为合成对话、合成工作候选，调用实际 `configuredRuntime` 和生产独立分析 helper。没有打开业务数据库或正式执行前台Agent/交接，不能替代完整业务端到端测试。

使用现有环境配置的前10次请求返回服务错误，单样例补充诊断确认 `402 Insufficient Balance`。随后只读加载本项目已有默认模型设置（deepseek-v4.1-flash），未修改设置、未复制密钥。

| 记录 | 模型 | 机械场景检查通过 | 时延范围 ms | SDK totalTokens |
| --- | --- | --- | --- | --- |
| [semantic-initial](semantic-initial/results.json) | deepseek-flash | 0/9 | 379–737 | 0 |
| [semantic-provider-diagnostic](semantic-provider-diagnostic/results.json) | deepseek-flash | 0/1 | 764–764 | 0 |
| [semantic-configured-diagnostic](semantic-configured-diagnostic/results.json) | deepseek-v4.1-flash | 1/1 | 2019–2019 | 707 |
| [semantic-configured](semantic-configured/results.json) | deepseek-v4.1-flash | 8/9 | 631–2256 | 5475 |
| [semantic-final](semantic-final/results.json) | deepseek-v4.1-flash | 8/9 | 831–2214 | 6027 |
| [semantic-format-ambiguity](semantic-format-ambiguity/results.json) | deepseek-v4.1-flash | 1/1 | 1633–1633 | 704 |
| [semantic-format-personal](semantic-format-personal/results.json) | deepseek-v4.1-flash | 1/1 | 1577–1577 | 591 |

## 人工审阅与修正

- 第一个有效完整批次8/9：个人学习计划的内容已识别，但因为没有正式候选被判为uncertain；用户目标要求明确个人活动仍显示正在处理。提示词分开“活动明确”和“正式工作匹配”两件事后复测。
- 第二个完整批次8/9：个人活动已修正；同名采购歧义的语义正确（null + uncertain），但模型标题含换行，被严格控制字符规则拒绝并返回不可用。补充已有单行格式约束，未放松解码。
- 最后针对同名歧义与个人活动各复测一次，2/2通过。没有在最终提示词上重新跑全9组，不能宣称一轮9/9，也不能将小样本结果当作总体准确率。
- 已逐项阅读两轮有效完整批次的活动描述与证据：两个独立目标分两项、同一工作两份文件不拆分、参考培训工作不误算当前办理、明确切题后不沿用采购工作、同名对象不强选、闲聊为空、缺少另一对话历史时保留未知。
- “助手称已提交”样例仍保留权威working状态，描述指出缺少真实提交回执，没有转换为已提交业务事实。

各 JSON 保存实际上下文、结构化结果、原文本输出、耗时和用量，包含所有失败。输出无模型凭证和真实业务资料。SDK注册价格是0，记录中的cost不代表真实账单金额。

这些结果支持本功能作为可关闭、可忽略的展示辅助；结构校验不能保证未来全部语义判断正确，用户仍可从证据和正式工作详情核对。
