# 运行说明

本目录是新评测器，旧轮驱动和原始记录保持不变。以下真实运行必须等产品离线检查、题包/预算与评分校准通过后执行；不自动循环或重试。

在仓库根目录使用 Node 24：

```sh
node --import ./experiments/harness-lab/node_modules/tsx/dist/loader.mjs .trellis/tasks/11-03-resource-scope-model-comparison/run.ts prepare <新的绝对批次目录>
node --import ./experiments/harness-lab/node_modules/tsx/dist/loader.mjs .trellis/tasks/11-03-resource-scope-model-comparison/run.ts run <批次目录> P01-A-1 <Flash本地env绝对路径> --browser
```

prepare无模型请求：复制当前工作区产品到独立快照、构建Web、冻结依赖及驱动、创建A/B独立账本。快照注明HEAD和workingTreeSnapshot，不能宣称含未提交改动的快照等于HEAD。两模型共用同一份业务产品快照。

执行前写批次readiness.json：`{"reviewer":"实际审阅人","offlinePassed":true,"materialsReviewed":true}`。不得预先填通过。按schedule.json逐项运行；四项公开结束且流程可信后再写public-gate.json，包含approved、reviewer、四个实际trials ID。每项完成须写该题continuation-review.json，注明reviewer、rationale、continuationAllowed、trajectoryAuditable；实际状态改变时还须isolatedEffectsVerified。这些是流程放行，不是业务分数。

程序遇到实际交互或正常终答会打印review_required及审阅文件路径；审阅完整证据后，在指定decisionPath写带相同evidenceHash的Decision：

```json
{
  "evidenceHash": "从实际审阅请求复制",
  "kind": "clarify",
  "reviewer": "审阅者",
  "rationale": "解释实际问题与冻结事实的对应",
  "evidenceId": "实际observed.id",
  "matches": [
    {"factId":"本题冻结事实ID","quote":"实际问题原句","questionId":"实际问题ID"}
  ]
}
```

普通文本不填questionId；API按每个问题填写映射，可选optionIds但必须是实际选项。多问需全部匹配，不能仅回答一问。已完成错误答案用final推进并保留失败；未完成用incomplete，未知问题用fixture_gap，不编回复。progress审阅只有确认仍有进展才continue。

输出记录放批次目录或任务checks/records子目录。不得写入冻结根目录TS/JSON/协议文档。实际工具/模型变更后不可沿旧协议继续；不支持自动恢复中断题或换模型。

A组保留原生Flash请求字节。B组仍使用同一Pi公开推理序列化，按历史已验证方法只转换wire中的模型标识、enabled/xhigh/preserve_thinking及输出字段，并转往百炼端点；保存native与wire两份请求。工具、业务上下文与公开消息不改写。此为评测适配，不是已把Qwen设为产品原生支持或上线默认模型。必须核对工具调用后的reasoning_content回传离线证据。

官方价格由主会话于2026-11-03核对：[Qwen3.8-Max](https://help.aliyun.com/zh/model-studio/qwen3-8-max)，北京输入12元/百万、输出36元/百万。每组400万输入＋50万输出上限，不计缓存优惠为66元，低于100元现金上限。思考包含在输出usage，不另加一次；该估算不是实际账单。方舟不增加余额页面登录门槛。

最终用comparisonSummary分别聚合A/B每组12槽；其中modelScoreThresholdMet仅代表分数门槛，还必须核对T01—T08工具回归通过、四项公开流程可信、正式执行不存在未解决的流程缺口，才可提议独立验收。每题usage与groupUsage分别保留单题及组累计用量；skill-read-evidence保存实际成功接收正文的消息证据，不能把仅调用算作已读取。旧scoring中的历史工具门槛函数只用于勘误，不能把旧N系列16槽直接套入本批。
