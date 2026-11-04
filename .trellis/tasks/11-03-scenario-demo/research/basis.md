# 场景草案的仓库依据

基线：main@278d82fb8b21dd7dbfadbc9430173cb321e6acc3；2026-11-03只读核对。

## 已有能力与本轮取舍

- experiments/harness-lab/scripts/mock-context/README.md：外部模拟来源维护事实，Axon经HTTP读取；保存事实与发送通知分开。地图实例的既有重置限制不能被新场景绕过。
- .trellis/spec/backend/situation-map.md：共用地图、来源时效与权限、模拟控制及来源修订已有契约。当前对象更新侧重道路属性和车辆数量，新的单体车辆位置/执行回报需要后续明确设计。
- .trellis/spec/backend/task-resources.md 与 experiments/harness-lab/src/contracts/task-resources.ts：已有单体/汇总、实际/计划位置、可用性证据与时间、任务关系和身份关联；应优先复用。细分车型是否需要新的受控字段，内容确认后再设计。
- .trellis/tasks/09-23-multisource-context-analysis/research/simulation-scenario.md：早期场景已使用无关任务、时间变化和来源延迟；本轮扩展为更丰富的背景世界，保留作者预期不进入来源输入的约定。
- .trellis/tasks/10-10-task-plan-validation/prd.md：已有两席位文件方案与退回修订验证；不能将这种交接完成视为模拟行动已执行。
- docs/mvp/prd.md：真实/模拟调度与资源占用曾明确后延；本轮只拟故事，后续建设执行功能时需显式收敛其范围。

## 当前授权与阶段

用户要求独立分支/worktree并先拟场景故事。本轮在新任务目录写出PRD、story.md、world.md；不启动产品实现，不修改既有场景和主工作区。具体故事、六站二十四车及事件节奏为初稿供审阅，不把此前助手建议视为已获批准的功能清单。

main已推进到278d82f，因此新分支从这一最新本地main建立，包含之前4711adc的空间/资源及持续研判整合，以及后续工作待办布局变更。原主工作区现有未跟踪部署资料留在原处。

## 建设计划追加依据（2026-11-03）

| 已核对位置 | 现状与对计划的影响 |
| --- | --- |
| src/contracts/access.ts:23（均位于experiments/harness-lab下） | TaskContext仅有业务引用与关注范围；不能声称已有共享方案引用/读取 |
| src/web/TaskHome.tsx:29 | 任务说明、当前研判插槽、新对话入口已有；P5丰富此入口 |
| .trellis/spec/backend/continuous-analysis.md:25、37 | 后台共享输入限公共任务元数据与获准来源，不能读取私有席位方案；P3补受控共享版本及触发/版本复核 |
| src/contracts/collaboration.ts:4 | WorkState为分派/办理/提交/退回/完成；没有车辆调派、占用或到场状态，P4不能复用其完成语义 |
| scripts/mock-context/persistence.ts:4与server.ts:42 | 现有模拟服务持久化场景快照；本期复用，完整管理域拆分记入issue |
| .trellis/spec/backend/task-resource-query.md | 默认任务资源发现不等于扫描所有可读数据；六站检索范围在P1显式定义 |
| .trellis/tasks/11-03-resource-scope-model-comparison/main-merge-status.md | 合并工程检查不等于模型验收；前台语义限制仍在 |
| .trellis/tasks/10-26-continuous-background-analysis/main-merge-status.md | 后台语义和长期运行尚未过生产验收；P6单独核验本场景 |

范围扩展：本轮按用户要求形成总体建设提案，仍未启动产品代码。此前“只拟故事”的首步已完成，后续阶段等待本轮计划审阅。资料中的短路径仅为定位方便，上表src/scripts均相对experiments/harness-lab。
