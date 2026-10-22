# R5：八项主动读取冒烟

只执行D02、D05、D16、N01各L0/L1一轮；A/B是内部兼容标签，报告使用L0/L1。冻结范围、判断规则见[review-rubric.md](review-rubric.md)。业务产品并行开发不进入本批运行时：runtime.ts用git archive从b56de82提取完整产品，只给L1覆盖候选资源工具文件，且严格断言该文件仅含参数候选和空目录分支改动。

复用R3真实HTTP/Pi驱动、provider记录、预算核算、交互处理与独立夹具；保留R3/R4文件原样。live-provider.ts是冻结provider记录器的薄适配，只允许skill_read.id的A/B差异，并检查每次实际请求中的候选名称/简介。其他工具schema完全相同。Skill正文不在schema中，仍按原路径读取。

从experiments/harness-lab运行离线检查：

```sh
node --import tsx --test ../../.trellis/tasks/10-15-agent-map-spatial/r5-20261022/smoke.test.ts ../../.trellis/tasks/10-15-agent-map-spatial/r5-20261022/clarification.test.ts
./node_modules/.bin/tsc -p ../../.trellis/tasks/10-15-agent-map-spatial/r5-20261022/tsconfig.json
```

主会话在检查通过后执行授权live.ts run，证据必须放新的绝对.local/spatial-r5目录。从未开始的条目才允许resume；已开始条目不自动重试，冻结输入改变或用量不完整则拒绝继续。预算120请求、200万输入token、4万输出token；每项开始前预留24请求/30万输入/1万输出。24请求/64工具/10分钟只是提示，正在正常推进的任务允许完成，可能超出题间预算并如实报告。模型固定deepseek-v4-pro、thinking disabled、max output4096。禁止自动追加后续12项。

summarize.mjs复用原语义score/summarize，只接受匹配原始review.json哈希的逐项复核；主动读取指标必须另外依据真实provider输入逐项核实，不由成功终态推导。候选正文与clarification文件仅供离线后续准备，不被8项runtime装载。
