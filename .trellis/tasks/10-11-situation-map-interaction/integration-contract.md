# 接口与数据契约

状态：已审阅，作为本期实施契约。扩展既有查询契约，不另造地图事实库。以下路径为本期计划；既有接口会明确标注。

## 1. 交互接口

| 调用方 → 服务方 | 接口 | 职责 |
| --- | --- | --- |
| 地图 → Axon | 既有 `GET /api/context/catalog` | 返回当前席位可查询的系统和区域选项，不返回源地址或令牌 |
| 地图 → Axon | `GET /api/context/map-config` | 返回受控的公开底图配置，不含密钥，不授予态势查询权限 |
| 浏览器 → OSM | `GET https://tile.openstreetmap.org/{z}/{x}/{y}.png` | 加载当前视野底图，独立于 Axon 业务查询，无 Axon 凭证 |
| 地图 → Axon | `POST /api/context/situation` | 请求体为既有 SituationQueryParams，调用 ContextService，以当前席位查询 |
| 地图 → Axon | `POST /api/context/reports/search` | 按对象引用查相关报告，参数同 information_search |
| 地图 → Axon | `GET /api/context/reports/:systemId/:reportId?revision=N` | 读取报告，revision 可省略以取最新版本 |
| Axon → 模拟服务 | 既有 `GET /situation/objects`、`/situation/changes` | 当前态势及 before/after 变化；增加可选空间字段和道路状态 |
| Axon → 模拟服务 | 既有 `GET /intel/reports`、`/intel/reports/:id` | 报告索引、正文和修订；本期不改变字段含义 |
| 控制页 → Axon → 模拟服务 | 见第 4 节 | 经登录、来源管理授权、资料权限和测试开关校验后转发控制操作 |
| 模拟服务 → Axon | 既有 `POST/GET /api/integrations/:sourceId/events` | 发送通知、查询接收回执，沿用去重与处理规则 |
| 输入框 → Axon | 既有 `POST /api/sessions/:id/messages` 增加 contextRefs | 传所选对象引用，宿主加载资料后送入原 Pi 请求 |

地图的三个查询接口只返回当前身份获准的数据，复用已有标准响应和错误封装；不是任意代理接口。查询不启动模型。缺少参数、额外字段、超限均显式报错。

源访问继续为服务端 Bearer 认证；浏览器使用 Axon 登录会话及现有 CSRF 规则。查询超时 15 秒、单次响应最大 256 KiB、禁止跟随重定向等现有约束保持。

底图配置初值如下，URL 与署名由服务端配置提供，人员和模型不传任意地址。瓦片请求由 MapLibre 使用浏览器默认缓存，Referer 保留站点来源；该请求不应用业务 API 的 Bearer、CSRF 或 no-store 设置。

```json
{
  "providerId":"osm-standard",
  "tiles":["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
  "tileSize":256,
  "attributionText":"© OpenStreetMap contributors",
  "attributionUrl":"https://www.openstreetmap.org/copyright"
}
```

## 2. 空间与状态

`SituationObject` 保留既有字段，增加 `geometry?: Geometry | null`。缺失/null 表示来源未提供位置，不能填 `[0,0]`。本期仅支持二维：

| 对象 | geometry | properties |
| --- | --- | --- |
| road | LineString，至少 2 个坐标 | `{passability, restrictionNote?}`；passability 为 open/restricted/closed/unknown；旧空对象仍可读 |
| resource | Point，资源池驻点 | 沿用 `{availableCount, unit:"辆"}`，数量为非负整数 |
| area | Polygon，闭合外环 | 沿用 `{memberRefs}`，不要求把所有对象递归加载 |

坐标为 WGS84 `[longitude, latitude]`，范围分别为 [-180,180]、[-90,90]，须为有限数值；单对象最多 200 个位置点，Polygon 本期只接收一个闭合外环。由适配器检查类型、结构和数量；不做真实道路拓扑验证。坏 geometry 返回契约错误，不能静默丢掉坐标后当作完整成功。

示例：既有 `/situation/objects` 返回的一个 item（只列 item，不替代完整分页响应）：

```json
{
  "ref": {"systemId":"situation","objectType":"road","objectId":"map-r1-road-west-01"},
  "name":"西区通道",
  "revision":2,
  "areaIds":["map-r1-zone-west"],
  "effectiveAt":"2026-10-11T09:20:00+08:00",
  "validTime":{"from":"2026-10-11T09:20:00+08:00","to":"2026-10-11T10:10:00+08:00"},
  "properties":{"passability":"restricted","restrictionNote":"模拟限制，需核实通行条件"},
  "geometry":{"type":"LineString","coordinates":[[110.0,30.0],[110.01,30.01],[110.02,30.01]]}
}
```

以上坐标仅用于说明接口形状，不是验收场景。正式测试数据须选定实际区域、使预置道路线与底图道路对齐，并记录几何资料来源；限制、资源数量等业务事实仍为合成。属性或位置变化都增加对象 revision，changes 的 before/after 包含各自完整版本。源状态不因 validTime 到期自动改为 open；页面展示来源有效时段，新状态须由来源发布。模拟业务时间与实际时钟分开，本期不按浏览器时钟自动判断模拟状态失效。

