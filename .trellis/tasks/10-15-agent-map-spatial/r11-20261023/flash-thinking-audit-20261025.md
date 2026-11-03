# R11 Flash 推理设置核查

> 核查日期：2026-10-25。只读核对官方文档及已保存请求；新增模型调用为0，未重跑任务或评分。
> R11 完整结果、评分修复及证据复核已在 `6a631a42b99b01de334cd2017c07bf0d9d58a560` 提交；本文补充调用设置证据，不改变原成绩。

## 1. 已确认的结果

| 请求用途 | 实际请求数 | thinking | reasoning_effort | max_tokens |
| --- | ---: | --- | --- | ---: |
| 64项Agent任务 | 235 | 全部 `{"type":"disabled"}` | 全部未传入 | 全部8192 |
| 24条评分校准 | 24 | 全部 `{"type":"disabled"}` | 全部未传入 | 全部8192 |
| 64条整题首次评分 | 64 | 全部 `{"type":"disabled"}` | 全部未传入 | 全部8192 |
| 合计 | 323 | 全部显式关闭 | 无覆盖参数 | 全部8192 |

- 所有请求的 `model` 为 `deepseek-v4.1-flash`，均未显式传入 `temperature` 或 `top_p`。
- 共享账本323条请求的 `usage.responseModel` 均为 `deepseek-v4-1-flash-261017`。
- 冻结入口为 `https://ark.cn-beijing.volces.com/api/plan/v3`，属于 Agent Plan 的配置；本文未查询账户账单，不把配置核查称为账单核销证明。
- 结论限于这轮R11的323次请求；未逐轮核查更早批次，不能推断所有历史测评设置一致。

此前成绩反映关闭推理时的表现。该事实不能证明关闭推理是任务或评分失败的原因，也不能证明开启后一定改善。任务模型与语义裁判均关闭了推理；后续若验证任务模型效果，不同时改变语义裁判，以免把评分变化当作能力变化。

## 2. 核查的实际证据

本次逐条读取真正发出的请求正文，不只检查示例配置：

- Agent：`.local/spatial-r11/batch-20261025/*/provider-*-wire-input.json`，共235份。
- 校准：从[校准索引](../../../../.local/spatial-r11/calibration-20261025/results.json)的 `records[].requestPath` 解析24份唯一原请求；相对路径以索引所在目录为起点。
- 整题评分：从[最终评分索引](../../../../.local/spatial-r11/grading-continuation-20261025-v5/results.json)解析64份唯一原请求，包含续评复用的旧请求；按实际路径去重，不把复用算重发。
- 返回版本：核对[共享账本](../../../../.local/spatial-r11/ledger.json)的 `requests[].usage.responseModel`，共323条。
- [Agent请求示例](../../../../.local/spatial-r11/batch-20261025/Q01-1-S0-N/provider-0001-wire-input.json)第2811—2813行含关闭推理参数；[评分配置](calibration-v2/judge-config.example.json)与实际请求相符。

为便于复查，按路径排序，将每份文件组合为 `仓库相对路径 + NUL + 文件SHA256 + 换行`，再对组合结果计算SHA256：

| 请求集合 | 清单摘要 |
| --- | --- |
| Agent 235份 | `0fbf4190d07f2b07293ddb7f14081b80fffacc76d8943f237e4d5c7b43281016` |
| 校准24份 | `4c1a16e0f9e74f68bf62ab77395c18a2d28f8d2499ad4e0c2ff6bc91fcc98e93` |
| 整题评分64份 | `3866deb44ef12557c70ea0e5f1e486e79a812df13d9c0064cc8392e4bd2cf29b` |

原始文件留在现有 `.local` 目录，不在本提交中复制上传；本文及原报告可随Git查看，逐条复查仍需对应本地证据。未读取或记录API Key。

## 3. 官方文档支持什么

截至核查日期：

- [Agent Plan套餐概览](https://console.volcengine.com/ark/region:cn-beijing/docs/agent-plan-personal-plan-overview)列出 `deepseek-v4.1-flash`。
- [Flash模型说明](https://console.volcengine.com/ark/region:cn-beijing/docs/deepseek-v4-1-flash)列出Chat API的 `reasoning_effort` 支持 `none / low / high / max`；`none`关闭思考，默认档位为high。模型专页还说明最大输出额度同时覆盖思考和回答，以及Agent后续请求需要回传实际思考内容。
- [Chat API说明](https://console.volcengine.com/ark/region:cn-beijing/docs/chat-api)说明 `thinking.type=enabled` 开启思考，`disabled`关闭；模型差异以模型专页为准。

由套餐可用模型与模型参数文档，可确认该Flash具备开启推理的文档支持。本次没有调用账户做开启验证，因此不宣称本项目适配器已验证兼容，也不宣称固定历史输入的模式切换已经成功。

若后续安排对照，应单独冻结推理开关、推理档位、实际请求、输出额度及返回版本。原8192输出上限不应未经考虑直接用于推理组；开启推理也不能自动改变Skill、题目或评分标准。
