# 现状依据与并行改动边界

记录日期：2026-10-09。稳定代码基线：`4fd95651101f68f5e9a5f396b06db12099452a7b`。

## 1. 隔离事实

- 主工作区：`/Users/lau/workspace/berserk`，当前分支 main，存在其他任务的未提交实现。
- 本次 worktree：`/Users/lau/.codex/worktrees/work-inbox-overview-design/berserk`。
- 本次分支：`codex/work-inbox-overview-design`，从 main 已提交 HEAD 创建，不含 main 未提交改动。
- 本次仅写入 `.trellis/tasks/10-09-work-inbox-overview/`；不改共享父任务文档，不启动任务实施，不更改 main 的任务指针、代码、运行环境或数据库。
- Git 对象与分支目录是 worktree 的正常共享元数据；主工作目录、索引与当前分支保持独立。

## 2. 稳定基线证据

下列位置相对于本 worktree，行号基于上述提交；实施时应重新核对。

| 事实 | 代码依据 |
| --- | --- |
| 四入口并列；会话与待办仍有部分本地视图切换 | `src/web/main.tsx:55`、`:210`、`:316`（下文 src 均指 experiments/harness-lab/src） |
| 待我办理用承办者且非 completed 筛选，会包括 submitted | `src/web/WorkInbox.tsx:168`、`:177` |
| 交接只允许发起人／承办人读取，不能直接用于总体跨席位阅读 | `src/collaboration/service.ts:129`、`:132`、`:139` |
| 发起人验收，承办人签收／提交，聊天不直接修改工作状态 | `src/collaboration/service.ts:177`；`.trellis/spec/backend/task-handoff.md` |
| 收件依据 delivered + 当前席位，读取时校验资料范围 | `src/background/service.ts:310`、`:318`、`:322` |
| 投递有 pending/delivered/failed，无人员处理状态 | `src/contracts/background.ts:58`、`:82` |
| 同一作业同一接收席位投递唯一 | `src/background/store.ts:95`，`UNIQUE(job_id,seat_id)` |
| 动态只读当前席位会话，可投影待回答、待确认、失败与恢复提示 | `src/pi/lab.ts:486`；`src/web/WorkspaceNavigation.tsx:6`、`:33`、`:122` |
| 已有全局 activity 轮询、草稿、未读成功回复标记 | `src/web/useChat.ts`；`.trellis/spec/frontend/harness-lab.md:23` |
| 来源管理、资料权限、任务可见和收件资格为不同限制 | `.trellis/spec/backend/background-execution.md`、`task-information.md`、`task-access.md` |
| 正式 API 已有登录、CSRF、身份版本防护 | `src/server/auth.ts`、`src/web/api.ts` |

## 3. main 在途改动：只读观察，不作为已交付事实

观察时 main HEAD 仍是 `4fd9565`。另一任务正在改动席位职责、补充投递建议与总体席审批，包括：

- 席位目录增加 `responsibility`、`responsibilityRevision`，管理脚本维护职责。
- 信息能力增加 `deliveryReviewSeatId`、`canReviewDeliveries`、`pendingDeliveryReviews`。
- 新增 `DeliveryReviews.tsx` 与 `/api/information/delivery-reviews` 列表、详情、决定路由。
- 信息中心加入待批准投递入口，收件加入“为何收到”。
- 数据库、AccessStore、BackgroundStore 和校验脚本支持其新增数据；当时实现正在引入 schema v5。

相关已提交设计：[席位需求](../../10-09-analysis-seat-routing/prd.md)、[设计](../../10-09-analysis-seat-routing/design.md)。这些文档中的“未编码”状态文字与正在进行的实现可能不同步，本方案不以其状态文字断言功能已上线。

不复制或套用在途 diff；实施前读取最终提交。审批适配为可选：不存在时正常省略，存在但读取失败时报告失败。职责目录仍沿用最终版本，不在本方案新增一套四席位硬编码。

## 4. 两个需要新增能力的具体原因

1. 既有 delivered、分析成功和会话未读都无法表达“本席位人员已完成处理”，因此提出每个投递一份最小处理记录；不建设通用待办数据库。
2. 原交接详情严格限双方，总体读取跨席位进度没有现成权限。因此提出独立的只读摘要能力，默认关闭；不放宽原详情和文件路由。

## 5. 设计方法

使用 ui-ux-pro-max 的导航层级、状态保留和渐进展示指引，保留现有 React、Lucide 与视觉规范。本地定向查询 `state preservation navigation --domain ux` 返回 Active State、Deep Linking，适用于本次入口重组；没有据此引入新的视觉风格或框架。

所有新增接口及状态均为待审方案，不是已存在实现。后续验证命令从本仓库 package.json 读取，未在本轮声称执行产品测试。
