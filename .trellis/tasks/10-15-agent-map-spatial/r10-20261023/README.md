# R10 固定B版24项扩大诊断

仅测评代码，产品与Skill不变；B严格匹配c95b3d3，native自动按需加载。24独立会话，每项一次；不重试、不追加。精确题干与独立真值在cases.ts，评分在review-rubric.md，故障原始证据与实际状态保留。

T15使用真实mock不可用开关；T16在源HTTP返回中只删除西区资源geometry，原始/有效数据分别记录；T19用正式模拟更新接口把availableCount4改1；T22读草稿后真实外部修改；T23实际提交后阻断方法返回，原native工具负责未知回执提示，原receipt可真实回查。测试宿主补丁仅单个隔离实例，不改产品源码。

从experiments/harness-lab执行：

```sh
mkdir -p ../../.local/spatial-r10
node --import tsx --env-file=.env.local ../../.trellis/tasks/10-15-agent-map-spatial/r10-20261023/live.ts run /Users/lau/.codex/worktrees/agent-result-grounding/berserk/.local/spatial-r10/batch-20261023 4570
```

全新目录。预算480请求/8M输入/250k输出，开始下题预留24/300k/10k；不是预计资费。当前题允许完成；失败/未知usage/版本漂移停止后续外发，保留原记录。只允许方舟Agent Plan端点、指定Flash及已核实响应型号；复用thinking disabled评测传输适配，原/实际wire正文留存，拒绝重定向。

源码与本批授权、评分冻结后方可真实运行。离线检查只用模拟模型输出执行真实本地HTTP/工具/保存/源故障，不计模型正确率。
