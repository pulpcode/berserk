# 模拟系统交互契约

状态：**待审，未实现**。本文确定本期联调的请求、响应和数据边界；总体设计见 [design.md](design.md)，业务数据与预期见 [模拟场景](research/simulation-scenario.md)。字段与示例不代表真实特情／态势系统的统一标准。

## 1. 交互方向与数据范围

| 方向 | 接口 | 传递什么 |
| --- | --- | --- |
| 模拟来源 → Axon | 既有 `POST /api/integrations/:sourceId/events` | 本来源的更新通知与查询线索；无需任务、席位或工作区 ID |
| 模拟来源 → Axon | 既有 `GET /api/integrations/:sourceId/events` | 按消息 ID 查询接收回执，不查询分析结果 |
| Axon 宿主 → 模拟特情系统 | 新增 `GET /intel/reports`、`GET /intel/reports/:id` | 报告索引、原文及修订历史 |
| Axon 宿主 → 模拟态势系统 | 新增 `GET /situation/objects`、`GET /situation/changes` | 当前对象资料、资源状态及变化前后值 |
| 浏览器 → Axon | 新增 `GET /api/context/catalog` | 当前席位获准系统与查询能力，用于页面展示 |

Axon 任务由工具直接查询现有任务服务，不经过模拟系统。模拟服务不保存 Axon 任务、工作区、席位、投递规则或分析结论；Axon 不读模拟服务的数据文件，只经真实 HTTP 查询。测试脚本负责建立 Axon 任务、推进模拟数据和发送通知，不进入 Agent 工具集合。

## 2. 更新通知：沿用现有接收契约

来源请求使用 `Authorization: Bearer <来源令牌>`、`Content-Type: application/json`。`sourceId` 来自部署配置：`mock-intel-source` 映射 `intel`，`mock-situation-source` 映射 `situation`；消息不能通过正文更换这一身份。

| 字段 | 规则 |
| --- | --- |
| sourceMessageId | 必填，1～200 字符；同一来源一次通知的稳定标识 |
| title | 必填，1～200 字符 |
| text | 必填，最长 16,000 字符；无附件时不得为空白 |
| subjectId | 可选，1～200 字符；来源内的主题标识，本例使用报告 ID 或变化对象 ID |
| occurredAt | 可选，带时区的 ISO 时间；未提供不能用接收时间冒充业务时间 |
| uploadIds | 可选，沿用现有上传接口产生的 UUID 数组及附件数量限制 |

不增加顶层 `systemId`、`taskId`、`objectRefs` 或任意扩展字段。结构化查询引用由通知中的明确线索及查询结果获得，不把自然语言中的路径当作附件。

E1：`POST /api/integrations/mock-intel-source/events`

```json
{
  "sourceMessageId": "intel-msg-0001",
  "title": "西区通道限制信息更新",
  "text": "报告 report-west-01 更新至修订 2。关联对象 situation/road/road-west-01；限制时段为 2026-10-01T09:20:00+08:00 至 2026-10-01T10:10:00+08:00。请查询报告正文及历史。",
  "subjectId": "report-west-01",
  "occurredAt": "2026-10-01T09:20:00+08:00"
}
```

E2：`POST /api/integrations/mock-situation-source/events`

```json
{
  "sourceMessageId": "situation-msg-0001",
  "title": "西区可用车辆更新",
  "text": "对象 situation/resource/vehicles-west-01 的修订由 1 更新为 2，可用车辆由 4 辆变为 2 辆。变化游标从 situation-seq-100 推进至 situation-seq-101；请查询变化详情。",
  "subjectId": "vehicles-west-01",
  "occurredAt": "2026-10-01T09:30:00+08:00"
}
```

E3 未知对象变体使用 `POST /api/integrations/mock-intel-source/events`：

