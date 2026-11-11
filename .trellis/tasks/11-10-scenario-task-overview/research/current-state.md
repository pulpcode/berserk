# P5 现状核对

2026-11-10 · 只读代码核对；未运行测试

基线为codex/scenario-demo当前工作树，HEAD为b2b9438；既有未提交issue索引、地图关注范围方案和发布记录不属于本任务。本方案仅新增规划资料，并建立与场景父任务的关系。

| 事实 | 依据（相对experiments/harness-lab） |
| --- | --- |
| 首页已有goal/context、研判插槽、控制席指令、新建对话；尚无工作摘要 | `src/web/TaskHome.tsx:32` |
| 三个任务页签、相关信息与地图已存在 | `src/web/TaskInformation.tsx:51` |
| 持续研判有本任务current列表、固定版本、依据、历史和私有讨论 | `src/web/ContinuousAssessments.tsx:55`；`src/server/continuous-routes.ts:26` |
| 普通来报的分析是独立记录；不能当作已发布持续研判 | `src/contracts/task-information.ts`；`src/server/task-information-routes.ts:24` |
| 任务相关信息列表按receivedAt排序，不表示最新观测事实 | `src/background/task-links.ts:219` |
| 工作台可按taskId读取；总览需独立viewWorkOverview授权且仅返回概要 | `src/contracts/workbench.ts`；`src/workbench/service.ts:59` |
| 工作详情含固定输入附件、各次提交、审核决定、hash和私有会话引用；不能借任务首页公开这些字段 | `src/contracts/collaboration.ts:6`；`src/server/collaboration-routes.ts:14` |
| 指令authorize要求canIssueCommands，owned另核对原下达seatId；读接口并非全任务共享 | `src/commands/service.ts:93`；`src/commands/service.ts:108`；`src/server/command-routes.ts` |
| 来源对象已有executionState和executionCommandId；来源外部执行查询已有完整逐车事实，首页尚无获准的跨席任务摘要 | `src/contracts/context.ts:43`；`src/contracts/commands.ts`；`.trellis/spec/backend/commands.md` |
| 来源读取从taskId取得可信归属并接受固定readId；不能把客户端自报轮次作为授权依据 | `src/server/context-routes.ts:32` |

## 复用与新增判断

复用：任务字段、任务关联信息、持续研判发布机制、工作与文档审核、固定附件、指令核查、来源态势、场景隔离及加载/详情组件。

明确缺口：跨席业务进展不能直接调用现有控制席指令读接口；需一个严格限于来源执行事实的任务只读摘要。工作概要可复用既有权限和接口，文件则只能走参与者原详情授权。无需新的方案/流程实体或数据库。

页面示意：`/Users/lau/.codex/visualizations/2026/11/03/01a1a1a1-0479-7922-96ef-02555ca5f212/task-home-preview.html`。示例数据仅帮助讨论；文档行、完整指令跳转和跨席工作可见性均按本方案收敛。