查询 envelope 保留 `{systemId, query, queriedAt, data}`，可增加宿主派生的 `mapReferences`，见第 3.2 节；源接口不负责生成 Axon 链接。data 保留 `asOf/items/limit/nextCursor/hasMore/timeUnknownCount/unknownRefs/changeCursor` 等原字段。`queriedAt` 为宿主实际查询时间；`asOf` 为来源资料截止时间；`effectiveAt/validTime` 为业务时间，三者不可互换。

过滤继续遵守“同类 OR，不同类 AND”，原 `cursor`、`after` 语义保持。地图展示并集时发起独立查询，不改变底层工具语义。同一源多页须属同一数据代次；不同源不承诺全局原子快照。

当前 catalog 的区域为写死的西区/东区。本期改为 `ContextSystemConfig.areas?: {id,name}[]` 的受控配置，测试准备脚本从场景生成，与区域对象及报告 areaIds 对齐。省略时提供空选项，已有手填引用仍可查询；不再用固定区域替代未配置来源。此配置只定义选择项，不授予区域权限。

受控验证场景最多 100 个对象；地图每页默认 20、沿用查询最大 100 的限制，累计保护上限 500。遇到上限或超大响应，提示缩小范围，不标称已加载全部；不得混入另一批分页结果。地图拖动仅改变视野，本期不增加 bbox 空间检索或全量 GIS 索引。

## 3. 对话引用

### 3.1 地图对象进入对话

新增可选输入：

```json
{
  "text":"道路恢复后，车辆条件是否仍影响本任务？请说明依据。",
  "contextRefs":[
    {"systemId":"situation","objectType":"road","objectId":"map-r1-road-west-01"},
    {"systemId":"situation","objectType":"resource","objectId":"map-r1-vehicles-west-01"}
  ]
}
```

本期只支持态势对象，不把文件/Skill/Agents 改成通用插件引用。每次最多 20 个，ID 继续遵守既有引用校验；禁止通过该字段传入身份、scope、URL、对象正文或系统提示。

宿主按 systemId 分组，用当前席位调用已有 current 查询；只加载显式选中对象，不展开 area.memberRefs。所选项必须全部解析；单项失败不启动本次模型，保留输入。合计加载数据上限 256 KiB，不默认截短。

加载结果随本次 composer input 保存到原生 JSONL，含完整引用、实际查询 envelope 和返回对象。扩展 LoadedComposerSelection/PublicMessage 的可选资料投影；旧无引用记录维持原文与校验。新记录重开后显示实际加载版本，不回查当前状态覆盖历史。

来源内容作为任务资料加载，不改变系统指令、工具权限或审批要求。按 Pi 原生压缩处理，完整历史保留。记录成功但用户消息尚未保存时发生取消，继续遵守既有 composer 关联规则，不自动重放。

### 3.2 回答正文中的地图链接

宿主对成功的态势查询、报告查询及显式加载结果派生 `mapReferences`，附在查询 envelope 中供模型使用。候选仅来自实际返回的 road/resource/area 对象或报告 objectRefs，不使用模型自由文本生成。已知无 geometry 的对象不生成可定位链接；只有报告引用、尚未查询位置的对象可生成入口，点击后按权限查询位置，缺失时明确说明。

```json
{
  "mapReferences":[
    {
      "ref":{"systemId":"situation","objectType":"road","objectId":"map-r1-road-west-01"},
      "revision":2,
      "href":"/situation?systemId=situation&objectType=road&objectId=map-r1-road-west-01&revision=2"
    }
  ]
}
```

revision 可省略，表示该资料只提供对象引用；报告自身的 revision 不能填作所引用道路的 revision。链接参数经过规范编码，来源返回的 URL 不直接成为定位链接。

工具/资料说明补充一句用法：回答提及对象时，可使用随查询结果提供的地图链接。模型可生成普通 Markdown：

```markdown
[西区通道](/situation?systemId=situation&objectType=road&objectId=map-r1-road-west-01&revision=2)目前限制通行。
```

前端在现有 Markdown 渲染中识别固定的相对路径 `/situation` 和上述参数，并与该回答之前、所属会话或后台作业中实际保存的查询/加载依据核对。只将匹配的对象与修订转为打开侧面板的定位操作；无法核对或格式不全的地图链接显示原文字。不全局替换同名地名，也不从任意文件预览启用定位。

匹配表从当前获准历史派生，不新增可独立修改的引用数据库；重开会话仍能使用原依据。流式输出待链接完整后才可点击。未生成正文链接时，保留查询依据入口，不强制补调用。正文中的普通外链沿用所在页面现有行为，不因本功能扩大开放范围。