```json
{
  "sourceMessageId":"intel-msg-0002",
  "title":"待核实通道信息",
  "text":"报告 report-unknown-01 修订 1 引用 situation/road/road-unknown-99，区域 zone-west，有效时间为 2026-10-01T09:35:00+08:00 至 2026-10-01T10:10:00+08:00。请查询报告正文。",
  "subjectId":"report-unknown-01",
  "occurredAt":"2026-10-01T09:35:00+08:00"
}
```

成功接收返回 HTTP `202`：

```json
{
  "eventId": "b246d975-170e-4eed-a9bd-475b58b4ed98",
  "sourceMessageId": "intel-msg-0001",
  "receivedAt": "2026-09-24T03:00:00.000Z",
  "status": "accepted"
}
```

`202` 只表示已保存接收记录，不表示预处理完成或投递成功。`receivedAt` 是真实接收时间；示例中的业务日期为固定模拟时钟，不能与它比较来判定资料是否有效。`GET /api/integrations/mock-intel-source/events?sourceMessageId=intel-msg-0001` 返回同一回执，状态码为 `200`。

去重沿用 `(sourceId, sourceMessageId)`：相同语义内容返回同一回执；相同键但标题、正文、主题、业务时间或附件语义不同，返回冲突，不覆盖旧消息。来源发布新修订使用新消息 ID。人工重新处理沿用现有机制，产生新作业。

现有接收错误为 `{"error":{"code":"…","message":"…"}}`：参数／额外字段为 `400 INVALID_INPUT`；来源凭证无效为 `401 SOURCE_UNAUTHORIZED`；同键不同内容为 `409 BACKGROUND_CONFLICT`；新消息积压满为 `429 BACKGROUND_CAPACITY`，暂停接收为 `503 SOURCE_PAUSED`；GET 查无回执为 `404 INFORMATION_NOT_FOUND`。已有有效相同消息重送和回执查询不受暂停／积压限制。无启用规则时仍可接收为 202，但不会启动模型；联调须预先建立启用规则和 Profile。

本期核心 E1／E2／E3 不使用附件。已有附件继续使用以下接口，不新增任意 URL 下载或文件路径读取入口：

| 来源上传路径（前缀 `/api/integrations/:sourceId`） | 请求／响应 |
| --- | --- |
| `POST /uploads` | JSON `{name,size}`，name 长度 1～240，size 为非负字节整数且不超过现有配置；201 返回 SourceUpload |
| `PUT /uploads/:uploadId/content` | `application/octet-stream` 文件字节，大小须与记录一致；200 返回 SourceUpload |
| `GET /uploads/:uploadId` | 200 返回 SourceUpload；uploadId 为 UUID |

```ts
type SourceUpload = {
  uploadId: string; sourceId: string; name: string; size: number;
  state: "pending" | "uploading" | "completed" | "failed"; createdAt: string;
  file?: { fileId: string; name: string; size: number; hash: string; createdAt: string };
};
```

仅 completed 上传可在通知中填写 uploadIds。上传失败／未完成不得作为成功附件继续发送；主要错误为 `404 UPLOAD_NOT_FOUND`、`409 UPLOAD_BUSY / UPLOAD_NOT_PENDING / UPLOAD_INCOMPLETE`、`413 FILE_TOO_LARGE`、`429 UPLOAD_CAPACITY`。完成上传的再次 PUT 返回原记录，不覆盖文件。默认上限仍为每文件 100 MiB、每消息 20 个附件，以现有部署配置为准。本期不调整这些限制。

附件去重比较有序的名称、大小、内容 hash，不比较上传 ID；更换上传 ID 不等于新消息。POST 先核验所引上传再判消息重复，查回执建议用 GET，不用失效附件引用重送。完整实现依据为 [接收路由](../../../experiments/harness-lab/src/server/background-routes.ts)、[接收服务](../../../experiments/harness-lab/src/background/service.ts) 和 [上传服务](../../../experiments/harness-lab/src/background/files.ts)。

## 3. 新增模拟查询 API 的公共约定

