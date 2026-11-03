# R9 固定B版本重复性验证

仅D17、D02、D23各三次，共九个独立native会话；按轮交错。产品、R7、R8不变，B两正文严格匹配c95b3d3。复用原数据、参数、评分与工具，不添加提示，不强制读取Skill。

从experiments/harness-lab执行：

```sh
mkdir -p ../../.local/spatial-r9
node --import tsx --env-file=.env.local ../../.trellis/tasks/10-15-agent-map-spatial/r9-20261023/live.ts run /Users/lau/.codex/worktrees/agent-result-grounding/berserk/.local/spatial-r9/batch-20261023 4560
```

目录必须全新。额度保护仍180请求/2M输入/100k输出，题间余量24/300k/10k；当前题允许完成，故障与未知用量停止，不自动重试、不追加。方舟专属端点、Flash、thinking disabled wire适配、8192输出上限均复用R7。sourceFreeze包含R9本身、R8/R7及依赖、正文、评分，不容许中途换协议。

离线：node --import tsx --test ../../.trellis/tasks/10-15-agent-map-spatial/r9-20261023/*.test.ts
