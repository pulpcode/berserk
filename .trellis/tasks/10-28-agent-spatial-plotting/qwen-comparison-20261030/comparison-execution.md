# 六次对照：执行说明

## 已完成的离线验证

2026-10-30。`comparison.test.ts` 3项测试通过，其中包含全部6个隔离原生流程、20次模拟续跑响应、12次历史调用回放。真实模型请求0。任务TypeScript与ESLint通过。

完整离线证据：`/var/folders/td/741qp46d52b2b8_2zdzj7ps40000gn/T/qwen-compare-xzoDPN/batch`。

- 六个现场均与旧第3次输入逐项比较：公开消息与24工具schema一致，仅映射任务/工作区/会话/草稿/来源实例身份、createdAt、queriedAt、changeCursor。每项保存restoration.json。
- 两次历史助手工具调用由评测器重放，实际业务工具通过原生Pi/HTTP执行；其模拟usage不计为新模型请求。新旧思考明确区分。
- 草稿真实计算得到4个内部点；来源两点真实计算得到1个内部、1个外部点。来源业务日期、几何与成员关系保留。
- 结构化AskUser和普通文字追问均用固定回复继续完成。普通终态始终等待主会话复核，不用关键词直接评分。
- 草稿及来源状态前后深相等。新思考按原字段回传；两模型参数分别校验。

准备中曾保留参数mock错误、普通用户content数组断言错误和代码冻结漂移等离线失败；都没有真实模型请求，也不算模型失败。最终通过证据单列。早期探针第一尝试因沙箱无法启动本地服务停止，后续获准启动隔离localhost完成。

## 执行命令

从 `experiments/harness-lab` 执行。先建本轮 `records/` 目录，文件用绝对路径；不要把授权/运行记录放本轮顶层，顶层TS/JSON参与代码冻结。

```sh
node --import tsx <本轮目录>/comparison.ts freeze <本轮目录>/records/comparison-freeze.json
```

读取冻结文件的freezeHash，创建`records/comparison-authorization.json`：

```json
{"approvedByUser":true,"freezeHash":"实际冻结哈希","limits":{"requests":64,"input":2000000,"output":200000}}
```

再执行：

```sh
node --import tsx <本轮目录>/comparison.ts live <仓库>/.local/qwen-comparison-20261030/comparison <本轮目录>/records/comparison-authorization.json
```

直接读取既有两份本地Key配置，无需复制或打印。共享预算已扣冒烟4次/1516输入/181输出。自动重试关闭；已有目录、已有冻结claim、未知用量、HTTP失败、漂移或预算不足都会停止，保留原记录。完成中的正常答错仍允许复核后进入下一项；不自动补题。

## 主会话如何处理复核门

进程会写`pending.json`，其中给出`decisionPath`及证据路径，保持原生会话存活。先读证据，再一次性写该决策文件。不要更改已存在决策。

- 终态确已回答：`{"checkpointHash":"pending中的hash","reviewer":"Codex root","reason":"具体判断依据","action":"advance"}`。这只表示流程结束，不等于业务评分通过。
- 确实追问来源：同样字段，`action:"reply",replyId:"declared-choice"`，实际发送冻结回复“按当前会话草稿的港区和资源层。”。
- AskUser：核对interaction证据，只允许来源问题；单问题同上replyId，多问题必须逐项核对并提供`answers:[{"questionId":"原ID","replyId":"declared-choice"}]`。未知问题不猜答，保持hold。
- 尚需复核：`action:"hold"`，后续只在新`.next`决策文件继续，不将等待超时当批准。

每项`review.json`包含完整原生snapshot、事件、交互、草稿状态和sourceAfter；使用已冻结`comparison-review-rules.md`判分。原始请求与思考仅保留.local，公开报告不复制思考正文。

## 范围与限制

原始公开探索路径来自历史Flash，续跑模型接手同一已形成的现场；不代表从零任务或自动Skill读取。产品代码仍未修改。Docker当前未启动，因此文件执行不可用且不会退回宿主；本题实际地图/来源/空间工具不依赖Docker，主工具schema与历史一致。若模型选择环境不可用的文件执行路径，保留真实错误，不替换工具成功响应。

复用G1子Agent工具仍可调用；子请求同一模型和总预算，记录实际子工具schema，不把它误判为主会话24工具schema漂移。没有为模型预设应使用子Agent。
