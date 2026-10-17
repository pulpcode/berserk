# 上轮记录合并与本轮规划边界

2026-10-17，按用户“先把本轮测评记录合并到main并push”执行。

- 合并前：main=1282d46；codex/map-read-evidence=8cab905；远端main=3064bc6，工作区干净。
- 执行：fetch远端main，确认差异只在旧任务目录；切换main；`git merge --ff-only codex/map-read-evidence`。
- 推送：`git push origin main:main`，远端从3064bc6更新至8cab905。
- `git ls-remote origin refs/heads/main`确认：`8cab905b3f14a201e7b8dadce5a651f115be8cde`。
- 合入的是审计方案及实验记录两个提交1282d46、8cab905。产品候选没有启用，补丁只是归档文本；未改线上服务。
- 其他工作树/分支未合并，原实验分支未删除。

随后创建本任务并编写下一轮prd/design/implement；状态保持planning，未task start、未新模型外发。此次规划文档在本地，未包含在上述已完成的push中。

## 本轮方案依据

1. `experiments/harness-lab/scripts/probe-map-query-cases.ts`：prepareCase、queryCaseLayers提供原G02-order题目与真实初始化。
2. `experiments/harness-lab/scripts/probe-desktop-map.ts`：seedLayers、collaboration中的B01/B02原话和引用流程。
3. `experiments/harness-lab/scripts/probe-source-annotations.ts`：ask只有text入参，mapState提供独立前后状态；不假定现有ask已支持annotationRefs。
4. `experiments/harness-lab/src/server/app.ts:165`：消息HTTP入口已有annotationRefs解析与投递。
5. `experiments/harness-lab/src/pi/annotation-tools.ts:19`：按名称发现layerId的方法已经在实际工具说明里。
6. `experiments/harness-lab/src/pi/lab.ts:670`、`controlled-stream.ts`：原生Agent重试与provider重试不是同一层，预算需统计真实外发。
7. 上轮原G02-order-3-A的第一次provider输入：没有图层ID映射；两次请求工具schema相同；第一次回执已提供storage及实际范围。定位困难不能简单归为“工具没写说明”。

未运行新测试；仅核对源码、旧证据与计划一致性。
