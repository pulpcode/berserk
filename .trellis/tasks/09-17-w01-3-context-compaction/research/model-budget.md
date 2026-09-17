# Research：模型参数与运行控制

日期：2026-09-17。依据：Pi 0.85.1、DeepSeek Harness `0d1f5000`、OpenClaw `5764fa49` 的公开源码及当前应用。未调用真实模型。本期契约统一见 [设计第 4 节](../design.md#4-模型参数与运行限制)。

## 1. 已有实现

experiments/harness-lab/src/server/config.ts 默认整轮 120 秒、8 次工具、输出 2,048；src/pi/lab.ts 另按工具上限加一限制模型调用，并将实验输出值写为模型 maxTokens。配置模板还显式写有早期 90 秒、4 次工具和 2,048 输出。这些是实验约束，不是 Pi 的能力上限；仅修改代码缺省值不能消除旧配置的影响。

## 2. 公开实现依据

| 项目 | 核验结果 | 来源 |
| --- | --- | --- |
| Pi 0.85.1 | 主循环根据工具、追加输入、取消和终止条件推进，没有固定累计工具／模型次数限制；提供宿主停止入口 | [Agent loop](https://github.com/earendil-works/pi/blob/v0.85.1/packages/agent/src/agent-loop.ts) |
| Pi 0.85.1 | HTTP 空闲超时默认 300 秒；Agent 瞬时错误最多额外重试 3 次，provider 重试默认 0；单次 SDK 超时可独立配置 | [Settings](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/settings.md) |
| Pi 0.85.1 | 正常输出按模型能力及剩余上下文收缩；主摘要／前缀摘要按 0.8R／0.5R 与模型上限计算，不固定为 2,048 | [输出选项](https://github.com/earendil-works/pi/blob/v0.85.1/packages/ai/src/api/simple-options.ts)、[摘要](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/compaction/compaction.ts) |
| DeepSeek Harness | 主循环没有内置整轮预算；maxParallelToolCalls 默认 10，控制并发而非累计次数 | [Agent loop](https://github.com/deepseek-ai/deepseek-harness/blob/0d1f50007f9bca3f52b06e1c3074fa14d5fb0720/packages/core/agent-loop/README.md) |
| DeepSeek Harness | DeepSeek 适配器流空闲超时默认 300 秒，输出默认 256,000，可按模型／请求覆盖；该数值不代表所有模型规格 | [适配器](https://github.com/deepseek-ai/deepseek-harness/blob/0d1f50007f9bca3f52b06e1c3074fa14d5fb0720/packages/llm/llm-deepseek/README.md) |
| DeepSeek Harness | 工具可声明各自超时，取消收敛后返回错误供模型处理；重复相同调用在 3／5／8 次时提醒，不按累计正常调用数截断任务 | [工具超时](https://github.com/deepseek-ai/deepseek-harness/blob/0d1f50007f9bca3f52b06e1c3074fa14d5fb0720/packages/guard/timeout-policy/README.md)、[重复提醒](https://github.com/deepseek-ai/deepseek-harness/blob/0d1f50007f9bca3f52b06e1c3074fa14d5fb0720/packages/guard/repeat-tool-reminder/README.md) |
| OpenClaw | 整轮时限默认 48 小时，可显式关闭；与模型空闲超时分开。最新运行内核已自行维护，不能把这些值称为 Pi 默认值 | [运行时限](https://docs.openclaw.ai/concepts/agent-loop#timeouts)、[当前架构](https://docs.openclaw.ai/agent-runtime-architecture) |

这些项目采用不同部署策略。研究支持区分正常持续工作、失败重试、调用超时和可选整体时限，不支持直接照搬某个大数字作为本项目默认值。

## 3. 本期配置依据

DeepSeek 官方将 deepseek-flash 上下文标为 1M；本项目为已核对的官方模型／端点组合取 C=1,000,000，输出能力 M 同样按准确模型映射解析。第三方端点不自动继承，未知 C/M 须填写。[模型说明](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)、[输出参数](https://api-docs.deepseek.com/api/create-chat-completion/)

M 是模型部署的最大输出能力，R 是触发压缩时的预留量，两者不要求大小相等。近期保留量 K、R 的默认小窗口计算和合法性校验由项目提供，压缩阈值与范围由 Pi 决定。usage 是已有响应的统计，随后新增内容仍需估算。

本期默认没有整轮次数与时长上限；模型超时复用 Pi 配置，工具超时按宿主工具定义，可选总时限由服务端显式设置。旧实验环境键只提示迁移，不自动将实验输出额度当成模型能力。原生摘要额度不被普通回答包装覆盖。

## 4. 验证重点

- 默认任务跨过旧次数／时长边界仍能完成；取消、最终失败和显式总时限能阻止新工作。
- 持续响应与真正空闲分别测试；工具超时不等同于整轮失败，未知写效果仍需核对。
- 正常回答与摘要的实际 payload 符合各自额度；失败重试有界，用量与尝试数仅用于观测，不重复汇总。
- 真实探针使用准确 C/M，在独立配置中调整 R/K 提前触发，不污染产品设置。复杂预算、费用额度和重复循环检测后置。
