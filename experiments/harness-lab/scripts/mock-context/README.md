# 多源能力验证用模拟服务

本目录独立维护合成报告、对象和变化，不包含 Axon 任务或研判答案。应用宿主只能经 HTTP 查询，禁止把本目录挂到 Agent 工作区或导入应用运行路径。它不是未来特情／态势产品的数据模型。

在 harness-lab 目录中启动（查询令牌自行保存在本地环境变量）：

```sh
export MOCK_CONTEXT_CONTROL_SOCKET=/tmp/axon-mock-context.sock
npx tsx --env-file-if-exists=.env.local scripts/mock-context/main.ts
```

必须设置 `MOCK_CONTEXT_API_TOKEN`；默认仅监听 `127.0.0.1:4401`，可用 `MOCK_CONTEXT_PORT` 修改端口。Axon 使用 `fixtures/context-config.example.json` 的绝对路径作为 `LAB_CONTEXT_CONFIG`，在宿主配置同一查询令牌。入站通知的来源令牌另行配置，不复用查询令牌。

旧场景控制脚本经权限 0600 的本机 Unix socket 工作；新的地图实例使用下节显式启用的 HTTP 控制：

```sh
npx tsx scripts/mock-context/control.ts reset
npx tsx scripts/mock-context/control.ts advance intel
npx tsx scripts/mock-context/control.ts event E1
npx tsx scripts/mock-context/control.ts advance situation
npx tsx scripts/mock-context/control.ts event E2
npx tsx scripts/mock-context/control.ts advance unknown
npx tsx scripts/mock-context/control.ts event E3
npx tsx scripts/mock-context/control.ts unavailable situation on
npx tsx scripts/mock-context/control.ts requests
```

`advance` 只改变外部事实，`event` 只输出通知 JSON；二者都不会自动发送消息或调用模型。测试驱动把通知 POST 到 Axon 既有 `/api/integrations/:sourceId/events`。Axon 任务的创建、S6 时间变体和 S7 需求互换由 Axon API 完成，不在模拟系统维护。重复发送同一通知用于核验 Axon 原有去重。

`reset` 恢复 S0；先后 `advance intel/situation/unknown` 对应 E1/E2/E3。S3 可从 S0 直接推进 situation。`unavailable situation on/off` 验证 S5。`advance contract` 仅供接口测试，增加第二条资源变化和未知观测时间报告，不用于主场景真实模型验收。

变化游标含实例代次，须读取实际 `changeCursor/nextAfter` 或 event E2 的内容，不要硬编码文档中的 seq-100/101。reset 后旧变化游标失效；推进/重置后旧分页游标失效。`requests` 只记录方法、路径和 HTTP 状态，不记录认证头。

测试可导入 `createMockContextServer({token})`，调用 `listen()` 获得真实 HTTP 地址；控制函数仅由测试进程持有。退出后调用 `close()`。

方案修订验证使用独立实例，在 `advance intel` 和 `advance situation` 后，按验证进度再执行：

```sh
npx tsx scripts/mock-context/control.ts advance recovery
npx tsx scripts/mock-context/control.ts event E4
```

`recovery` 增加 `report-west-01` 修订 3：09:35 观测并发布，确认道路限制提前解除。保留修订 1/2，最新查询和特情 `asOf` 推进至 09:35；车辆仍为修订 2、2 辆，态势游标和道路对象不变。重复推进不追加修订。缺少 intel/situation 前置阶段或已进入 contract 的车辆修订 3 时，推进明确失败且不改变任何事实。E4 使用独立消息 ID `intel-msg-0003`，正文需查询报告；E1/E2/E3 含义保持原样。`event` 本身不检查或推进事实阶段，先推进事实再发送通知。


## 地图实例与 Web 控制

新实例设置 `MOCK_CONTEXT_INSTANCE_ID`（字母/数字/短横线，最长 64 字符）、`MOCK_CONTEXT_DAY`（YYYY-MM-DD）、`MOCK_CONTEXT_DATA_DIR`（独立绝对目录）。SQLite 保存完整有界场景快照、修订、变化和冻结通知；重启同目录保留状态，不能改实例编号或使用旧场景 reset/advance。新一轮另建目录和实例。

`mapFixtures(instanceId, day)` 生成带实例前缀的旧对象/区域/报告编号。区域为新加坡 Orchard Road 小范围。2026-10-11 从 [OSM map API](https://www.openstreetmap.org/api/0.6/map?bbox=103.831,1.303,103.839,1.306) 读取对象和节点（不是地图瓦片），道路线逐点保留源经纬度：

| 合成名称 | OSM 原始道路 | 版本 | 节点 |
| --- | --- | --- | --- |
| 西区通道 | [way 16679081](https://www.openstreetmap.org/way/16679081) | 34 | 595110735、1951506304、3689717005、8163741312、6130389367 |
| 东区通道 | [way 481677045](https://www.openstreetmap.org/way/481677045) | 12 | 4745885042、5278615474、240686813 |

原道路名称均为 Orchard Road、类型为 primary；“西区/东区”仅是本场景命名。坐标的 OSM 对象依据已核对，实际浏览器底图加载/视觉对齐仍需人工验收。区域边界与资源点为合成位置，不可用于路由或精确调度。道路几何 © OpenStreetMap contributors，依据 [ODbL 署名许可](https://www.openstreetmap.org/copyright) 提供；已选坐标完整保存在 map-fixtures.ts，不保存整个下载区域或用户编辑者元数据。限制、资源和报告均为合成。自动化不请求公共瓦片。

设置独立 `MOCK_CONTEXT_CONTROL_TOKEN` 启用 `/control/*`（否则返回 404），查询令牌不能访问控制。`MOCK_CONTEXT_NOTIFICATION_CONFIG` 是绝对 JSON 文件路径，格式：

```json
[
  {"systemId":"situation","sourceId":"mock-situation-source","url":"http://127.0.0.1:4315","tokenEnv":"MOCK_SITUATION_INGRESS_TOKEN"},
  {"systemId":"intel","sourceId":"mock-intel-source","url":"http://127.0.0.1:4315","tokenEnv":"MOCK_INTEL_INGRESS_TOKEN"}
]
```

URL 仅为 Axon origin；接入路径由程序追加，接入令牌与查询/控制令牌分离。不开启自动发送；HTTP 控制仅供 Axon 经席位授权转发，不对浏览器或模型直接提供凭证。

- `GET /control/state`：`SimulationState`（不含认证配置）。
- `POST /control/object-updates`：`SimulationObjectUpdate`，只更新现有 road/resource 属性和时间。
- `POST /control/report-updates`：`SimulationReportUpdate`，report 为完整正文元数据，源分配 reportId/revision。
- `POST /control/actions/:id/send`：无请求正文或空 JSON 对象，发送冻结通知；不接受替换正文。
- `GET /control/actions/:id`：读取操作；接收未确认时向 Axon 核对回执。

共享 DTO 位于 `src/contracts/simulation.ts`。保存操作按 UUID 和规范内容去重，再校验 expectedRevision；相同编号不同内容或修订冲突返回 409。保存不发送，发送前记为未确认；网络错误后查回执，人工重送也先核对。202 回执只表示接收，不表示后台分析完成。每实例最多 1000 次保存操作，达到后建立新实例，不清除旧记录。
