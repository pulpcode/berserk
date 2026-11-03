# 冒烟准备与离线检查

2026-10-30。此记录只说明接入准备；尚未执行真实请求，不代表业务正确率。

## 改了什么

本目录新增 `smoke.mjs` 和 `smoke.test.mjs`。通过已安装 Pi 0.85.1 的公开 `openai-completions` API，完成一条中性查询：模型调用 `lookup`，脚本实际读取固定表，再把工具结果送回模型，让它回答。模型在第一次请求中看不到表中的答案。

工具仅供本次协议检查使用，不涉及地图、真实业务数据或用户文件。没有修改产品 Skill、工具、默认模型和线上服务。本次验证范围是 **Pi 模型适配器及工具结果接续**；尚未验证产品 HTTP、AgentSession、Skill 加载和业务工具链路。

Pi 已能把响应的 `reasoning_content` 存为带原字段标识的 thinking block，并在第二次请求中还原到原字段。离线检查验证了原文一致且未混入公开 `content`，因此没有新增思考历史补丁或第二套会话状态。任务脚本的 `onPayload` 只补请求参数。

## 参数与执行边界

| 项目 | Flash | Qwen |
|---|---|---|
| 请求模型 | deepseek-v4.1-flash | qwen3.8-max-0902 |
| 预期响应版本 | deepseek-v4-1-flash-261017 | qwen3.8-max-0902 |
| 推理 | thinking enabled / high | enable_thinking true / xhigh |
| 思考保留 | Pi 原生原字段回传 | preserve_thinking true + Pi 原生原字段回传 |
| 输出上限 | max_completion_tokens 32768 | max_completion_tokens 32768 |
| 请求上限 | 2 | 2 |

Flash 参数与 `../improvement-20261029/provider.ts` 的 `actualPayload` 及 `budget.ts` 一致。两端读取既有本地配置，Key 不打印、不复制、不入 Git。Qwen 不设置 thinking_budget，不启用内置搜索；两组没有搜索工具。

执行顺序固定为 Flash → Qwen。已有输出目录会直接拒绝重新运行。HTTP/传输错误、用量缺失、版本变化、截断、错误工具参数或第二次仍要工具，均保留现场并停止整批，不自动重试。第一轮没有思考正文不单独判错。HTTP 连续无响应超过配置中的 300000 毫秒会停止；每次收到数据刷新计时，不设任务总时限。

原始请求、响应、Pi 消息和工具回执只写入 Git 忽略的 `.local/qwen-comparison-20261030/smoke/`。含供应商思考正文的文件不公开归档；摘要只记思考字符数、token 用量及回传是否一致。密钥和认证头不写入记录，SSE 跨块密钥也会脱敏。错误用量保留 null，不记为零。

## 离线检查

命令（仓库根目录）：

```sh
node --test .trellis/tasks/10-28-agent-spatial-plotting/qwen-comparison-20261030/smoke.test.mjs
```

13 项通过，真实模型请求 0 次。覆盖两模型原生 Pi 工具调用接续、原字段思考保留、零思考、未知用量、版本漂移、429 不重试、错误工具参数、第二次仍请求工具、一次性目录、启动授权、参数边界、跨块密钥脱敏及 HTTP 空闲超时。

独立检查通过后，由主会话执行已获授权的冒烟，最多 4 次请求：

```sh
node .trellis/tasks/10-28-agent-spatial-plotting/qwen-comparison-20261030/smoke.mjs --live --authorize-max-four
```

不执行方案中的 6 次业务续跑。冒烟成功只说明上述协议链路可用，不说明来源歧义处理已改善，也不说明完整产品已切换到 Qwen。

## 源码依据

安装包 `@earendil-works/pi-ai` 0.85.1 的公开导出 `./api/openai-completions`：流处理约第 415 行识别 `reasoning_content` 并保留字段标识；`convertMessages` 约第 1001 行使用该标识回传。公开 `fetch` 和 `onPayload` 用于参数设置与审计。没有修改依赖包。