点击重新按当前权限读取对象并定位，详情显示源对象名称和当前修订；链接中的 revision 仅说明分析依据，不是历史地图请求。无权限、对象消失或缺少 geometry 分别反馈，不改写原回答或旧查询记录。链接可定位只证明对象引用可核对，不证明分析结论正确。

## 4. 模拟控制

通过显式测试配置指定控制 baseUrl、控制凭证环境变量、允许的 systemId 与对应 sourceId；源服务通知目标地址、接入凭证也来自服务端配置。页面不可修改这些地址和凭证。默认关闭控制接口；启用后，进入控制台及调用其 API 均要求当前用户具备配置内全部模拟来源的管理授权及资料权限，避免 state 返回跨来源未授权资料；具体操作还核对目标对象和来源映射。本期预置总体席满足这一组合权限，不另建账户体系。

| Axon 路由 | 模拟服务路由 | 请求 / 结果 |
| --- | --- | --- |
| `GET /api/simulation` | `GET /control/state` | 当前实例名、预置对象和报告、修订、已保存操作与发送状态，不含凭证 |
| `POST /api/simulation/object-updates` | `POST /control/object-updates` | clientActionId、ref、expectedRevision、properties、effectiveAt、validTime；返回保存回执及待发送通知 |
| `POST /api/simulation/report-updates` | `POST /control/report-updates` | clientActionId、reportId、expectedRevision、报告完整正文与元数据；返回新修订及待发送通知 |
| `POST /api/simulation/actions/:id/send` | `POST /control/actions/:id/send` | 发送该操作已经冻结的通知；不接收替换正文；返回发送状态及可用接收回执 |
| `GET /api/simulation/actions/:id` | `GET /control/actions/:id` | 查询保存结果及发送记录；发送结果不明时可核对 Axon 接收回执 |

object-updates 仅允许现有 road/resource 的受控属性；不能更换编号、geometry、areaIds。report-updates 使用既有 InformationReport 字段，服务端分配下一 revision；objectRefs 允许引用待核实的未知对象，但不能伪造已查询到的状态。当前实例、来源和目标对象由服务端核对。

clientActionId 为 UUID；先查重再检查 expectedRevision。同一操作编号同一内容返回原保存结果；不同内容返回 409；旧修订修改返回 409，页面保留编辑内容供刷新后重提。每次新修改使用新编号，不覆盖旧修订。

模拟服务在一个本地事务中保存新快照、before/after、操作记录及待发送通知。通知至少包括以下内容，沿用既有事件字段：

```json
{
  "sourceMessageId":"map-r1-17b429c7-faaa-4c3c-a687-393125534e75",
  "title":"西区通道态势更新",
  "text":"对象 situation/road/map-r1-road-west-01 由修订 2 更新为 3，通行状态恢复为 open，生效时间为 2026-10-11T09:35:00+08:00。请查询对象状态及变化。",
  "subjectId":"map-r1-road-west-01",
  "occurredAt":"2026-10-11T09:35:00+08:00"
}
```

此通知不携带 Axon taskId、接收席位或预期结论。Profile、固定投递和补充投递仍由 Axon 既有规则决定。

发送记录只区分未发送、接收已确认、接收未确认/发送失败，并保存原因；已接收时保存既有 `{eventId,sourceMessageId,receivedAt,status:"accepted"}` 回执。HTTP 202 不等于分析成功。控制页用 eventId 链接到现有处理记录，不复制一套后台作业状态。

超时先查回执；查不到时允许人员再次发送同一冻结内容。进程重启不自动补发所有待发送通知，也不重跑已完成分析。新增修订与同一通知重送必须区别开。

## 5. 失败与一致性

| 情况 | 行为 |
| --- | --- |
| 无身份/资料权限/来源管理权限 | 401/403；不返回源数据、可猜测的对象明细或控制凭证 |
| 未启用模拟控制 | 控制入口隐藏，控制 API 不可用；普通地图查询照常 |
| 引用不存在 | 只读 current 维持 unknownRefs；发送所选引用时明确指出缺失项，保留草稿 |
| 坐标契约错误或响应超限 | 返回明确查询错误；不默默把不完整资料交给模型 |
| 分页中源更新 | 维持 CURSOR_STALE；地图重新开始一次，不能拼接不同时点分页 |
| 修改 revision 冲突 | 409，不覆盖来源新值；不发出通知 |
| 保存成功、通知失败 | 保存事实仍有效，通知可核对/重送；不把地图状态回滚 |
| 报告与态势冲突 | 分别保留各自来源和时间；供人员/Agent 核对，不自动挑一份覆盖另一份 |

新接口具体错误码在实施时与已有 RequestError 复用；HTTP 语义和用户可见行为以本表为验收依据。

## 实施补充：控制页列表窗口

`GET /control/state` 返回每份报告的最新修订及最近 20 项操作；历史报告修订和操作编号仍可单独查询，不删除历史。宿主读取此控制状态的响应上限为 2 MiB；普通资料查询和对话引用加载仍遵守 256 KiB 限额。这个窗口避免测试操作累积后整个控制页无法打开。
