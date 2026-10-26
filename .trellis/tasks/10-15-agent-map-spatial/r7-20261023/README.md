# R7 方舟 Flash 小范围对照

仅12项，6题A/B各一次；当前集成基线af13107，B只改两份Skill正文，无C组，无自动加测。

从 experiments/harness-lab 执行：

```sh
mkdir -p ../../.local/spatial-r7
node --import tsx --env-file=.env.local ../../.trellis/tasks/10-15-agent-map-spatial/r7-20261023/live.ts run /Users/lau/.codex/worktrees/agent-result-grounding/berserk/.local/spatial-r7/batch-20261023 4540
```

必须使用全新输出目录。env只允许Agent Plan专属地址与deepseek-v4.1-flash；不打印Key。无官网或普通后付费地址回退。Agent Plan入口仍不能证明账单套餐实际抵扣，须控制台核对。

每次模型HTTP保存Pi原始input和实际wire-input。两组同样仅将thinking设disabled；这是评测传输适配，不修改产品，也不声称产品原生方舟完整兼容。output上限8192，context1048576；请求实际返回model仅允许请求别名与已连通性核实的deepseek-v4-1-flash-261017。强制redirect:error；失败后即使SDK试图重试也在下一次外发之前拒绝。

每批预算180次模型请求/2M输入/100k输出token，启动下一题前预留24请求/300k输入/10k输出；保守估计用于阻止接新题，不是费用金额或套餐消费承诺。单题24请求/64工具/10分钟只警告；正在推进的题允许完成。失败、未知用量、错误响应model或源码漂移停止进一步付费调用，原记录保留。无自动重试、无第二轮。resume只跳过已开始项且要求同日同代码、完整用量；不恢复失败项。

离线：node --import tsx --test ../../.trellis/tasks/10-15-agent-map-spatial/r7-20261023/*.test.ts
类型：node_modules/.bin/tsc -p ../../.trellis/tasks/10-15-agent-map-spatial/r7-20261023/tsconfig.json --noEmit

cases与真值、rubric不会进入模型工作区。实际正文逐回合核对，整个可见过程单独审阅。输出统计交root结合全量原始证据；本批不能证明90%正式验收或自动读取有效。