查询服务本地示例地址为 `http://127.0.0.1:4401`。所有查询要求独立的查询令牌 `Authorization: Bearer <查询令牌>`；由宿主按 `tokenEnv` 读取，不传给模型或浏览器。响应为 UTF-8 `application/json`。这里只定义只读 GET；测试推进／重置不作为公开业务 API。

设计中的 system.baseUrl 已包含 `/intel` 或 `/situation`。宿主按下表追加相对路径，不重复追加系统前缀；其余参数按本契约编码：

| 工具调用 | 选择的配置 | 追加路径 |
| --- | --- | --- |
| information_search | intel | `/reports` |
| information_read | intel | `/reports/:reportId`；reportId 编码为路径段，revision 进入 query |
| situation_query，mode=current | situation | `/objects` |
| situation_query，mode=changes | situation | `/changes` |

未配置的系统或工具与系统能力不匹配，在宿主拒绝，不尝试其他地址。systemId 和 mode 不透传为 HTTP query 参数。

### 参数与过滤

- 标识为不透明字符串，最长 128 字符；引用 `Ref` 为 `{systemId, objectType, objectId}`，三项必填。报告、对象的模拟 `revision` 为正整数，版本只在同一记录内比较。
- `objectRefs`、`areaIds` 在工具参数中是数组，在 HTTP query 中各编码为一个 JSON 数组字符串，再按 URL 规则编码；最多分别 20、10 项，提供时不得为空数组。`objectRefs` 的成员必须是完整三元组。
- 其他 query 参数为单个字符串；`limit` 是十进制整数，默认 20，范围 1～100。未知参数、重复同名参数、错误类型、无效范围返回 `400`，不忽略。
- 同一对象组／区域组内取任意命中，不同已提供条件组取交集。报告的对象过滤匹配其 `objectRefs`，态势过滤匹配对象自身 `ref`。`query` 最长 200 字符，去首尾空白后做不区分大小写的字面子串匹配；不做语义搜索。空白 query 视为未提供。
- `from/to` 为带时区的 ISO 时间，使用 `[from,to)`，允许单端开放；两端均有值时须 from < to。报告列表过滤 `observedAt`；变化列表过滤 `effectiveAt`；不能用发布时间、接收时间代替。
- 有时间过滤时，业务时间为 null 的记录不当成匹配项；`timeUnknownCount` 表示通过其他条件但无法判定时间的记录数。无时间过滤时返回这些记录并保留 null，该计数为 0。此数只针对当前获准资料。

`validTime:null` 表示有效时段未知；TimeRange 中的 null 端点仅表示来源明确没有该端限制，不表示时间缺失。比较已知有效区间时，开放端点按无界处理；时段未知时不能据此确定相交或无关。timeUnknownCount 按本次完整查询计算，各页相同，不是当前页条数。

例如以下未编码条件：

```json
{
  "objectRefs": [{"systemId":"situation","objectType":"road","objectId":"road-west-01"}],
  "areaIds": ["zone-west"],
  "limit": 20
}
```

对应请求路径：

```text
/intel/reports?objectRefs=%5B%7B%22systemId%22%3A%22situation%22%2C%22objectType%22%3A%22road%22%2C%22objectId%22%3A%22road-west-01%22%7D%5D&areaIds=%5B%22zone-west%22%5D&limit=20
```

### 响应结构与分页

以下类型用于说明契约，不是实现代码；未标 `?` 的字段必须存在，未知业务时间显式为 null。

```ts
type Ref = { systemId: string; objectType: string; objectId: string };
type TimeRange = { from: string | null; to: string | null };
type Page<T> = {
  systemId: "intel" | "situation";
  asOf: string;                  // 本来源已推进到的模拟业务时刻，不等于查询时间
  items: T[];
  limit: number;
  nextCursor: string | null;     // 同一查询的下一页
  hasMore: boolean;              // 等价于 nextCursor !== null
  timeUnknownCount: number;
};
```

