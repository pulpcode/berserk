# Research: W01-8 设计席位边界复核

- Query: 复核 PRD/design 的双测试席位、单服务/API 路径、跨席位文件授权、会话绑定与旧数据兼容，查找最少必需缺口。
- Scope: internal
- Date: 2026-09-19

## Findings

总体方向与现有代码边界相符。无需新增角色管理、登录 token、多个运行实例、Pi JSONL 迁移或索引 v3。建议只补以下三处明确约束；第二项属于边界取舍，不能宣称用户已经单独批准跨项目复制规则。

### 1. 会话业务绑定应在空闲时进行

- 设计依据：`design.md:48` 允许显式绑定已有无关联会话，`:50` 在每轮开始装入关联工作摘要，`:148` 新增绑定 API；尚未说明会话已经运行时能否绑定。
- 已有代码：`experiments/harness-lab/src/pi/lab.ts:625` 的 start 在同步区检查并设置活动请求，然后异步准备资源；原 workspace 绑定是固定的。
- 缺口：若运行中的原无关联会话被绑定，当前模型上下文与工具读取到的工作关联可能不一致。
- 最小补充：`绑定仅在本席位会话无活动请求时执行；活动中返回 409。绑定与 start 的检查在同一进程内协调；新一轮捕获已绑定 workItemId，后续工具沿用该关联。` 不引入锁住整工作区的策略。

### 2. 导入文件的目标工作区需明确任务范围

- 设计依据：`design.md:146` 目前只写自己的 workspaceId；`:150` 笼统说明复核任务、会话、文件关系。
- 已有代码：`src/files/service.ts:44` 通过受控 workspace 派生文件根；`src/workspaces/store.ts:22` 维护 taskSpaceId×seatId 唯一映射。
- 最小建议：`交接文件导入该 WorkItem 同 taskSpaceId 的当前席位工作区；Agent 使用当前会话已固定的 workspaceId，不接受目标席位或任意工作区覆盖。` 页面目标也按同一条件检查。
- 这是收窄本期明确交接范围的建议。如果主设计希望“用户可将已获授权文件导入自己任意项目”，应写明为产品选择；不能留给实现自行解释。无论哪种选择，都不得扩大到对方私有目录。

### 3. 给会话关联一个明确读回位置

- 设计依据：`design.md:48` 支持同工作多段会话，`:129` 要显示可点击工作标题，`:147`、`:148` 只有新建/写绑定接口，没有明确刷新时从何处读取关联。
- 已有代码：`src/pi/lab.ts:264`、`:297` 生成会话摘要/快照，目前仅持有 workspaceId；浏览器主要通过这些投影恢复会话状态。
- 最小补充选择：SessionSnapshot 增可选 workItemId；WorkItem 详情返回**当前席位**已关联会话 ID（或等效的本席位查询过滤）。不需要另建 GET 绑定接口。
- 返回关联时不包含另一席位的会话 ID、标题、原文。不会改写 Pi 原生消息或让对方聊天进入模型上下文。

### 已覆盖、无需增加设计的部分

- `design.md:29`—`:38`：单服务、单 PiLab/WorkspaceStore，固定白名单测试路径；下载 href、XHR、SSE 都捕获席位；全量启动加载按工作区原席位校验。
- `design.md:31`—`:34`：旧 LAB_SEAT_ID 保留，未配置测试模式时旧 API 可用，测试模式拒绝私有无前缀路径；明确测试身份非真实认证。
- `design.md:36`、`:40`：tab/席位缓存独立，运行不随切席改变，模型设置共享并等待全服务空闲。
- `design.md:46`、`:145`：接收方同任务独立目录，源 AGENTS/历史不复制；未提交副本只准备方可看，正式文件经工作/提交授权读取。
- `design.md:154`—`:158`：索引 v2、workspace/session/taskSpace ID 和 JSONL 保留；使用备份副本验证兼容，不通过删除新记录回退。

## Files Found

- `.trellis/tasks/09-19-w01-8-task-handoff/prd.md`：K01/K04/K08/K11 及测试身份范围。
- `.trellis/tasks/09-19-w01-8-task-handoff/design.md`：当前待审方案，复核重点为第 1—3、8—10 节。
- `.trellis/tasks/09-19-w01-8-task-handoff/research/seat-boundary.md`：前序现状研究和所有授权入口。
- `experiments/harness-lab/src/pi/lab.ts`：同步请求占用、会话摘要/快照、固定资源上下文。
- `experiments/harness-lab/src/workspaces/store.ts`：持久工作区与席位/任务归属。
- `experiments/harness-lab/src/files/service.ts`：受控文件根与归属检查。

## Related Specs

- `.trellis/spec/backend/harness-lab.md`：同步 reserve、会话归属固定、每轮资源快照、原生历史。
- `.trellis/spec/backend/files-execution.md`：文件路径范围、席位归属、安全复制。
- `.trellis/spec/backend/hitl.md`：调用参数、身份和请求边界不由浏览器/模型改写。

## External References / Versions

无新增外部资料。依据当前仓库锁定的 Pi 0.85.1 与现有宿主实现，不要求修改 Pi。

## Caveats / Not Found

- 仅设计复核，未修改主设计或产品代码，未执行测试、访问服务器或读取密钥。
- 本报告引用的是复核时文件行号；主设计随后吸收建议时可能发生偏移。
- 存储事务、业务幂等和 HITL 准备单来源的详细复核由其他研究范围负责，此处未重复扩展。
