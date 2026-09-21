# 实现依据

核对日期：2026-09-21。代码基线：`683cd37`。本记录为设计研究，不是本期功能测试结果。

## 当前能力与需要补齐的部分

路径相对仓库根；行号对应上述基线。

| 代码依据 | 已有行为及本期影响 |
| --- | --- |
| `experiments/harness-lab/src/pi/lab.ts:723` | start 同步保留活动请求，但在内存中；后台需要先持久登记队列和领取结果，覆盖 Pi 准备前退出的空隙 |
| `experiments/harness-lab/src/server/app.ts` 的 messages 路由 | SSE 断开仅停止向网页写事件，已接受处理仍继续；本期不能把“关闭网页仍运行”误称为从零新增的能力 |
| `experiments/harness-lab/src/pi/lab.ts:450`、`:639`、`:746` | 创建 AgentSession、只读子调用和执行收尾可复用；资源、文件、交接工具当前绑定席位，需明确服务执行范围，不能只换一个 seatId |
| `experiments/harness-lab/src/pi/controlled-stream.ts:26` | 回复和摘要统一经过流控制，用量在调用前累计；新增并发许可应先等名额再计次数／启动空闲计时，不能把许可包在整个父请求外层 |
| `experiments/harness-lab/src/pi/lab.ts:898` | 人工交互等待在当前请求内存中；后台本期选择结束并交人接手，不把它包装为跨重启持久化等待 |
| `experiments/harness-lab/src/files/service.ts:39`、`:224`；`src/pi/file-tools.ts:36` | 文件安全操作及固定下载可复用，但归属与会话校验绑定 WorkspaceStore；服务预处理需独立归属适配，人员分析继续使用本席位目录 |
| `experiments/harness-lab/src/execution/docker.ts:103`、`:121` | Docker 启动清理本实例遗留容器，接受宿主指定的目录及请求 ID；后台沿用这些边界 |
| `experiments/harness-lab/src/access/database.ts`、`src/access/store.ts:32` | 已有同库 SQLite、schema v2 的账号与任务；适合小规模队列、规则及投递事务，需要显式升级版本并增加来源范围内的查看／管理权限 |
| `experiments/harness-lab/src/access/store.ts:103`、`src/server/task-routes.ts` | 归档目前只检查内存写入计数和未完成 WorkItem；必须补查 queued 席位分析与准备中的导入，重启后也不能遗漏 |
| `experiments/harness-lab/src/contracts/access.ts` | 当前只有公共任务创建和模型设置管理能力；信息中心的账号／席位来源权限是本期新增，不借用旧权限 |
| `experiments/harness-lab/src/server/auth.ts` | 当前全部业务 API 受 Cookie／CSRF 保护；来源接口必须独立、精确鉴权，不能简单放宽全局检查 |
| `experiments/harness-lab/src/web/main.tsx`、`Seats.tsx` | 已有对话／动态／待办切换、身份卸载与迟到响应隔离；收件与信息处理中心复用这些基础，不恢复任意切换席位 |

已核对锁定安装包 `@earendil-works/pi-coding-agent@0.85.1` 的 `dist/core/session-manager.d.ts`：`NewSessionOptions.id` 与 `SessionManager.create(cwd, sessionDir, options)` 可预分配原生会话 ID。仍需在 P2 验证文件写入和重启边界，类型声明本身不是故障验收。

## 复用和自建的区分

- Pi 提供会话、Agent 工具循环、原生历史与压缩。后台接收队列、基础规则、来源鉴权、分席位投递和 Web 页面是 Axon 的宿主适配。
- 当前没有服务身份下可直接复用的完整入口；需要小范围拆出公共执行代码，不能声称只增加一个定时器即可完成。
- 现有交接文件与业务动作有关联；自动结果独立保存，不能为了拿到下载能力而伪造 WorkItem／Submission。
- 两种独立存储的中断处理采用“保留内容、明确中断”，本期不自动推断并补发成功，也不复制整套聊天内容。

## 讨论与交互依据

[父任务原研究](../../09-21-w09-a-background-jobs/research/snapshots/2026-09-21-background-proposal/research/basis.md) 保留 Hermes 官方 Webhook、Kanban、Dashboard 来源。本期只继承来源配置、后台状态和执行详情的参考方向，不引入 Hermes 运行时，也不把其实现等同于持久化总线；未复制第三方代码。

产品范围依据父任务已确认的三阶段拆分及当前需求。Hermes 最新实现不是本期接口依据，因此没有为本次文档另行拉取源码或声称完成版本复核。

页面沿用 Axon 现有组件，结合 `ui-ux-pro-max` 对导航位置、详情 URL、操作反馈和渐进展示的检查；不新增设计系统、手机页面或视觉重构。

## 本次讨论确定的设计依据

- 流程为预处理后投递一个／多个席位，正式分析由人员确认发起。不是要求两个 Agent 无人确认自动级联；普通对话和后台分析共用 Pi，分别保留各自交互边界。
- “信息处理中心”本期建设，只有获授权账号／席位可进入；查看与管理分开，规则页纳入基础维护。普通席位有独立收件入口。
- 原生会话并不决定文件必须每次重建。服务预处理每作业隔离；同一任务的席位分析保留自己的工作目录。文件生命周期与容器生命周期分开。

此前讨论核对过的主来源：

| 资料 | 借鉴范围 |
| --- | --- |
| [Docker bind mounts](https://docs.docker.com/engine/storage/bind-mounts/) | 宿主目录挂载到容器；本仓库 Docker 已按此方式提供 /workspace，容器退出不要求删除任务文件 |
| [Anthropic 长期 Agent Harness](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) | 用持久文件与进度接续工作；不把其示例当作“每次执行必须新目录”的规定 |
| [EventBridge rules](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rules.html) | 条件与目标分离、一条规则可多目标；本期只借鉴表达，不引入 AWS 服务或任意编排 |

以上仅为设计参考，不证明 Axon 已实现或通过验收。来源范围、规则版本、站内投递和人工确认语义由本期需求定义。

## 实施时首先验证

1. 使用独立目录仍能复用 Pi 文件／资源／Agents，并且旧席位路径检查不被放宽。
2. 模型许可覆盖回复、摘要和子调用，父子共享单名额仍能前进；重试退避不占名额。
3. 接收、取消、结果提交、分席位投递及导入在各持久化边界中断时，不重复执行工具、重复收件或覆盖既有文件。
4. queued 席位分析的会话预留、归档校验和身份复核不依赖浏览器登录继续有效；原生工具范围与后台模式说明一致。
5. 信息中心展示前后关联，但其权限不能读取另一席位的私有分析内容。

验证不足时如实保留未知结果，不用额外提示词掩盖权限或存储实现缺口。