`cursor` / `nextCursor` **只用于分页**：第一页省略 cursor，后续原样携带返回值，并保持其余条件和 limit 不变。游标是不透明值，不能自己拼接或解释；未知／条件不匹配返回 `400 INVALID_CURSOR`。同一数据阶段的排序稳定；模拟数据推进或重置使旧分页游标失效时返回 `409 CURSOR_STALE`，由调用方明确从第一页重新查询，不混合不同阶段的页。每个响应单独读取一致，但不同系统不保证共同快照。

本期不提供 total 数量，不把一页当成全部资料。所有分页接口都实现 limit，即使固定数据很小；用 limit=1 验证逐页访问。来源成功响应不静默截短正文；超过宿主 256 KiB 限制时作为查询错误处理，不交给模型一份假装完整的 JSON。

## 4. 特情报告

### GET /intel/reports

可选参数：`reportId`、`subjectId`、`objectRefs`、`areaIds`、`from`、`to`、`query`、`limit`、`cursor`。`reportId`、`subjectId` 均为精确匹配；query 匹配标题及正文。返回全部匹配修订的索引，按 `(reportId 升序, revision 升序)` 排序，不默认只取最新。

```ts
type ReportIndex = {
  reportId: string;
  subjectId: string;
  revision: number;
  title: string;
  summary: string;               // 来源提供的事实摘要，最多 1,000 字符；不含 Axon 影响结论
  objectRefs: Ref[];
  areaIds: string[];
  observedAt: string | null;
  publishedAt: string | null;
  validTime: TimeRange | null;
};
// 响应：Page<ReportIndex>
```

请求 `GET /intel/reports?reportId=report-west-01&limit=1`，在 E1 后返回：

```json
{
  "systemId": "intel", "asOf": "2026-10-01T09:20:00+08:00",
  "items": [{
    "reportId": "report-west-01", "subjectId": "report-west-01", "revision": 1,
    "title": "西区通道观测记录", "summary": "截至观测时刻未报告西区通道限制。",
    "objectRefs": [{"systemId":"situation","objectType":"road","objectId":"road-west-01"}],
    "areaIds": ["zone-west"], "observedAt": "2026-10-01T08:50:00+08:00",
    "publishedAt": "2026-10-01T08:55:00+08:00",
    "validTime": {"from":"2026-10-01T09:00:00+08:00","to":"2026-10-01T11:00:00+08:00"}
  }],
  "limit": 1, "nextCursor": "opaque-report-page-2", "hasMore": true, "timeUnknownCount": 0
}
```

后续请求保持 reportId 和 limit，增加 `cursor=opaque-report-page-2`，返回修订 2 和 `nextCursor:null, hasMore:false`。示例游标仅示意，联调必须使用服务实际返回值。完整历史查询不加任务时间窗，否则会漏掉 08:50 的既往观测。

### GET /intel/reports/:id

路径 id 为 reportId，按 URL 路径段编码；可选 `revision` 为正整数。省略时返回查询当时最新修订；未知报告或未知修订均 `404 NOT_FOUND`，不回退到其他版本。正文为 UTF-8 文本，最长 64,000 字符。

响应为 `{systemId, asOf, item}`，item 包含 ReportIndex 全部字段以及 `content`。请求 `GET /intel/reports/report-west-01?revision=2`：

```json
{
  "systemId":"intel", "asOf":"2026-10-01T09:20:00+08:00",
  "item": {
    "reportId":"report-west-01", "subjectId":"report-west-01", "revision":2,
    "title":"西区通道限制更新", "summary":"西区通道 09:20 至 10:10 临时受限。",
    "objectRefs":[{"systemId":"situation","objectType":"road","objectId":"road-west-01"}],
    "areaIds":["zone-west"], "observedAt":"2026-10-01T09:18:00+08:00",
    "publishedAt":"2026-10-01T09:20:00+08:00",
    "validTime":{"from":"2026-10-01T09:20:00+08:00","to":"2026-10-01T10:10:00+08:00"},
    "content":"本报告更新此前观测：西区通道在 09:20 至 10:10 临时受限。此前截至 08:50 的记录未报告此限制。"
  }
}
```

