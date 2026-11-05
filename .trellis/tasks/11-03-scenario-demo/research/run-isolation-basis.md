# 轮次隔离方案现状依据

核对日期：2026-11-05；代码基线`8cf300c`，当前HEAD`649195f`仅追加验收文档。只读核对，未查询或修改线上业务数据。

| 事实 | 代码位置（仓库根目录起） | 对方案的约束 |
| --- | --- | --- |
| 消息和作业DTO没有统一场景归属字段 | `experiments/harness-lab/src/contracts/background.ts:63`、`:73` | 不能仅靠对象编号隔离后台执行 |
| 接收按来源及消息编号去重，接收时选择规则或持续配置 | `experiments/harness-lab/src/background/service.ts:245` | 归属须进入受信任接收链路；晚到消息不能按当下活动轮或配置错绑 |
| 普通作业建立独立session/request | `experiments/harness-lab/src/background/service.ts:241` | 复用原作业机制增加绑定，不自建Agent执行框架 |
| 事件列表当前按来源授权过滤 | `experiments/harness-lab/src/background/service.ts:427` | 需要额外按轮过滤，详情与操作也必须一致 |
| 场景单活动指针且激活后冻结旧轮 | `experiments/harness-lab/scripts/mock-context/scenarios/store.ts:31`、`:76` | 本期沿用冻结/只读语义，不新增历史恢复；未来执行能力另行建设 |
| 当前来源查询从完整引用/游标选轮，缺省回退活动轮 | `experiments/harness-lab/scripts/mock-context/scenarios/query.ts:29` | Agent请求必须显式由宿主固定轮次，不能只依赖全局活动指针 |
| 当前激活要求无queued/running后台作业并归档旧任务 | `experiments/harness-lab/src/server/scenario-routes.ts:118`、`:123` | 中途重新演示需按轮收束作业并只读封存未完成业务，不能绕过通用归档检查 |
| 任务映射和激活回执已独立持久化 | `experiments/harness-lab/src/server/scenario-tasks.ts:80`、`:84`、`:91` | 扩展现有准备/启用操作的回执核对，不建设历史轮次执行恢复或通用事务平台 |
| 工具宿主已有权限principal；结果直接进入原生工具历史 | `experiments/harness-lab/src/contracts/context.ts:6`、`experiments/harness-lab/src/pi/context-tools.ts:16`、`:30` | 适合在宿主绑定归属；不能保证所有技术编号完全不进入LLM |
| Web已有按席位捕获的统一请求客户端，登录版本与CSRF由认证机制校验 | `experiments/harness-lab/src/web/api.ts:64`、`experiments/harness-lab/src/server/auth.ts:55` | 这是现状事实，不构成采用隐藏上下文机制的决定；无来源请求如何获得归属待SIM-TASK-002，登录身份版本不等于演示版本 |
| 任务候选当前为全部可见活动任务，服务身份可列全部活动公共任务 | `experiments/harness-lab/src/context/task-query.ts:88`、`:108` | task_search/read、持续候选发现与覆盖检查都需同轮约束 |
| 持续配置时期拥有自己的会话，按sourceId选择订阅 | `experiments/harness-lab/src/contracts/continuous.ts:12`、`experiments/harness-lab/src/background/continuous-store.ts:25`、`:75` | epoch是配置时期，不能等同演示轮次；需同时限定 |
| 持续基线按epoch/task保存，覆盖检查读取全部活动公共任务 | `experiments/harness-lab/src/background/continuous-store.ts:63`、`:85` | 换轮后基线、任务候选及任务修订触发必须使用一致范围 |
| 当前详情只投影最近20条通知/操作 | `experiments/harness-lab/scripts/mock-context/scenarios/store.ts:46` | 迁移不能仅依赖该投影，应核对完整持久化记录 |

既有约束还包括：Pi原生历史与取消/恢复、业务席工作区权限、导演业务隔离、场景/真实时间区分、请求幂等、未知回执保留、旧场景定义不兼容时只读。方案不把正文提示词或编号前缀当作权限/归属证明。

本次上下文已有完整讨论及本期范围调整要求，未额外使用`trellis mem`重复检索历史。方案只为待审阅的后续建设，不修改现行spec或M1已批准设计。

2026-11-05范围修订：历史轮次继续/恢复/重新执行移出本期，优先级较低。本期聚焦完整执行或中途中断后结束A、新建B，以及消息和Agent上下文隔离；不建设挂起状态或历史恢复接口。现状证据不变。

同日补充产品约束：轮次只在导演台及后台体现；业务席不显示、填写或选择。随后用户明确暂不采用“后台下发页面隐藏上下文、客户端自动携带、正式部署关闭适配”的提议，归属方式已记SIM-TASK-002待解决。现有客户端代码只作为事实依据，不能作为实施该提议的授权；本次不提出替代方案。
