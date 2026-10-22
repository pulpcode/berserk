# R3 真实模型测试启动前检查（2026-10-22）

## 结论

本轮 live runner 通过启动前工程检查，可以在最终 contract、README 定稿并冻结后启动已授权的 144 个新测试槽位。本次检查没有调用真实模型，也不构成模型正确率验收。

检查范围是新增 `r3-20261022/live-budget.ts`、`live-provider.ts`、`live.ts`、`live.test.ts` 及其与既有 R3 fixture、评分、隔离机制的衔接。产品源码、既有题目与冻结 Skill 正文未改；检查期间由实现者完成修正后交接，审查者没有再修改 runner 源码。

## 审阅中已修正并复核的事项

- Provider 参数或工具 schema 漂移在实际 transport 之前停止，并留下明确的 `provider_input_protocol_failure`，不能被 SDK 重试转成额外付费调用。
- HTTP/流错误保留原始主要失败原因，usage 缺失另外标记；请求账本保存实际端点 origin 和 pathname，不保存认证请求头。
- 缓存 token 的负数不能通过加总掩盖；prompt_tokens 存在时不再重复累计缓存 token。
- D16 从当前用户请求的真实原生历史读取 draft 返回，解析目标 ref；不再依赖没有该数据的 SSE UI 元信息，也不依赖 SSE 消费与下一次 provider 调用的先后竞态。
- 增加新 live 入口的 D12、D13、D14 和 D04 实际 HTTP 交互检查，区分回答、跳过、取消和先确认仍待答后清理；没有填入默认答案。
- 活跃题目跨午夜时记录实际时间差并完成当前题，下一题因日期变化停止；没有用普通题内耗时警戒线截断任务。

## 已验证的行为

预算在开始下一题前检查：总计划为 900 请求、1500 万输入 token、20 万输出 token，下一题预留 48 请求、50 万输入和 2 万输出。单题 24 请求、64 工具及 10 分钟仅提示；假 provider 连续完成 26 个请求，未因警戒线取消。HTTP 错误发生后下一次 provider 调用被阻断，未知 usage 阻止继续开启新题。

每题使用新会话和数据目录；明确选择与原生按需加载仍分开记录，实际 provider 输入、工具 schema、资源加载、原生消息及最终数据效果均保留。恢复已完成的同批槽位没有新增调用；中断或已开始的槽位不自动重跑。

D11 实际提交预定文本，D12 实际跳过且没有答案，D13 取消后没有答案，D14 和 D04 核验 pending 后清理且没有答案。D16 的双轮假模型实际完成 buffer → 读取 draft → 外部更新 → 保存遭 CAS 冲突 → 重读 → 保存原 resultRef，最终保留外部备注，保存几何与原预览一致。

源码、隔离 runtime 和候选哈希在执行中检查；没有向模型提供 truth 或评分结果。所有结果仍标记语义待审，没有以调用工具或 HTTP 完成代替正确性通过。

## 验证命令与结果

在 `experiments/harness-lab` 目录执行：

```sh
node --import tsx --test ../../.trellis/tasks/10-15-agent-map-spatial/r3-20261022/live.test.ts
./node_modules/.bin/tsc --noEmit -p ../../.trellis/tasks/10-15-agent-map-spatial/r3-20261022/tsconfig.json
```

- 新 live 测试：6/6 通过，0 失败、取消或跳过，总耗时约 27.0 秒；全部使用假 provider。
- TypeScript：通过，退出码 0。

在仓库根目录执行：

```sh
./experiments/harness-lab/node_modules/.bin/eslint --max-warnings 0 --config experiments/harness-lab/eslint.config.js .trellis/tasks/10-15-agent-map-spatial/r3-20261022/*.ts
git diff --check
```

- ESLint：通过，零警告，退出码 0；从根目录运行避免 task 文件被错误忽略。
- 差异格式：通过。
- 既有 R3 的 18 项确定性检查、产品 57 项相关检查沿用前次已通过记录，本轮未改这些实现，没有重复运行。此前记录见 `r3-check-20261022.md`。

## 未修复事项与实际边界

没有遗留启动阻断。以下是验收边界，不是工程检查已证明的模型能力：

- 本次只证明执行与留证通路；144 个槽位的真实模型表现仍需逐条语义审阅，不能据假测试推出准确率。
- D16 的模型若提前重读而避免陈旧写入，或者读写在同一模型输出中完成，实际冲突覆盖可能不足。必须分别报告是否注入、是否真的遭遇冲突，以及任务是否正确；不能强迫错误或自动补跑。
- `AGENT_RUN_TIMEOUT_MS=0` 使活跃题目没有宿主总时限；provider 的 60 秒请求超时仍保留。该参数与旧轮次不同，横向解释结果时应说明。
- 真正发生跨日时应结合开始、结束和 provider 时间记录说明，不能声称所有题目时间条件相同。
- 根代理将在启动前完成说明文档状态更新，再由 runner 生成冻结记录；测试后的真实失败、额度未知或证据异常仍应按协议停止并保留，不自动重试。
