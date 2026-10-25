# 调研证据与采用记录

整理日期：2026-10-24；方案同步更新：2026-10-25（V1.1）。代码基线：`6ce86513022350fb752eaa3dc04a96a5d2d82a6e`。以下均为规划依据，不代表已实现。

## 1. 讨论结论

- 用户先要求独立 worktree，随后调研消防车、救护车、救援舰船和冲锋舟图标。
- 通用彩色/卡通图标不符合主方向；进一步查到消防专业标号规范。
- 用户先要求形成方案，随后重开工作区讨论；2026-10-25 已明确确认“实时态势和标绘共用一张地图，需要时展开标绘工具”，首期不拆页面。
- 本轮要求更新原方案供审阅，明确暂不改代码；该要求优先于任何默认开发流程。
- 本次不再制作替代风格，不修改实际应用，不启动实现。

## 2. 外部依据

1. [应急管理部公告（2020年第6号）](https://www.mem.gov.cn/gk/zfxxgkpt/fdzdgknr/202101/t20210118_377300.shtml)：发布 XF/T 3013—2020，实施日期 2021-05-01。
2. [XF/T 3013—2020 官方原文 PDF](https://www.mem.gov.cn/gk/zfxxgkpt/fdzdgknr/202101/W020210118711682130047.pdf)：适用于常用标号及相关图形系统开发应用；第 4 章规定颜色、方向、线型及注记，表 2/3 提供相关符号。上一轮已下载并查看 PDF 印刷页 1–3、7–12；文件为图像型，不能以空文本抽取结果断言没有某符号。
3. [NAPSG 应急符号体系](https://www.napsgfoundation.org/symbology)：用于补充扩展方法，公开资源标示 CC BY 4.0；如实际采用素材，需逐项记录来源及署名。不将国外符号直接冒称国内标准。
4. [FEMA ICS Training Reference Guide](https://training.fema.gov/emiweb/is/icsresource/assets/ics_training_reference_guide.pdf)：共同态势图用于持续更新并共享关键信息；据此区分态势组织与标绘操作。
5. [ArcGIS 应急态势系统实践](https://architecture.arcgis.com/en/industry-and-tech-patterns/emergency-management-lens/systems/situational-awareness.html)：多来源汇总及按决策需要呈现。本项目借鉴其组织方法，不引入 ArcGIS 产品依赖。
6. [MapLibre 官方图标示例](https://maplibre.org/maplibre-gl-js/docs/examples/add-an-icon-to-the-map/)：注册图像并使用 symbol 图层。项目实际版本仍以 package.json 为准，不能把官网当前示例的版本号当作升级授权。

标准适用性及图形语义在实施样张阶段逐条核验。本提案未宣称已认证全面符合消防标准，也未查证存在可直接替换现有框架的完整官方 SDK。

## 3. 首批标准条目索引

| 标号 | 标准条目 |
| --- | --- |
| 水罐消防车 | 6.2.1 |
| 泡沫消防车 | 6.2.2 |
| 干粉消防车 | 6.2.5 |
| 泵浦消防车 | 6.2.8 |
| 云梯消防车 | 6.2.10 |
| 登高平台消防车 | 6.2.11 |
| 举高喷射消防车 | 6.2.12 |
| 抢险救援消防车 | 6.2.13 |
| 化学事故抢险救援消防车 | 6.2.14 |
| 化学洗消消防车 | 6.2.15 |
| 照明消防车 | 6.2.16 |
| 通信指挥消防车 | 6.2.17 |
| 排烟消防车 | 6.2.18 |
| 供水消防车 | 6.2.23 |
| 救护车 | 6.2.30 |
| 消防直升机 | 6.2.35 |
| 消防无人机 | 6.2.36 |
| 消防艇 | 6.2.37 |
| 战斗员 | 6.1.21 |
| 集结地 | 6.1.27 |

冲锋舟、救援舰船暂按“独立应用扩展需求”处理。尚未完成标准全文中的适用范围核验，不能断言标准完全没有对应表达；先核对，后确定扩展样张的具体来源。

## 4. 代码证据

以下路径相对仓库根目录，行号对应上述基线。

| 文件位置 | 已确认行为 | 方案影响 |
| --- | --- | --- |
| `src/contracts/annotations.ts:6` | AnnotationStyle 仅有 circle/square/triangle 等有限样式 | 需要受控 symbolId，保留旧字段含义 |
| `src/contracts/annotations.ts:10` | Feature 有几何、attributes、sourceRefs，无信息性质字段 | 新增可选 informationRole，旧数据缺省不推断 |
| `src/web/annotations/FeatureEditor.tsx:17` | 表单重新构造 style 后保存 | 必须保证新字段不在旧编辑路径丢失 |
| `src/web/annotations/FeatureEditor.tsx:27` | 点符号选项仅三个基本形状 | 增加目录选择及专业属性 |
| `src/web/annotations/map-runtime.ts:44` | 透明 point 命中层，HTML Marker 绘制图形 | 增加 symbol 渲染需同时处理点击命中 |
| `src/web/annotations/map-runtime.ts:64` | 已使用 Terra Draw 点线面和选择模式 | 复用几何编辑，不重写画图引擎 |
| `src/web/situation/MapCanvas.tsx:44` | 单独 annotation runtime | 工具开合、来源刷新复用地图实例与业务层 |
| `src/web/situation/MapCanvas.tsx:93` | 来源点目前使用通用圆点 | 按可信类型解析，缺类型保留通用表达 |
| `src/web/annotations/AnnotationWorkspace.tsx:43` | canWrite 基于 session、binding、archived | 面板展开与实际写入不能突破原权限 |
| `src/web/annotations/AnnotationWorkspace.tsx:88` | finish 通过 apply 保存点/线/面 | 放置专业点需带目录与表单字段形成一致保存 |
| `src/annotations/validation.ts:65` | style 严格白名单 | 新字段需服务与 Pi 同步 |
| `src/annotations/validation.ts:74` | feature 严格白名单 | 新语义字段不能仅在前端附加 |
| `src/pi/annotation-tools.ts:40` | TypeBox style 同样限定三种点形状 | 从统一目录生成受控工具选项 |
| `src/annotations/service.ts:419` | 从来源复制精确几何及 sourceRef；刷新只更新约定字段 | 不能把复制快照等同实时对象，刷新需保留新增字段 |
| `src/contracts/context.ts:43` | SituationObject 现有 properties 以道路/汇总/区域为主 | 不假设已有装备状态、航向及 GPS |
| `src/context/validation.ts:78` | 来源严格接受 road/resource/area；resource 为 availableCount + 辆 | 本期不伪造船舶/单车类型，不扩外部业务协议 |
| `src/web/situation/map-data.ts:40` | 状态来自可用车辆数或道路通行性 | 无单车状态时应明确未提供 |
| `src/web/situation/SituationView.tsx:68` | 约每 15 秒重查来源，另处理可见性及取消 | 保留既有刷新并与工具开合隔离；不是单车 GPS 接入证据 |
| `src/web/situation/SituationView.tsx:79` | 失败时提示已加载内容可能过时 | 复用失败保留语义 |
| `src/web/situation/SituationView.tsx:106` | 来源详情已有生效时间、有效期、查询时间、资料截止时间 | 调整信息层级，避免再造时间字段 |

代码文件实际位于 `experiments/harness-lab/` 下。规范依据为 `.trellis/spec/backend/map-annotations.md`、`situation-map.md`、`spatial-analysis.md` 及前端 harness 规范。

## 5. 与预览的差异说明

- 最新确认的是单地图与按需标绘工具。旧 `approved-preview.html` 的双模式和中间方案的双页面仅为历史探索，不作为实现要求。
- 最新预览位置：`/Users/lau/.codex/visualizations/2026/10/23/01a167d6-3399-7fe0-8171-de6a6ce4dca4/incident-workspace-preview.html`。该文件是对话展示内容，不复制进产品；任务 PRD 与设计才是实现依据。
- 最新预览底图使用公开地理数据，位置、设备和轨迹均为模拟；实际产品使用既有底图及获准来源，不能把车辆数量汇总伪装成单车。
- 示意图标与蓝/橙/紫辅助色用于辨识交互层次；正式标准图形、颜色和方向逐项核验，生命周期用标签表达。
- 生产打开工具不自动创建草稿/版本；同一上下文收起后保留已有草稿、属性及未完成输入。预览为了演示创建的本地草稿和计时器不属于服务契约。
- 保存、发布、采用及冲突必须复用真实服务；面板展开不暂停既有来源刷新，也不新增 GPS/AIS 接入。
- 宽窗口停靠工具、收起释放地图空间，窄桌面窗口复用折叠区域或下置；保持地理中心和缩放，不照搬固定像素尺寸或预览自动重新框图逻辑。

## 6. 规划自检

已完成：用户目标与范围归纳、单地图交互决策落实、代码证据核对、标准/扩展区分、验收映射、兼容与并行风险整理。技术未知限定为素材逐项核验及接入细节，不改变本期用户行为。

未完成且本轮不执行：素材最终制作、应用代码、测试运行、用户对本版方案的实施批准。
