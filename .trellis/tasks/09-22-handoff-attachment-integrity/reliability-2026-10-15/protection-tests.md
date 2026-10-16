# P1 必要保护测试

日期：2026-10-15。仅修改既有测试与本记录，未修改业务源码。

## 变更及必要性

| 场景 | 位置 | 必要性与观察结果 |
| --- | --- | --- |
| C08：提交前固定副本 missing/corrupt | `tests/collaboration/service.test.ts` | 原用例仅改坏副本。本次参数化缺失/损坏，并补无 receipt 断言；commit 和 openFile 均必须拒绝，接收方无工作。`original` 与 `modified` 长度相同，损坏分支验证摘要校验而非只验证大小。 |
| C08：合法提交后固定副本 missing/corrupt | 同上 | 提交前检查不能证明提交后的导入安全。两种故障下 receiver import 必须拒绝；新目标不得产生文件，已有目标的人员编辑不得被覆盖，合法工作元数据保留。 |
| C08：禁用当前账号后读回执/重放提交 | `tests/access.test.ts` | 原会话撤销测试只请求 `/api/info`。本次先合法提交并成功读取两种回执入口，再通过已有 `AccessStore.disable` 禁用账号，旧 cookie 请求 action ID、clientActionId 和 commit 均应 401，原工作仍只有一个。 |
| C03：实际工作确认等待遇到整轮超时 | `tests/pi/collaboration.test.ts` | 原通用 HITL 超时用例不能直接保护业务准备单。沿用 `agentRunTimeoutMs` 与既有 pending 等待 helper，观察真实 pending 后等待 run 完成；超时后卡片 cancelled、准备单 expired、无 receipt、晚批准拒绝、commitAgent 未调用且无工作。 |

共覆盖 6 个参数化测试实例，替换原 corrupt 实例后净新增 5 个。Pi fixture 新增可选 deadline 参数，默认仍为 0，与既有 `testConfig` 一致；只有新增超时用例设为 1800ms，沿用通用 HITL 测试的显式期限。没有任意 sleep、生产 hook、新测试框架或模型调用。

## 验证记录

基线日志完成于 14:01:28 UTC，三文件首次写入于 14:02:32 UTC；原 baseline 为 14 文件 / 316 测试通过。以下是写入后单独运行的增量验证，不把 baseline 数量视作新增用例已通过。

从 `experiments/harness-lab` 执行：

```sh
npm test -- tests/collaboration/service.test.ts tests/access.test.ts tests/pi/collaboration.test.ts --maxWorkers=1
```

结果：exit 0，**3 文件 / 69 测试全部通过**，用时 64.27 秒。日志：`.local/handoff-reliability-20261015/protection-tests.log`。运行时 Node v24.14.0 / Vitest v4.1.11。日志仅见既有 SQLite experimental warning，没有测试失败。`git diff --check` 已通过。独立检查代理随后运行最终 lint/typecheck，均 exit 0；不重复运行完整构建和浏览器基线。

## 结果边界

- 这是现有机制的预期通过保护，不为迎合任务书制造业务红测；若真实失败，保留日志交 P2 审阅，不修改生产代码掩盖问题。
- 服务导入测试仅证明既有 `importFile` 的单文件校验/无覆盖契约，不宣称多文件自动导入具备整组回滚，也不证明自然语言选片正确。
- 账号禁用是已有受支持状态变化；不通过直接重写任务 owner/visibility 虚构“任务撤权”，也不把已接收 Agent 请求的身份失效解释为自动取消。
- 超时用例使用确定性 provider 与真实 Pi 宿主确认流程；不是付费模型、Docker 或线上验收。
- 没有提交、推送、部署、修补历史坏单或新增权限/恢复机制。
