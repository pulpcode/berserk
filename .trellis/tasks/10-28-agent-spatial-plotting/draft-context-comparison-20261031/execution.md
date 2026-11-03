# 执行说明

方案由 approval.md 批准。产品与原题不变；本轮运行入口 run.ts，固定端口 5412。旧轮只读。

## 离线检查

从 experiments/harness-lab 运行：

```sh
node --import tsx --test ../../.trellis/tasks/10-28-agent-spatial-plotting/draft-context-comparison-20261031/*.test.ts
./node_modules/.bin/tsc --noEmit -p ../../.trellis/tasks/10-28-agent-spatial-plotting/draft-context-comparison-20261031/tsconfig.json
```

从仓库根运行：

```sh
experiments/harness-lab/node_modules/.bin/eslint --config experiments/harness-lab/eslint.config.js .trellis/tasks/10-28-agent-spatial-plotting/draft-context-comparison-20261031/*.ts
```

受控 provider 仅用于流程检查，不计模型成绩。离线启动需要本地网络权限。运行中的冻结检查覆盖本轮顶层文件，因此执行检查期间不能改这些文件。检查结果写 records/。

## 冻结与真实执行

从 experiments/harness-lab 运行 `node --import tsx ../../.trellis/tasks/10-28-agent-spatial-plotting/draft-context-comparison-20261031/run.ts freeze <新的绝对路径 freeze.json>`。

将其中 freezeHash 与 limits 原样写入授权 JSON：`{"approvedByUser":true,"freezeHash":"实际哈希","limits":{"requests":192,"input":6000000,"output":400000}}`。此操作记录现有用户授权，不扩大预算。

执行 `node --import tsx ../../.trellis/tasks/10-28-agent-spatial-plotting/draft-context-comparison-20261031/run.ts live <新的绝对路径批次目录> <授权 JSON 绝对路径>`。环境从既有 SOURCE_EVAL_ENV_FILE 或旧轮既定 .env.local 读取，只允许 Agent Plan Flash。禁止打印 Key。

没有失败重试或恢复重跑命令。一个冻结版本只能申请一次 live 批次；进程在 pending.json 等待语义决定时仍在运行，不是失败重启。中断后保留原始证据，停止并报告。

## 执行中的复核

pending.json 给出 evidencePath、decisionPath、checkpointHash。执行 Agent 阅读实际问题和轨迹后，向新的 decisionPath 排他写入 Decision：`checkpointHash`、`reviewer`、`reason` 与 `action`（finish/reply/fail_task/stop）。普通来源问题 reply 携带 selection.axes；AskUser 则逐 questionId 提供 answers。固定答复来自原 oracle，不提前告知模型。

首 4 项结束后 kind=process_gate；核验上下文差异、记录完整性、工具能力和接续规则后写 action=finish 继续剩余 28 项。业务回答错误不是流程失败。每项最终完成/不完整均留 review.json，语义分数后续单独复核。

本轮 -native.json 是原生请求，-wire.json 是实际发出内容，-context-audit.json 记录原生 composer 依据和确切变化。原始本地记录包含私有思考，仅脱敏公开轨迹用于提交。结果、公开轨迹和评分写入子目录，不能改变冻结的顶层代码/文档。
