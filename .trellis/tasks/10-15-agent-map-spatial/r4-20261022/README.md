# R4：Skill接入的12项A/B冒烟

本轮授权、固定题单、预算和判分见[执行记录](../r4-smoke-execution-20261022.md)。本目录仅是任务内诊断，不是产品新框架；`live.ts`沿用R3已验证的串行HTTP/Pi运行和留证流程，改为固定12项、A/B宿主差异、新预算与关键副作用停止检查。直接复用R3的provider记录器、用量解析、Skill送达检查、交互决策、夹具和冲突注入，不修改R3冻结文件。

从`experiments/harness-lab`运行离线检查：

```sh
node --import tsx --test ../../.trellis/tasks/10-15-agent-map-spatial/r4-20261022/smoke.test.ts
./node_modules/.bin/tsc -p ../../.trellis/tasks/10-15-agent-map-spatial/r4-20261022/tsconfig.json
```

只有在离线检查通过后，使用已有环境配置运行`live.ts run <新的绝对.local/spatial-r4/目录> 4550`。不重用旧目录，不覆盖原始证据，不自动重试。完整原始请求保存在gitignored目录；报告、逐项评分、哈希和用量摘要纳入任务文件。暂不进行正文试验或正式90%验收。