## 5. 态势对象与变化

### GET /situation/objects

可选参数：`objectRefs`、`areaIds`、`query`、`limit`、`cursor`。query 匹配对象名称；不接受 from/to/after，不提供任意历史时点快照。按 `(objectType, objectId)` 升序，返回当前数据阶段的对象最新版本。

```ts
type SituationObject = {
  ref: Ref;                     // systemId 必须为 situation
  name: string;
  revision: number;
  areaIds: string[];
  effectiveAt: string | null;
  validTime: TimeRange | null;
  properties: { availableCount: number; unit: "辆" } // resource；数量为非负整数
            | { memberRefs: Ref[] }                // area；固定成员关系
            | {};                                  // road；本期没有通行状态、坐标或拓扑
};
// properties 的结构由 ref.objectType 对应，禁止其他类型／属性。
// 响应：Page<SituationObject> & { unknownRefs: Ref[]; changeCursor: string }
```

`unknownRefs` 只列出请求 objectRefs 中本来源不存在的引用；没有命中区域／文本条件的已知对象不算未知。省略 objectRefs 时为 `[]`。对象过滤含其他 systemId 或不支持类型返回 `400 UNSUPPORTED_FILTER`，不能偷查其他系统。`changeCursor` 表示该态势数据阶段的变化流位置，可用于下一次 changes 的 after；不是分页游标。

请求 `GET /situation/objects?areaIds=%5B%22zone-west%22%5D&query=车辆&limit=20`，E2 后响应：

```json
{
  "systemId":"situation", "asOf":"2026-10-01T09:30:00+08:00",
  "items":[{
    "ref":{"systemId":"situation","objectType":"resource","objectId":"vehicles-west-01"},
    "name":"西区可用车辆", "revision":2, "areaIds":["zone-west"],
    "effectiveAt":"2026-10-01T09:30:00+08:00",
    "validTime":{"from":"2026-10-01T09:30:00+08:00","to":"2026-10-01T11:00:00+08:00"},
    "properties":{"availableCount":2,"unit":"辆"}
  }],
  "limit":20, "nextCursor":null, "hasMore":false, "timeUnknownCount":0,
  "unknownRefs":[], "changeCursor":"situation-seq-101"
}
```

### GET /situation/changes

可选参数：`after` **或** `from/to`，加上 `objectRefs`、`areaIds`、`query`、`limit`、`cursor`。after 与时间条件互斥；都不填则查模拟服务保留的全部变化。query 匹配变化后对象名称，对象／区域条件也按变化后对象过滤。本期变化只覆盖对象更新，不模拟新增、删除。

```ts
type SituationChange = {
  cursor: string;                 // 此条变化在来源流中的不透明位置
  effectiveAt: string | null;
  before: SituationObject;
  after: SituationObject;         // 与 before 同一 ref；revision 增加
};
// 响应：Page<SituationChange> & { unknownRefs: Ref[]; nextAfter: string | null }
```

after **只用于变化增量**，不接受 `afterCursor` 别名。它表示“此位置之后”，由来源返回，不能用对象 revision、时间或 sourceMessageId 替代。before/after 是该变化当时的完整版本；后续对象更新不得改写旧变化记录。

请求 `GET /situation/changes?after=situation-seq-100&limit=20`，E2 后响应中的 `items` 含一条变化：cursor 为 `situation-seq-101`、effectiveAt 为 `2026-10-01T09:30:00+08:00`；before 为车辆修订 1、数量 4、生效于 09:00，after 为上述修订 2、数量 2。响应结构示例：

