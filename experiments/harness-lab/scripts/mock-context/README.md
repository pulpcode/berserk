# 导演台模拟来源

本目录维护合成报告、对象、变化及按轮次隔离的历史。应用宿主只能经 HTTP 查询，不可将本目录挂到 Agent 工作区。当前操作入口只有 Axon `/director`，不提供旧模拟验证页面或无轮次写入接口。

## 启动与授权

设置独立 `MOCK_CONTEXT_API_TOKEN`（查询）和 `MOCK_CONTEXT_CONTROL_TOKEN`（控制），以及 `MOCK_CONTEXT_SCENARIOS_ENABLED=true`。持久运行需要绝对路径 `MOCK_CONTEXT_DATA_DIR`，重启必须沿用目录；不要为了切换方式删除数据库或重建目录。默认监听 `127.0.0.1:4401`，可设置 `MOCK_CONTEXT_PORT`。

```sh
npx tsx --env-file-if-exists=.env.local scripts/mock-context/main.ts
```

Axon 的 context 配置中开启 scenarios 并显式列出导演席位，同时为该席位授予 `controlScenarios` 能力；来源 manage 权限不再授予导演权限。查询、控制和入站通知令牌必须分开。控制令牌由 Axon 宿主使用，不交给浏览器或模型。

`MOCK_CONTEXT_NOTIFICATION_CONFIG` 指向绝对 JSON 路径，两个当前通知来源如下（URL 仅为 Axon origin）：

```json
[
  {"systemId":"situation","sourceId":"scenario-situation-source","url":"http://127.0.0.1:4316","tokenEnv":"SCENARIO_SITUATION_INGRESS_TOKEN"},
  {"systemId":"intel","sourceId":"scenario-intel-source","url":"http://127.0.0.1:4316","tokenEnv":"SCENARIO_INTEL_INGRESS_TOKEN"}
]
```

沿用已迁移的凭证配置，不以示例覆盖线上凭证；新通知的方式由可信轮次解析。历史 `mock-*` 来源和记录用于审计，不继续接收新通知。

## 当前宿主 API

所有以下写操作需已有导演会话与 CSRF 校验。DTO 在 `src/contracts/director.ts`、`scenarios.ts`、`simulation.ts`。

1. `GET /api/simulation/director` 读取活动轮次、活动指针修订及未完成切换。
2. `POST /api/simulation/director/switch` 提交 `clientActionId`、`mode: "free_debug" | "scenario"`、`expectedActiveRevision`、`expectedInstanceId`、`expectedRevision`、`confirmed: true`。无轮次时后两个字段为 null；重开自由调试再带 `restart: true`。
3. 切换自由调试初始化新 run-* 轮次的独立预置数据。切换场景演练只结束当前调试并返回场景选择，不自动开始场景。两者都不发送通知。
4. `GET /api/simulation/instances/:id/debug` 读取指定调试轮次，包括历史。只有活动轮次可修改。
5. `POST /api/simulation/instances/:id/debug/object-updates` / `report-updates` 使用原保存 DTO 并增加 `expectedRunRevision`。`expectedRevision` 仍表示对象或报告修订。每次保存后使用返回的 run revision，再执行下一次保存。
6. 保存产生未发送 action。`POST /api/simulation/actions/:actionId/send` 明确传 `{ "instanceId": "run-…", "expectedRevision": 轮次修订 }` 才会发送。`GET /api/simulation/actions/:actionId` 可核对不确定回执。202 只表示收到，不表示后台分析完成。

切换遇到未确认通知或运行中写入会停止并保留待处理记录；刷新和进程重启不会继续切换。`GET /api/simulation/director/operations/:clientActionId` 只查询，重试必须由原操作者显式提交相同请求体，不换操作编号。冻结轮次保存事实、通知、任务映射与查询历史；自由调试暂不支持场景执行指令。

## 旧工具与历史资料

旧 `/api/simulation/object-updates`、`report-updates` 以及源端无轮次写接口在统一导演模式返回 410；普通业务席位先被权限检查拒绝。旧页面地址已移除，不跳转保留旧入口。

本机 Unix socket 仍可读取运行信息（0600 权限），CLI 仅支持：

```sh
npx tsx scripts/mock-context/control.ts status
npx tsx scripts/mock-context/control.ts requests
```

旧 reset/advance/event/unavailable CLI 已停用；启用统一导演模式后，socket 后端也拒绝这些命令，不允许绕过导演台修改共享运行状态。测试进程可在明确未启用 scenarios 的独立来源中使用旧 fixture helper，不能作为在线操作入口。

`probe-agent-framework.ts` 与 `probe-source-annotations.ts` 依赖旧 Orchard map-* 世界，真实模型批量验收入口在创建环境前明确拒绝。它们的旧业务叙事需按新预置世界重新编排，不能仅替换 API 路径。本轮自由调试的真实 HTTP/SQLite 自动回归见 `tests/scenario-director-api.test.ts`、`tests/director-debug-store.test.ts`；未声称这些自动检查等于用户或真实模型验收。

`probe-situation-map.ts serve/verify` 保留为隔离的旧 Orchard 只读地图/查询 fixture；不配置模拟控制、导演角色或通知发送目标。serve 仅启动环境，verify 明确发起一次真实模型查询。旧 source-manage 授权不允许写入，相关回归见 `tests/situation-trial.test.ts`。

## 历史地图数据出处

以下仅说明旧地图快照来源，不代表当前调试轮次的数据或操作流程。旧实例、对象 ID 与历史引用保持不变。

`mapFixtures(instanceId, day)` 生成带实例前缀的旧对象/区域/报告编号。区域为新加坡 Orchard Road 小范围。2026-10-11 从 [OSM map API](https://www.openstreetmap.org/api/0.6/map?bbox=103.831,1.303,103.839,1.306) 读取对象和节点（不是地图瓦片），道路线逐点保留源经纬度：

| 合成名称 | OSM 原始道路 | 版本 | 节点 |
| --- | --- | --- | --- |
| 西区通道 | [way 16679081](https://www.openstreetmap.org/way/16679081) | 34 | 595110735、1951506304、3689717005、8163741312、6130389367 |
| 东区通道 | [way 481677045](https://www.openstreetmap.org/way/481677045) | 12 | 4745885042、5278615474、240686813 |

原道路名称均为 Orchard Road、类型为 primary；“西区/东区”仅是本场景命名。坐标的 OSM 对象依据已核对，实际浏览器底图加载/视觉对齐仍需人工验收。区域边界与资源点为合成位置，不可用于路由或精确调度。道路几何 © OpenStreetMap contributors，依据 [ODbL 署名许可](https://www.openstreetmap.org/copyright) 提供；已选坐标完整保存在 map-fixtures.ts，不保存整个下载区域或用户编辑者元数据。限制、资源和报告均为合成。自动化不请求公共瓦片。
