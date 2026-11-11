# 第二轮设计依据

核对时间：2026-11-06；固定基线 `5e88ca8`。本次不修改产品代码，也不运行真实模型。以下源码路径均相对 `experiments/harness-lab/`。

## 已有约束与可复用能力

| 依据 | 事实与影响 |
| --- | --- |
| `.trellis/tasks/11-03-scenario-demo/design.md` 第 2/4 节 | 共享方案版本、人员决定、执行事实分别记录；后台只读显式共享方案；P3 接入现有持续机制，不复制聊天 |
| `.trellis/tasks/11-03-scenario-demo/implement.md:73` | P3 包括候选、比较、固定批准、后台读取/触发/版本保护；批准不出动车辆 |
| `.trellis/tasks/11-05-scenario-business-flow/design.md` 第 3/4 节 | 当前人工建任务只从成功逐条初析出发；双系统本期保持普通预处理，同来源不叠加持续处理 |
| `.trellis/tasks/11-05-scenario-business-flow/research/full-repeat-results.md:3` | 三轮完整物理复验已完成；E05 仍有漏判、未实际记录却自称已记录，不能当作模型通过 |
| `src/contracts/access.ts:1`、`src/access/store.ts:72` | 现有任务管理权和业务协作资格；导演不能参与业务；当前没有正式方案批准权 |
| `src/access/store.ts:179`、`:182`、`:206` | 任务创建/修改与持续任务输入同库事务；可复用事务与 task_revision，不把共享方案正文塞入任务 goal |
| `src/background/continuous-store.ts:41`、`:78`、`:95`、`:147` | 一来源一模式，已有队列/批次、requiredTaskIds、发布时任务版本核对及修订触发 |
| `src/background/continuous-service.ts:27`、`:39` | 持续工具为只读子集，固定 profile/epoch/受众；共同来源和上下文授权必须成立 |
| `src/web/TaskHome.tsx:11`、`src/web/main.tsx:492` | 任务说明/当前研判/任务内新建对话已有；新增方案入口可复用任务详情，无需重做综合页 |
| `.trellis/spec/backend/hitl.md:5` | 请求内操作确认不是持久业务批准；不能拿 work_item_action 或工具确认充当方案决定 |
| `src/scenario/scope.ts:21`、`src/access/store.ts:212` | 当前轮可写和结束门禁已有；方案写入必须复用同一真实归属，不能接收浏览器填写的轮次 |

## 两个必须显式解决的持续接入缺口

### 1. 人工建任务目前只认逐条初析

`src/background/task-links.ts:114` 的 creationJob 只查 `kind==='preprocess'`，`:265` 的 createFromSuggestion 沿用该任务判断/成功结果验证。持续结果是批次，SQL event/source 字段不能借用第一条事件，固定结果和来源授权也不同。仅打开持续配置不能保持现有新建任务流程。

建议：新增显式持续来源创建入口，绑定 `jobId + inputId + eventId`；复用现有 TaskSpace 创建事务及事件级唯一创建逻辑。旧 preprocess 回执保持原样，新入口使用独立判别字段，并在两个入口的共同事件级去重检查中读取新旧回执。详细方案见 design.md 第 8 节。

### 2. 当前通知携带的 subjectId 不是持续发现期待的身份

- `scripts/mock-context/scenarios/store.ts:117` 将 `subjectId` 设为 `notice.reportId`。
- `scripts/mock-context/scenarios/data.ts:78` 构造报告，报告自己的 `subjectId` 是实例步骤编号，而 `reportId` 为另一编号。
- `scripts/mock-context/scenarios/data.ts:82` 一部分道路通知经 situation 通道发送，引用的报告仍保存在 intel 中。
- `src/background/task-discovery.ts:68` 起，information 适配器按 subjectId 搜报告；situation 适配器按态势 objectId 定位。报告编号不能直接满足任一查法。

因此本稿不宣称“当前持续模式天然能解析这些通知”。建议新增可校验的报告证据定位，分开传输通道与业务报告身份；不解析正文补答案、不更改旧 subjectId 含义、不按名称反查。旧数据没有可信定位时保持未知；新演示定义显式升级通知协议。

## 有限条件核对的实际数据基础

- `scripts/mock-context/scenarios/data.ts:34`—`:38`：单车身份、车型、availability、position、来源修订、有效时间已经存在。
- `src/contracts/task-resources.ts:27`、`:54`：资源/车况/位置是分别声明的事实，`resourceFactActive` 按显式业务时点判断；可用声明不是现实出动认证。
- `scripts/mock-context/scenarios/data.ts:47`、`:72`：道路当前 `properties.passability` 有 open/closed/restricted，R01 封闭带有效区间；不是通用道路规则引擎。
- `scripts/mock-context/scenarios/data.ts:60`—`:65`：E08 更新 R01，E09 只追加旧报告、不更新当前道路对象。复核应查询当前对象，而不是按接收顺序复述消息。
- 没有通用行车时间或预设车组出动接口；不能从地图直线距离生成可靠 ETA，不能据 v4 来源模型声称所有出动条件都已具备。

## 迁移与边界

`src/access/database.ts:27`、`src/access/schema.ts:4`、`src/background/continuous-schema.ts:11`、`src/annotations/store.ts:14` 共同参与库版本识别；不能只改一个模块的版本白名单。方案记录应加入已有 collaboration.sqlite，复用短事务，不新增数据库或聊天证据仓库。精确迁移编号实施前按合并后的实际最新版本确定。

## UI 研究

使用 ui-ux-pro-max 的定向比较表检索，两次都只返回手机表格溢出建议，没有适用于本次桌面比较任务的有效匹配，因此不将该输出写入产品规范。交互依据现有 task/information 表格、固定研判版本、冲突保留草稿，以及技能的键盘、焦点、文本状态和错误反馈通用规则；不新增手机验收。

## 本次研究结论的限制

上述为静态代码/设计/既有测评记录核对，不是第二轮的工程或真实模型通过证据。方案服务、条件核对、持续创建入口、可信报告定位、权限及迁移均尚未实现。原分支继续发展时，实施前重新核对这些锚点和接入边界。

## 多筹划席分工与现有审核（2026-11-06 补充）

- `src/contracts/collaboration.ts:7` 的 WorkItem 使用 creatorSeatId/assigneeSeatId，没有筹划层级或 parentWorkItemId；Submission.review 保存实际验收人和决定。
- `src/collaboration/service.ts:184` 的 validateInput 校验：跨席分派在公共任务内，接收者须为有效业务席位；签收/提交只能由 assignee，review 只能由 creator 且针对 latestSubmissionId，退回须给理由。
- `src/collaboration/service.ts:315` 起提交只转 submitted；review accept 转 completed，return 转 returned。交付文件固定副本及确认卡均为既有能力。
- 因而 A 分工给 B/C 可形成两项独立作业，各由 A 验收；总体席不因其席位名称自动拥有这两项工作的 review 权。新增方案权限不能收窄或替代该既有关系；最终方案采用与作业验收是否合并属于 D02 产品决策，代码本身不能替用户决定。
