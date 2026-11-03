# 冒烟独立复核

2026-10-30｜Trellis 检查代理复核。此次仅执行离线检查，真实模型请求 0 次。

**结论：可以执行已批准的最多 4 次请求冒烟。** 未发现阻止本次接入检查的问题。6 次业务续跑仍未执行，也不在此次放行范围内。

## 核查结果

- 脚本使用已安装 Pi 0.85.1 的公开 OpenAI Completions API 实现，未改依赖包或产品默认配置。两模型各最多 2 次请求；本地真实执行固定 `lookup`，第二次检查工具调用 ID、回执和最终回答包含实际查询值。
- Qwen 实际请求参数为 `enable_thinking:true`、`reasoning_effort:xhigh`、`preserve_thinking:true`、`max_completion_tokens:32768`，无 `thinking_budget`。Flash 的 enabled/high/32768 与上一轮 `provider.ts` 和 `budget.ts` 相符。
- Pi 源码原生支持 `reasoning_content` → 带字段标识的 thinking block → 原字段回传。离线测试检查两次请求间原文一致、不拼入公开 content；没有思考正文时不会仅凭这一点判错。
- `maxRetries:0` 和每次请求的 fetch 计数共同阻止自动重试；独占创建输出目录阻止重复启动。错误、缺失用量、模型版本变化和截断均停止整批，保留已执行记录。
- Key 只从既有配置读取，不写认证头；请求体检查排除 Key，错误和原生消息脱敏，SSE 记录支持跨块脱敏。原始思考仅存本地忽略目录，摘要只记录长度和回传情况。未知用量保持 null。
- 300 秒 HTTP 空闲计时随收到字节刷新，不设任务总时限。此检查只涉及 Pi 模型协议和工具回传，不证明完整产品 AgentSession、地图标绘、Skill 加载或业务正确率。

## 检查中处理的问题

初检提出 SSE 按单块脱敏不能覆盖跨块密钥的边界问题；实现者补充了尾部缓冲及回归测试，独立重验通过。HTTP 空闲停止由实现者按主会话要求补充，独立重验通过。检查代理未修改产品代码。

没有待决的设计或产品范围问题。没有扩大本次测评、提交或推送 Git。

## 离线验证

| 检查 | 结果 |
|---|---|
| `node --test …/smoke.test.mjs` | 13/13 通过；全部为本地替代传输，无网络 |
| 项目 ESLint 配置检查两个新增 mjs 文件 | 通过，无警告 |
| `experiments/harness-lab` 的 `npm run typecheck` | 通过；新增 mjs 本身由 ESLint、语法检查及运行测试覆盖，不宣称 TypeScript 编译了它们 |
| `git diff --check` | 通过 |

复核文件 SHA-256：

- `smoke.mjs`：`2ffb141462337ac8339f028b7133d2b588197236c200afbac80c94f2d0b4b1a1`
- `smoke.test.mjs`：`df92157afa7f4136f054825b8037e73cecb7d0bace5dfae9f11f0a7dd8ba4e05`

实际运行仍须核对响应中的模型版本、用量、工具调用及答案，不能把本报告的离线通过当作模型已通过。
