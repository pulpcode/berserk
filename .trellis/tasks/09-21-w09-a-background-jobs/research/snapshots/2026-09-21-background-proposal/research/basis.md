# W09-A 实现依据

核对日期：2026-09-21。仓库基线：`255fd61`。本记录是代码与资料审阅，不是新增功能的测试结果。

## 1. 当前代码与缺口

代码路径相对 `experiments/harness-lab/`。

| 基础 | 已存在 | 本期缺口 |
| --- | --- | --- |
| `src/pi/lab.ts` | AgentSession、原生历史、工具、压缩、停止、恢复投影、single 只读委派 | 后台服务执行范围、无人在线触发、启动前持久化尝试；不复制 Agent 循环 |
| `src/pi/controlled-stream.ts` | 统一模型调用、用量及空闲超时，普通回复／压缩均接入 | 前后台／父子共享并发，等待可取消，排队不误触发超时 |
| `src/collaboration/service.ts` | SQLite、工作／提交／固定文件、幂等操作及业务回执 | 同事务内部事件，新增事件／作业／结果／接收记录，固定文件来源扩展 |
| `src/workspaces/store.ts` | schema v2，taskSpaceId × seatId 唯一，工作区名称与会话绑定 | 后台独立目录；可供分析的项目目标说明和授权目录 |
| `src/contracts/collaboration.ts` | WorkItem 的 title、goal、state，Submission 及确认操作 | 自动结果和任务关系独立表达；不改成所有作业必须提交验收 |
| `src/server/seat-scope.ts`、`app.ts` | 测试席位、范围检查及 Host／Origin 限制 | 来源和管理凭证；服务读／交付范围，不借测试席位模拟后台身份 |
| `src/web/main.tsx`、`WorkspaceNavigation.tsx`、`WorkInbox.tsx` | 对话、动态、正式工作待办、独立草稿 | 信息与结果入口、后台进度和独立管理导航 |

`PiLab.start()` 先在内存保留活动标记，首条资源记录在异步准备后保存。后台应在调用它前登记尝试，覆盖启动空隙；不据此要求全量前台 Run 表。

Pi 0.85.1 的公开 `SessionManager.create(cwd, sessionDir, options)` 支持 `NewSessionOptions.id`。宿主可预分配 sessionId，内部入口需接收预分配 requestId；实际故障边界仍需验证。

现有固定交接文件需关联 WorkAction，业务主体是席位。本期为普通事件／结果扩展文件来源和下载授权，不伪造业务操作或迁移所有 WorkItem 主体。协作使用同连接 SQLite 事务，事件应随成功动作同事务写入。

项目空间没有完整任务描述模型；现有 WorkItem 有目标，但不能把每个项目等同于一条 WorkItem。任务查询需聚合当前标识与明确提供的描述，目录维护方及资料开放范围仍待审。

`tests/pi/recovery.test.ts`、`tests/pi/collaboration.test.ts`、`tests/collaboration/crash.test.ts` 的进程故障和文件核对方式可复用；其已有结果不等于新队列已通过验收。

## 2. Hermes 借鉴范围

已查阅官方资料与公开源码；以下是可借鉴的具体机制，不代表直接引入 Hermes。

| 依据 | 可确认的机制与取舍 |
| --- | --- |
| [kanban_decompose.py](https://github.com/NousResearch/hermes-agent/blob/main/hermes_cli/kanban_decompose.py) | 将任务标题／正文和角色描述交给辅助 LLM，支持选择角色及拆解；单任务也可选择承办角色。Axon 借鉴按职责选 Agent，不直接引入其 DAG |
| [Kanban 文档](https://hermes-agent.nousresearch.com/docs/user-guide/features/kanban) | 任务、执行尝试和后台执行可观察；Axon 区分技术作业与正式业务 WorkItem，不照搬为同一种任务卡 |
| [webhook.py](https://github.com/NousResearch/hermes-agent/blob/main/gateway/platforms/webhook.py)、[Webhooks 文档](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/webhooks) | 配置路由、来源鉴别、工具范围及无需模型的直接送达可借鉴；该适配器用内存去重缓存和异步任务，不能据此宣称具有 Axon 所需的持久化接收队列 |
| [Web Dashboard 文档](https://hermes-agent.nousresearch.com/docs/user-guide/features/web-dashboard)、[Dashboard 源码](https://github.com/NousResearch/hermes-agent/tree/main/plugins/kanban/dashboard) | 借鉴状态列表、执行详情和操作反馈；工作台与管理台继续使用 Axon 的 React／TypeScript 组件 |

上述 decomposer 读取任务字段和角色清单；Axon 的来源历史／任务资料查询是本项目明确的上下文需求，不是该辅助调用已自动提供的能力。其未知角色回退也不能证明业务分流正确，Axon 应显式处理无法判断和越界结果。

持久化事件总线、任务关联、席位交付权限及 Pi 集成由 Axon 实现。Hermes 的 Webhook、LLM 选择和后台调度分别承担不同职责，不能称为一套直接可移植的总线。技术路线仍是 TypeScript／Node、React、SQLite 与 Pi，不引入 Hermes 的 Python 运行时。

仓库 [LICENSE](https://github.com/NousResearch/hermes-agent/blob/main/LICENSE) 为 MIT。当前仅参考设计，未复制代码；如实施时复制组件，需固定 commit 并核对组件与依赖许可证。

## 3. 实施验证点

- 受控服务目录／资源能复用 Pi、文件工具、Agents 和 Docker，旧席位历史保持兼容。
- 来源及任务查询只返回获准范围，实际读取内容可留存，结果交付不能因关联任务而扩权。
- 普通回复、文件交付、动态结果登记均可映射回原生历史；无固定格式正文也能保存成果。
- 数据库事务与原生历史分离时，完整证据支持只补发布，证据不足保持中断；结果登记不能提前送达。
- 模型并发为 1 时前后台、压缩和父子调用均可前进，取消清理排队者。
- 两类不同目标使用同一执行机制；不因特情样例把“先摘要、再关联、再复核”写死。

若验证发现与已审边界冲突，先记录缺口和影响，再调整方案。
