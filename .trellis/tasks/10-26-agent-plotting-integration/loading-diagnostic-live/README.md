# 可授权的 Skill 加载诊断入口

本目录将已审阅的6题、24槽排期接入正式 HTTP → 原生 Pi → 工具/服务和受预算约束的 provider。默认仅准备数据；离线受控验收可执行整个路径；真实模型调用必须另行授权。源码和离线通过都不是授权。

## 固定范围与复用

- 题目和交错排期直接读取 `../loading-diagnostic/cases.ts`，不复制或改写题干。每题2轮A/B，共24槽。证据中保留所有槽，未执行不能删除。
- A不显式选Skill；B从真实资源目录取得 `map-annotations` id/hash，每条用户消息（包括允许的澄清续轮）均通过现有 `skill` 字段选择。不改正文，不伪造 Skill 读取消息。
- A/B业务文档配对逐字段核对，只归一化夹具随机来源资源ID。原始manifest、fixture、原始身份均保留。工具schema全批相同；模型消息、用户请求、真实原生和wire输入及Skill正文送达审计均保存。
- 复用 v3 的运行时复制/结束语/窄代答，v2 的题目夹具、Provider、Ledger持久化和关键效果检查。只有T1可使用冻结车型澄清答案；T2已明确车型，不自动回答多余澄清。R1仅运行C10的预览轮，不偷偷追加保存轮。
- T1/T2/S1允许题目要求的新增对象；R1/R2/S2要求整个地图状态不变；所有题要求来源系统状态不变。来源变化、越界对象/发布/采用/现有对象损坏等关键错误停止整批。工具执行成功并不自动证明所有用户要求完成。

## 预算与停止

本批硬上限 **120次实际provider请求 / 4,000,000输入tokens / 200,000输出tokens**。新的Ledger适配器在请求前检查低额度，并在实际用量结算后再次核对；不改v2。保持每请求UTF-8请求字节数+4096的保守输入预留及32768输出预留。

每个A/B配对开始前沿用36请求、1,000,000输入、65,536输出的保守预留；它可能令批次在达到硬额度前停止，不能据此删除未执行槽或自动补跑。实际超额、未知用量、provider失败、模型漂移、源码变化和基础设施失败停止，保留证据。没有自动重试/恢复/换模型入口。

模型参数与v2一致，实际返回型号必须通过既有Provider校验。真实调用需要人工核实提供商当前额度和计费方式，不能从离线模拟型号推断线上可用性。

## 冻结与授权

冻结覆盖本目录、loading-diagnostic、v3及其实际v2/历史辅助依赖、产品源码/锁文件，以及 [判定协议](../loading-diagnostic-protocol-20261028.md) 的SHA-256。题目/预期/评分协议不会被复制到Agent运行时。

从 `experiments/harness-lab` 执行，输出文件/目录必须不存在：

```sh
node --import tsx ../../.trellis/tasks/10-26-agent-plotting-integration/loading-diagnostic-live/run.ts freeze /tmp/plotting-loading-live-freeze.json
node --import tsx ../../.trellis/tasks/10-26-agent-plotting-integration/loading-diagnostic-live/run.ts prepare /tmp/plotting-loading-live-prepare
```

真实授权JSON必须包含：`approvedByUser: true`、`providerAllowanceVerified: true`、真实核对后的非空 `billingNote`、当前冻结文件的 `freezeHash`、精确 `limits` 和精确 `scope`（取冻结文件的 `source.scope`）。不得仅因字段需要就将审批/额度核实设为true。scope固定24槽、题干、排期与加载条件，其他范围会被拒绝。

授权完成后才能使用：

```sh
node --import tsx ../../.trellis/tasks/10-26-agent-plotting-integration/loading-diagnostic-live/run.ts live /ABS/REPO/.local/agent-plotting-integration/NEW_BATCH /ABS/AUTHORIZATION.json 5285
```

实际仓库路径由运行时校验，不能写到其他目录。每个freezeHash使用一次性claim，换输出目录也不能重复调用。失败claim保留，不能自动删除后重跑。默认本机端口5285，仅独立测试数据，不连接4324试用库。

## 结果与验收

轮次定义沿用 [v3说明](../evaluation-v3/README.md)。`recorded`、宿主`succeeded`、Skill送达都不等于语义通过；每槽`semanticReview: pending`。`scoring.ts`复用既有Review字段，严格语义判定独立于协议status；按A/B各12槽汇总，同时保留未执行/未复核/待输入清单，不自动给出整合通过或因果结论。逐题原则与采纳条件以冻结判定协议为准。

离线命令：

```sh
node --import tsx --test --test-concurrency=1 ../../.trellis/tasks/10-26-agent-plotting-integration/loading-diagnostic-live/*.test.ts
node_modules/.bin/tsc --noEmit -p ../../.trellis/tasks/10-26-agent-plotting-integration/loading-diagnostic-live/tsconfig.json
node_modules/.bin/eslint --config eslint.config.js ../../.trellis/tasks/10-26-agent-plotting-integration/loading-diagnostic-live/*.ts
```

执行时不要修改任何冻结源文件，不与别人占用5285端口。受控测试实际创建对象、澄清接续、生成预览并读取结果；仅证明驱动和保护接通，不能作为真实模型业务能力成绩。检查和证据见 [就绪记录](../verification/recurring-errors-20261028/live-readiness-checks.md)。

## 2026-10-28 用户明确豁免额度核对

用户在批准真实批次后明确要求“不核对额度，直接进行测试”。授权记录可使用 `providerAllowanceVerified: false` 和 `providerAllowanceCheckWaivedByUser: true`，并在 `billingNote` 记录原话及未核实事实；不得伪造额度已核实。预算、模型、scope/freeze、一次性claim和停止条件继续生效。这只改变启动核对条件，不改变题目或模型可见上下文。
