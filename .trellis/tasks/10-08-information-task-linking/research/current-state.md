# 当前实现依据与设计落点

核对日期：2026-10-09；基线提交 `5257aaa`。仅设计研究，无产品代码改动。

## 已有实现

- `experiments/harness-lab/src/contracts/background.ts`：Event、Job、Delivery 与 Action 已分离；作业已有完整 scope、requestId、原生结果引用。rule.publicTaskId 是旧显示归属，不表达多任务相关性。
- `experiments/harness-lab/src/background/store.ts:224`：finishJob 在 SQLite 事务内保存终态并产生待投递记录；恢复时 running→interrupted。可让新关联通过 succeeded 门槛有效，无需新 Run 状态。
- `experiments/harness-lab/src/background/service.ts:116`：canReadJob 仅检查 scope；不能当作新任务内容接口完整授权。allowedInbox 另校验席位、实际投递及来源条件。
- `experiments/harness-lab/src/background/service.ts:373`：analysisOptions 当前会 ensureWorkspace；若本期承诺只查看不创建目录，需要一并调整。
- `experiments/harness-lab/src/background/service.ts:382`：analyse 依赖 deliveryId，使用现有 action 幂等、固定导入计划、任务写准入、新会话及未发送草稿；task_information 入口需要复用后半段而非伪造投递。
- `experiments/harness-lab/src/background/service.ts:443`：执行人员后台任务时还会 allowedInbox；新 origin 必须贯穿入队和领取，不只改前端。
- `experiments/harness-lab/src/pi/background-runner.ts:43`：队列通过 BackgroundExecutor 驱动原生 Pi；新增关联写入可沿 publish 类似的宿主回调实现，Pi 层不直接操作数据库。
- `experiments/harness-lab/src/pi/context-tools.ts:16`：已有任务查询和服务／席位 principal，可记录本轮实际读取任务版本；新增工具仍用 defineTool，不改 SDK。
- `experiments/harness-lab/src/access/store.ts:79`：服务查询只读活动公共任务；公共任务管理复用 createPublicTask，个人空间 owner-only。
- `experiments/harness-lab/src/access/store.ts:101`：create 已校验公共任务权限，使用 task_actions 保证同用户 clientActionId 幂等；当前自行开启事务。新增“从建议创建并关联”应复用校验和事务内写入，不能先调用它提交后再假定关联写入原子完成。跨人员处理同一建议还需在对应 job 保存一份创建回执。
- `experiments/harness-lab/src/server/task-routes.ts:10`、`src/web/Tasks.tsx:24`：已有任务创建、结果查询及表单失败保留入口；新增建议可预填现有表单，无需引入另一套建任务审批流。
- `experiments/harness-lab/src/access/database.ts:26`、`access/store.ts:29`、`background/store.ts:70`：版本目前停在 schema 3；增加人员关联表不能只改一处启动检查。
- `experiments/harness-lab/src/web/Tasks.tsx`：当前主要是任务说明面板，不能假定已存在完整任务详情页。新增相关信息应接入 main 内容区并保留侧边栏。
- `experiments/harness-lab/src/web/Inbox.tsx`、`main.tsx`：已经有按收件分离的草稿、未发送准备和导航代次保护；抽取接续表单时必须保留。

## 设计理由

- 缺口是可查询的任务判断与人员接续：关联已有任务，或提出新建建议并由人员建立。沿用本次分析，不新增 router 模型、后台链式调度或 Pi 历史副本。
- 自动判断记录在对应 job，人工纠正放独立小表，使两者不会相互覆盖；正文继续以 Pi 原生结果为准。
- 任务是多人可见元数据，但信息权限独立。任务页展示引用不应自动扩大原信息和整份综合结果的可见范围。
- 上期语义偏差已记录于 `../09-23-multisource-context-analysis/research/validation-results.md`，本期验证自动关联质量时继续保留真实错误。

## 交互依据

沿用现有 UI 和用户“侧边栏保持、桌面使用、避免暴露实现细节”的要求。使用 ui-ux-pro-max 的导航状态、深链接、输入保留和渐进展示规则；未另行引入设计系统。对话上下文已包含本轮共识，无需再次检索历史会话或引入外部竞品假设。