```json
{
  "systemId":"situation", "asOf":"2026-10-01T09:30:00+08:00",
  "items":[{
    "cursor":"situation-seq-101", "effectiveAt":"2026-10-01T09:30:00+08:00",
    "before":{
      "ref":{"systemId":"situation","objectType":"resource","objectId":"vehicles-west-01"},
      "name":"西区可用车辆", "revision":1, "areaIds":["zone-west"],
      "effectiveAt":"2026-10-01T09:00:00+08:00",
      "validTime":{"from":"2026-10-01T09:00:00+08:00","to":"2026-10-01T11:00:00+08:00"},
      "properties":{"availableCount":4,"unit":"辆"}
    },
    "after":{
      "ref":{"systemId":"situation","objectType":"resource","objectId":"vehicles-west-01"},
      "name":"西区可用车辆", "revision":2, "areaIds":["zone-west"],
      "effectiveAt":"2026-10-01T09:30:00+08:00",
      "validTime":{"from":"2026-10-01T09:30:00+08:00","to":"2026-10-01T11:00:00+08:00"},
      "properties":{"availableCount":2,"unit":"辆"}
    }
  }],
  "limit":20, "nextCursor":null, "hasMore":false, "timeUnknownCount":0,
  "unknownRefs":[], "nextAfter":"situation-seq-101"
}
```

- 排序为来源流顺序，不按业务时间排序；晚到变化可以有更早的 effectiveAt。
- 中间页 `nextAfter:null`，使用 nextCursor 续页；最后一页才返回本次数据阶段的流位置 nextAfter。即使过滤后无匹配，末页仍可返回这个位置。不得跳过未读分页直接推进。
- 例如读取完 100 之后的变化，再请求 `after=situation-seq-101`：无新增则 `items:[], hasMore:false, nextCursor:null, nextAfter:"situation-seq-101"`。这不表示其他对象或其他时间范围没有历史资料。
- 增量位置与筛选条件共同决定可读范围；若要查看以前被其他条件排除的变化，应去掉 after 或指定历史时间窗。Axon 本期不维护自动轮询／同步检查点，由当前工具调用显式传参。
- 无法识别、超前或已失效的 after 返回 `400 INVALID_CHANGE_CURSOR`；不静默返回空列表。重置模拟实例后必须重新获取位置，测试脚本不得沿用前一次实例的游标。文中的 seq-100/101 是场景示意值，不要求重置后复用字面值。

## 6. 错误与宿主适配

新增模拟查询 API 的错误统一为非 2xx：

```json
{"error":{"code":"INVALID_CHANGE_CURSOR","message":"变化游标无效，请重新查询当前状态。"}}
```

| HTTP / code | 含义及宿主处理 |
| --- | --- |
| 400 / INVALID_ARGUMENT、UNSUPPORTED_FILTER | 参数不合法或不支持；告诉 Agent 修正条件，不丢弃该条件重试 |
| 400 / INVALID_CURSOR、INVALID_CHANGE_CURSOR | 分页或变化位置无效；两者不能混用 |
| 401 / UNAUTHORIZED；403 / FORBIDDEN | 外部凭证无效／拒绝访问；宿主返回安全错误，不暴露令牌，不回退未授权读取 |
| 404 / NOT_FOUND | 指定报告或修订不存在；与列表无匹配的 `200 items:[]` 区分 |
| 409 / CURSOR_STALE | 数据阶段变化，旧分页不能续用；明确重新开始查询 |
| 503 / UNAVAILABLE | 来源不可用；不能转换成空列表 |

未知对象以对象／变化列表中的 unknownRefs 表示；未知报告列表返回空，指定报告详情返回 404。本期服务不返回成功的半截正文或省略项；分页和 timeUnknownCount 明确说明当前返回的边界。

