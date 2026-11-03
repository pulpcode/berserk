# 百炼 Qwen 接入冒烟结果

2026-10-30｜已完成，未执行6次业务对照，等待用户审阅方案。

## 结果

两模型均通过。共4次真实模型请求，全部HTTP 200，无重试、无追加、无未知用量。

| 模型 | 请求数 | 输入 token | 输出 token | 其中思考 token | 两次请求累计耗时 | 工具闭环 |
|---|---:|---:|---:|---:|---:|---|
| Flash：deepseek-v4-1-flash-261017 | 2 | 734 | 64 | 0 | 1.618秒 | 通过 |
| Qwen：qwen3.8-max-0902 | 2 | 782 | 117 | 31 | 5.844秒 | 通过 |

用量采用供应商 usage 的 prompt_tokens/completion_tokens；思考列为其中的 reasoning_tokens，不另加一遍。上述耗时仅是一次极简任务的观测，不能据此评价业务速度或模型能力。

## 验证了什么

两组都收到同一要求：调用 lookup 查询 smoke-7。第一次请求不含标准答案；模型产生工具调用后，脚本实际执行本地固定表查询，返回 violet-42，再由第二次请求生成回答。两组工具名、结构化参数、tool_call_id、返回内容及最终答案均正确。

- Qwen 实际请求设置 enable_thinking=true、reasoning_effort=xhigh、preserve_thinking=true、max_completion_tokens=32768；响应版本符合方案。两次都返回了思考字段，第二次请求将第一次的93字符思考完整放回 reasoning_content，没有拼入公开 content。
- Flash 实际请求设置 thinking enabled、reasoning_effort=high、max_completion_tokens=32768，与上一轮一致；实际版本符合预期。本次两次响应思考字段及思考 token 均为0，因此本次真实调用不能验证 Flash 的非空思考回传。该分支已由离线测试覆盖，零思考没有单独判失败。
- Qwen 使用用户指定的百炼工作空间端点；Flash 使用方舟 Agent Plan 端点。实际账单/套餐扣减未查询，不以请求成功替代账单核验。

## 结论边界

**百炼 Key、模型和 Pi 适配器的流式工具调用接续可用。** 本次通过的是任务内 Pi 公开模型 API 和中性本地工具，不是完整产品 AgentSession、地图标绘、Skill 加载或来源歧义分析。

因此不能将两组各一次通过解释为业务正确率100%，也不能据此判定 Qwen 优于 Flash。未改产品 Skill、业务工具、线上配置或服务；未执行计划中的6次业务续跑。后续等待用户审阅方案。

## 检查与证据

执行前13/13离线测试、脚本ESLint、项目类型检查及diff检查通过；独立审核见 [复核报告](reviews/smoke-independent-review.md)。

- [脱敏运行摘要](smoke-summary.json)：参数结果、请求状态、回答和用量。
- [原始证据哈希](smoke-evidence-manifest.json)：关联本地原始证据，未公开思考正文。
- 原始请求、SSE、Pi消息和实际工具回执：`.local/qwen-comparison-20261030/smoke/`，Git忽略。
- [方案](plan.md)、[离线准备说明](smoke-preparation.md)。

本次未提交或推送 Git。密钥未打印、未入报告或 Git；含思考正文的原始记录仅保留在本地私有目录。
