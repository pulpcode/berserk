# 加载条件对照：离线请求准备

此目录只提供正式 HTTP/Pi 请求入口的离线预演，验证 A/B 输入、Skill 送达和真实只读工具往返。**没有 live runner，不能直接执行 24 槽真实模型对照，也不代表模型错误已经修复。**

## 固定批次

| 题目 | 复用数据 | 对照目的 |
|---|---|---|
| T1 / T2 | C02 | 原模糊类型题 / 明确水罐消防车的正例 |
| R1 / R2 | C10 | 原筛选读取题 / 完整草稿读取正例 |
| S1 / S2 | C01 | 原目录归属题 / 明确只说明当前系统目录归属的正例 |

每题 2 轮，每轮 A/B 各一次，共 24 槽。第 1 轮 A→B，第 2 轮 B→A。

- A：原生按需 Skill 机制，不显式选择 Skill。
- B：从正式资源目录读取当前 `map-annotations` 的 id/hash，通过 `/api/sessions/:id/messages` 的 `skill` 字段显式选择。正文保持原样，由现有机制进入上下文；没有伪造 `skill_read`。
- 相同题目和轮次的用户文本、业务文档、工具 schema、模型请求参数相同。`pairing.json` 保留完整业务文档，仅将每次初始化生成的来源资源 ID 统一为 `fixture-source-resource` 后逐字段比较。会话、工作区、任务、集合 ID 与创建/更新时间属于独立运行元数据，不作业务一致性依据，原值保存在 manifest/fixture 中。
- 请求使用现有 `actualPayload`；保持 `deepseek-v4.1-flash`、关闭 thinking、不额外设置 temperature。本轮响应模型名来自模拟响应，不能证明线上模型可用性或版本。

## 运行

从仓库根目录切入 `experiments/harness-lab` 后运行（输出目录必须是新目录且不能在本源码目录内）：

```sh
node --import tsx ../../.trellis/tasks/10-26-agent-plotting-integration/loading-diagnostic/prepare.ts prepare /tmp/plotting-loading-review
node --import tsx --test ../../.trellis/tasks/10-26-agent-plotting-integration/loading-diagnostic/prepare.test.ts
```

需要能绑定本地端口 5283；此端口仅用于独立测试实例。`live` 等其他模式在创建实例前拒绝。无外部网络发送：目标模型端点被替换为固定 mock，其余 fetch 只允许 loopback。

每槽固定两次模拟 provider 响应：第一次调用真实 `annotation_read`（R1 筛选原点，其他题读取完整草稿），第二次结束预演。因此 **48 synthetic 请求仅验证 24 槽加载/读取链路，不是完成了 24 项用户任务**。T/S 的放置、修改、保存没有执行，R1 的空间分析也没有执行；语义判定一律 `not_applicable`。前后草稿必须完全不变。

## 留存证据

`protocol.json` 保存排期、源码/依赖复用指纹与预算建议；各槽保存真实输入、资源目录、原始/转换后 provider payload、Skill 正文可见性审计、配对文档、SSE、会话快照、真实工具结果及原生 session 文件。运行前后校验源码未变。失败产物保留，禁止覆盖已有目录。正式开始前的运行时启动失败可能只留下 `started`，不能当作通过；只有完整 `summary.json` 才说明预演完成。

## 真实对照尚缺什么

本批次只完成输入准备，下一轮仍须实现并审阅以下接入，然后取得真实调用授权：

1. 将现有 provider/ledger 的预算保护接到本排期，执行 **120 requests / 4,000,000 input tokens / 200,000 output tokens** 的新上限、每请求预留、实际用量计账、超限即停。当前 `proposedLimits` 仅记录建议，**不是 live 已实施限额，也不是调用授权**；不能直接沿用 v2 的其他额度。
2. 接入真实多轮工具执行和题目允许的澄清续轮，按每题定义副作用边界与结束条件；当前固定 mock 不能用于真实能力打分。
3. 固定判分规则，记录实际响应模型版本、用量、停止原因和每项结论的工具证据；验证目标线上版本，不自动切换模型。复用既有评测设施，不复制另一套通用驱动。
4. 确认 24 槽正文/工具/配对初态不变后执行真实对照，再分离判断“加载差异”与“业务正确率”；离线通过不支持任何能力提升结论。