宿主以单次 15 秒超时和 256 KiB 响应上限限制 HTTP。网络失败、超时、超限、JSON／响应字段不合法分别返回 `CONTEXT_UNAVAILABLE`、`CONTEXT_TIMEOUT`、`CONTEXT_RESPONSE_TOO_LARGE`、`CONTEXT_INVALID_RESPONSE`；普通查询错误交回 Pi，供其调整条件或说明资料缺口。超限不自动截短；详情仍过大时明确本期无法完整读取。用户取消传播 AbortSignal，结束当前请求，不作为可继续的查询错误。以上不新增整项作业的调用次数或时限。

适配器选择已配置 baseUrl，验证来源 systemId、字段类型与引用，按固定工具参数构造请求；不跟随重定向到其他地址，不运行 shell，不读取 mock fixture。响应不能夹带 Axon taskId、席位 ID、推荐投递、预期影响或测试答案；本期模拟 schema 拒绝未定义业务字段。

Pi 成功工具结果的 content 保存 `{systemId, query, queriedAt, data}`：query 是已执行的规范化条件，queriedAt 是宿主真实查询完成时间，data 是上文成功响应，保留业务时间、版本、分页及实际正文。报告可派生 `intel:report:report-west-01@2` 这样的显示引用；依据仍以原生 toolCallId 和实际记录定位，不新建证据库。模拟 `asOf` 不替代 queriedAt；工具的 systemId / mode 是宿主选适配器所用，不作为同名 URL 参数盲目透传。

## 7. 页面目录接口

`GET /api/context/catalog` 无 query/body，使用现有登录会话鉴权。只返回当前席位可用的配置；已登录但未获准查询返回 `200 {"systems":[]}`。示例：

```json
{
  "systems": [
    {
      "id":"intel", "name":"模拟特情系统", "objectTypes":["report"],
      "capabilities":["information_search","information_read"],
      "areas":[{"id":"zone-west","name":"西区"},{"id":"zone-east","name":"东区"}]
    },
    {
      "id":"situation", "name":"模拟态势系统", "objectTypes":["road","resource","area"],
      "capabilities":["situation_current","situation_changes"],
      "areas":[{"id":"zone-west","name":"西区"},{"id":"zone-east","name":"东区"}]
    }
  ]
}
```

数组字段均必需，可为空。目录来自本期适配器能力和固定配置，不额外创建模拟目录接口，不因展示目录触发模型或外部数据查询。不返回 baseUrl、凭证、其他席位配置或授权外数据。未登录和失效身份沿用现有服务错误；它不提供权限管理或热更新能力。

## 8. 联调与验证边界

- 先测 HTTP 契约：认证、原样重送／冲突、过滤交集、历史指定版本、limit=1 分页、after 增量及空结果、无效／过期游标、未知时间／对象、来源不可用与取消。再测 Pi 主动查询和综合判断。
- 除主场景外，单独的接口测试数据含同一资源的两条变化（修订 1→2、2→3）以及 observedAt 为 null 的报告。前者用 limit=1 验证中间页 nextAfter 为 null、末页推进与顺序；后者验证有时间条件时排除并计入 timeUnknownCount、无时间条件时带 null 原样返回。这些数据不混入主研判场景，不增加业务任务或模型用例。
- 检查通知、全部查询响应和 Agent 可读资源中没有测试预期答案。对照答案只在测试脚本和验收记录中，不能作为 Profile、Skill、指令文件或附件提供给模型。
- [场景 S7](research/simulation-scenario.md) 在外部数据不变时交换两个任务的车辆需求，检查不足判断随真实任务条件改变。固定匹配代码、预写结论或同一条模型回答不能代替这一验证。
- 记录实际 HTTP 请求条件／状态、工具返回、fixture 阶段及模型结论，不记录认证头。测试控制端与对照答案不得挂载到 Agent 工作区或沙盒。
- 本期证明有限数据范围内的对象关联、历史比较、时间及数量条件分析；不据此声称已验证道路拓扑、完整地理影响或真实业务中的普遍准确性。
