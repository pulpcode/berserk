# 导演台运行时实施记录（阶段成果，未用户验收）

## 已实现

- `src/contracts/director.ts` 定义 `DirectorState`、`DirectorSwitchInput`、`DebugState`；导演 API 路径为 `/api/simulation/director`、`director/switch`、`director/operations/:id` 与 `instances/:id/debug/*`。
- 保留 `ScenarioStore` 原活动指针作为唯一事实；自由调试使用新 schemaVersion 4、`operationMode: free_debug`、`definitionId: free-debug` 的 run-* 快照，复用版本化预置事实，每轮独立，不复制旧活动数据。没有开场任务或自动通知。
- 新 `.director-transition.json` 仅持久化跨系统操作和稳定子操作 UUID。具体缺口是旧 activation 回执不能表示切回场景选择后的空活动指针。读取或重启不执行切换；pending 时关闭相关 admission，由原操作者同请求显式重试。
- 切换依次关闭旧写入、暂停、等待后台/前台停止和写入 admission 排空、核对不确定通知、按旧规则归档可归档任务、冻结旧轮清空活动指针。自由调试再初始化新轮；切回场景仅进入选择状态。
- 调试保存要求 URL instanceId、run revision、对象/报告 revision；报告不得引入其他轮次引用或改变原主题。保存产生 unsent action；发送另需当前 instanceId/run revision。冻结历史可读取，旧轮不可编辑或投放。调试执行指令显式拒绝，避免写入不兼容执行快照。
- `ScenarioScope.modeFor` 从可信源快照解析 scenario/free_debug，供来源权限与规则分流；不由浏览器指定入站模式。
- 旧宿主无轮次写 API 返回 410，旧 source-manage 授权不再能操作导演台；source scenarios-enabled 模式亦拒绝旧 HTTP/socket 写入。

## 调用方核查与处置

- CLI `mock-context/control.ts` 仅保留 status/requests，旧 reset/advance/event/unavailable 明确停用；源端 socket 在统一导演模式同步拒绝旧写命令。
- `probe-agent-framework.ts` 与 `probe-source-annotations.ts` 属于旧 Orchard map-* 真实模型业务验收脚本，依赖固定西区/车辆池/09:20 等旧事实。与父任务协调后，在创建测试环境前明确拒绝运行，提示按新 run-* 预设重新编排；保留旧叙事取证代码供历史阅读，不假装仅改 API 即已迁移其语义验收。
- 当前自由调试主要回归已通过真实 localhost HTTP + SQLite 进行，不依赖上述旧 probe。README 已替换为当前授权、API、两来源配置和退役工具说明，保留旧地图出处。

## 验证证据

- `scenario-director-api.test.ts`、`mock-scenarios.test.ts`、`scenario-scope.test.ts`：36 tests passed（合并调用日志 `/private/tmp/director-runtime-final-tests.log`；该次新增 store 用例最初因未指定分页过滤失败，修正后独立通过）。
- `director-debug-store.test.ts`：1 passed，覆盖双 revision/CAS、重试、未知回执阻止结束、重启持久化、历史查询、新轮数据恢复、跨轮次引用和调试执行指令拒绝；checker 随后接管增加容量上限后可结束回归。
- `probe-agent-framework.test.ts`、`probe-source-annotations.test.ts`：22 passed，包含旧 probe 在启动前拒绝的断言。
- 所属文件 ESLint 与 TypeScript 检查通过；最终交接再运行 typecheck。旧源 helper 禁用的新增 focused test 另行执行。
- 未跑真实模型批量验收，未部署、未提交实施代码，未经用户测试验收。

## 交接

- checker 已接管修复 operation cap 下 pause/finish 必须仍可用的边界。
- 根任务仍需整合来源迁移/UI回归和完整质量门禁，不能根据本记录宣称本阶段验收完成。

## 全量回归后的旧 fixture 收尾

- `probe-situation-map.ts` 明确改为旧 Orchard 只读查询 fixture：删除 simulation 配置、控制令牌和通知发送目标，显式关闭继承的场景引擎环境设置。仍可启动独立三任务地图查询环境，未把旧 source-manage 权限变为导演权限。
- `situation-trial.test.ts` 保留三任务隔离、真实来源查询、无模型、凭证权限和不泄漏检查；旧写入用例改为总体/筹划席保存及发送均403，前后事实和后台队列不变。
- `situation-host.test.ts` 补齐真实身份读取的测试 double，明确无导演授权时 simulationEnabled 为 false；有来源管理权限也不能绕过。未修改产品鉴权逻辑。
- `context-cli.test.ts` 验证CLI和后端socket均拒绝旧写入、数据与游标不变，保留socket0600、日志无凭证及无通知检查。原 recovery 事实前置约束/历史不变继续由 `context-http.test.ts` 覆盖。
- 单跑完整 `mock-scenarios.test.ts` + `situation-trial.test.ts`：22 passed；完整 `context-cli.test.ts` + `situation-host.test.ts`：4 passed；四个新增修改文件 ESLint 通过。此前全量 mock helper 失败未在完整定版单跑复现，父任务定位为变更期间 Vitest transform 缓存混用。
