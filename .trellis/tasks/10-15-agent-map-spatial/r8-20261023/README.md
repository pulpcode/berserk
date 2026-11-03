# R8 原生自动读取对照（固定版本）

相同 R7 六题、相同数据/模型/参数、相同 A/B 两组各一次，共12项。A=af13107；B=两份Skill精确匹配c95b3d3；仅加载方式改为native，首次请求不预加载正文、不显式选择。目录正常存在，后续读取与正文暴露全部留存，不以读取本身判任务通过。多回合允许沿用此前真实已读正文。

复用R7夹具、预算、传输适配、评分口径。R7历史文件与产品保持不变。180请求/2M输入/100k输出，题间预留24/300k/10k，正在推进题允许完成；故障、未知用量保留并停止，不重试、不追加。thinking disabled是同一评测传输适配，原始/实际发送payload均留存。

从experiments/harness-lab执行：

```sh
mkdir -p ../../.local/spatial-r8
node --import tsx --env-file=.env.local ../../.trellis/tasks/10-15-agent-map-spatial/r8-20261023/live.ts run /Users/lau/.codex/worktrees/agent-result-grounding/berserk/.local/spatial-r8/batch-20261023 4550
```

输出目录必须全新。原始证据须与R7分列，先比较R8 A/B，再对同题同版本的R7显式结果作描述性比较。读取率、实际body进入后再计算的时序、任务完成、过程与最终解释各自报告。一次小样本不代表统计显著、90%验收或稳定自动读取效果。

离线：node --import tsx --test ../../.trellis/tasks/10-15-agent-map-spatial/r8-20261023/*.test.ts
