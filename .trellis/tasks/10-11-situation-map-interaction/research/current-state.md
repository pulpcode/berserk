# 现状核对与设计依据

核对日期：2026-10-11；本地基线 `aa58851`。本文件只记录设计依据，不是本期验证结果。

## 1. 当前实现

以下代码路径相对仓库根目录。

| 位置 | 核对结论 |
| --- | --- |
| `experiments/harness-lab/scripts/mock-context/server.ts` | 独立 HTTP 查询服务；报告、对象、变化目前在内存；reset/advance 推进固定场景；没有地图或通用状态编辑页面 |
| `experiments/harness-lab/scripts/mock-context/main.ts` | 默认 4401，使用查询令牌；可选本机 Unix socket 控制；当前控制不是已公开的 Web API |
| `experiments/harness-lab/scripts/mock-context/fixtures.ts` | road.properties 为空，resource 为 availableCount，area 为 memberRefs；无 geometry；报告中描述道路限制/恢复不等于结构化道路状态已存在 |
| `experiments/harness-lab/src/contracts/context.ts` | 已有完整对象引用、时间、修订、查询 envelope、分页、变化游标；可扩展可选位置字段 |
| `experiments/harness-lab/src/context/validation.ts` | 字段严格校验，新增 geometry/道路状态须同时改解析，不能只由模拟源自行添加 |
| `experiments/harness-lab/src/context/service.ts` | 已统一服务身份/席位授权、系统适配和 HTTP 访问；catalog 区域仍写死为西区/东区 |
| `experiments/harness-lab/src/server/app.ts` | 已有浏览器 catalog；尚无地图只读查询路由；静态页面路径需增加地图与控制页 |
| `experiments/harness-lab/src/web/ContextEvidence.tsx` | 可解析实际工具返回的引用和修订，适合作为地图定位入口；目前只展示文字 |
| `experiments/harness-lab/src/web/ChatMessage.tsx`、`information-ui.tsx` | 前者使用 react-markdown 的默认链接行为，后者将链接渲染为普通文字；两处需复用有依据核对的地图链接渲染，不应假定现状已经一致 |
| `experiments/harness-lab/src/web/TaskInformation.tsx` | 当前为相关信息/任务说明页签；沿用新 UI 加态势入口，不恢复旧交互 |
| `experiments/harness-lab/src/pi/composer-input.ts` | Skill/Agent 显式选择已有原生 custom-message 记录与严格解码；新增对象资料需兼容旧历史及取消边界 |

当前没有通用超级管理员权限位。总体席的公开任务管理、工作总览、来源管理等权限有各自边界；本期模拟控制以明确启用的测试配置和对应来源管理授权为依据，不借用模型设置权限。

## 2. 外部技术依据

- [MapLibre GeoJSONSource](https://maplibre.org/maplibre-gl-js/docs/API/classes/GeoJSONSource/)：支持 GeoJSON 数据源和更新。拟作为渲染层；选用它不意味着具备地图数据或路线规划服务。
- [MapLibre 栅格底图示例](https://maplibre.org/maplibre-gl-js/docs/examples/add-a-raster-tile-source/)：同一渲染器可使用在线栅格底图并叠加 GeoJSON 态势，无须为在线底图更换前端框架。
- [RFC 7946](https://datatracker.ietf.org/doc/html/rfc7946)：GeoJSON 位置使用经度、纬度顺序及 WGS84；本期选用其中 Point、LineString、Polygon 子集。200 点等限制属于本项目验证范围，不是标准限制。
- [OpenStreetMap 瓦片使用政策](https://operations.osmfoundation.org/policies/tiles/)：本期按小规模人工浏览接入 Standard 瓦片，遵循署名、浏览器缓存与 Referer 要求；自动化地图测试改用受控替身，在线服务不作为有可用性承诺的业务后端。
- [OpenStreetMap 版权说明](https://www.openstreetmap.org/copyright)：地图数据开放不等于任意在线服务均无使用限制；页面保留数据来源署名。

本机 `~/workspace/boat` 已核对：`road-demo/src/OfflineMap.tsx` 使用 MapLibre，并有本地 worker、图层与 GeoJSON 更新模式；其 `route-map-service` 负责离线底图和路网能力。`boat-demo`、`strike-demo` 则使用 Leaflet。本期参考 MapLibre 组件经验，按用户选择使用在线底图，不引入 boat 的离线地图部署和路线服务。

使用 UI/UX 技能核对导航保持、键盘操作、状态反馈与地图/详情并排交互；沿用项目现有视觉系统，桌面优先。不因技能通用模板扩张到手机端。

## 3. 设计判断

独立事实来源、共用只读查询、三入口共用地图、模型使用结构化资料，是依据当前代码和本轮需求提出的方案，并非声称某个竞品采用完全相同实现。

新增模拟持久化用于重启后继续同轮测试；新增对象资料记录用于解释人员显式选择了哪些来源版本。没有为未来路网、任意权限体系或自动恢复引擎预建状态。

回答定位复用结构化查询依据与 Markdown 链接，由宿主提供可用对象链接，不建立额外引用事实库。真实底图与合成业务态势分层，既增强空间观感，又保持测试条件可控。
