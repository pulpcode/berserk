# 开源参考与复用范围

沿用本对话此前已经读取的上游源码证据，2026-11-16 整理。链接为仓库主分支，可变；blob SHA 是当时读取的文件内容标识，不冒充仓库 commit。首版不增加这些扩展依赖，主要复用生命周期思路和公开 Pi SDK。

| 参考 | 已核实逻辑与本期采用部分 | 不直接移植的部分 |
| --- | --- | --- |
| [gamaraan/next-prompt-extension](https://github.com/gamaraan/next-prompt-extension/blob/main/next-prompt.ts) | Pi `agent_settled` 后，使用 `ctx.modelRegistry.complete` 独立请求，持有取消和生成标识；参考“完整轮次结束后单次预测”的边界。约 2807、3189 行；blob `060e9916d0ea6daaf03a82e8125edd5f5fc14591`。 | TUI 编辑器/快捷键、跨宿主兼容层；Axon 用自己已有的 Web 和 ModelRuntime。 |
| [yepyeel/dsh-prompt-suggestion](https://github.com/yepyeel/dsh-prompt-suggestion/blob/main/src/host/suggestion-service.ts) | host 重建 transcript，独立 complete，完成后再次核对 session/来源 turn；参考前后端分离及回包前复核。约 25、54、60 行；blob `472228da204137950bd626ab1bfcc1dda22e9afb`。其 [Web controller](https://github.com/yepyeel/dsh-prompt-suggestion/blob/main/src/client/ghost/controller.ts) 提供异步 UI 参考。 | 不移植切换会话后继续生成/缓存再校验的扩展行为；本期切换即取消。其“输入即隐藏”可参考；本期删空恢复参考 Pi/OpenCode 的同轮内存保留方式。 |
| [MoonshotAI/kimi-code](https://github.com/MoonshotAI/kimi-code/blob/main/packages/agent-core-v2/src/features/promptPrediction/promptPredictionService.ts) | expectedTurnId、每轮已尝试集合、输出拒绝工具调用、回包新鲜度核验；参考一次尝试与拒绝异常输出。约 112、173、286 行；blob `37ca4d55416819a5afe7b3ccd87615fabd17afa6`。 | 完整依赖注入/请求准备系统、遥测结构与共享主 Agent 完整请求形状。 |

以上文件此前已检查所在仓库的 MIT 许可；实现优先自行对接公开能力，若实际复制代码需保留对应许可。

`pi-next-prompt` 的主回复 `<next>` 注入路线与用户选定的独立请求不同，不纳入首版。OpenCode helper session 与其他实现的持久建议记录也不作为 Axon 新建子会话或存储的理由。

第三方实现仅证明路线可行，不证明本项目的延迟、缓存收益、中文补全质量或业务语义准确性；这些由本项目的验收和后续真实抽样决定。

2026-11-16 补充：[输入后隐藏与前缀续显的交互对照](interaction-comparison.md)。该调研补充官方说明和具体输入事件路径；用户随后选择空框展示、输入隐藏、删空恢复，当前方案已同步修订。
