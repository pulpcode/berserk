# 底图分支合并后的空间分析方案可行性复核

2026-10-15。结论：第一阶段方案仍可行，Skill → Pi 工具 → 现有 Node 后端 → 计算库 → 地图结果的核心结构不变。新底图没有改变分析输入的业务几何契约；前端接入需要补齐明确的层序、点击、定位和文字约定。

本轮执行范围是提交现有规划、合并指定分支、检查既有代码和更新方案。没有实现空间分析功能、修改底图产品代码、运行真实模型或部署。任务保持 planning。

## 1. Git 基线与合并范围

| 项目 | 结果 |
| --- | --- |
| 目标分支 | codex/agent-map-spatial |
| 规划提交 | 8b6029c：保存第一阶段范围、架构、方法规则及评测方案 |
| 合入来源 | codex/map-basemaps@a79f1ae，包含 05ea07d 底图切换及 a79f1ae 混合细路显示修正 |
| 合并提交 | 0e5e457，无冲突 |
| 本轮只读核查的主线 | main@7c43e45；包含 d79a561 结果投影实现与新的查询范围规划 |
| 未执行 | 合并 main、修改其他 worktree、推送远端、实现空间分析 |

合并后 `experiments/harness-lab` 与 `.trellis/spec` 相对 a79f1ae 没有差异。底图源分支的产品代码原样进入本分支；本轮新增内容均为本任务规划或复核资料。

## 2. 代码依据与方案影响

以下路径相对仓库根目录，代码依据为 0e5e457。

| 核查点 | 实际代码 | 对空间分析的影响 |
| --- | --- | --- |
| 坐标和几何 | `src/contracts/context.ts` 的 SituationGeometry 未改变；`src/contracts/map.ts:1` 区分 WGS84 业务坐标与 Web Mercator XYZ 瓦片 | 继续使用业务 GeoJSON 经纬度计算，无需因切换底图重投影或改动业务坐标 |
| 地图生命周期 | `src/web/situation/MapCanvas.tsx:29` 的地图创建 effect 不再依赖 config；第 80 行独立更新底图 | 可以增加独立分析运行时，切换视图无需重建分析层或绘制器 |
| 图层隔离 | `src/web/situation/basemap-runtime.ts:24` 只管理 basemap:*；`basemap-style.ts:3` 定义 business:anchor | 分析采用 analysis:*，位于底图上方，不使用动态底图层 ID 作为锚点 |
| 标绘契约 | `src/web/annotations/map-runtime.ts:30` 改用固定锚点；自身只清理持有的标绘图层和源 | 新分析层不会自动成为标绘；仍通过既有草稿服务显式保存 |
| 点击处理 | `MapCanvas.tsx:69` 根据业务层及标绘属性识别命中；标绘另有点击监听 | 分析结果需独立身份和明确优先级，避免误选标绘或被空白分支清选；这是待实现适配，不是已出现的分析功能缺陷 |
| 视角控制 | `MapCanvas.tsx:46` 的 focusRequest/deferFocus 与标绘 fit 分工 | 分析定位接入现有协调，结果到达不触发自动抢焦点 |
| 文字依赖 | `basemap-runtime.ts` 仅在安装路网时 setGlyphs；标绘文字使用 DOM Marker | 纯影像模式不能假定字体已由道路初始化；分析文字优先复用现有标记方式，或明确共用字体及降级 |
| 底图失败/覆盖 | sourceNotices 依据底图元数据，重试只重建底图资源 | 分析输入完整性独立判断；底图不可用或覆盖外不表示授权业务数据不存在 |

上表 `src/` 均位于 `experiments/harness-lab/`。这些代码证据支撑架构兼容性，不能证明尚未开发的分析图层与交互已经验收。

## 3. 保留的架构和需要适配的部分

**保持不变**：既有 Pi 循环、受控 Skill 加载、固定分析操作、ContextService/AnnotationService 读写边界、GeoJSON/WGS84 输入、候选完整性和版本校验、结果引用、显式保存以及本期不做路网/专业决策。

**前端适配约定**：

1. 分析运行时与底图、标绘分别管理自己的源和图层；沿用同一 MapLibre，销毁时只清理自己的资源。
2. 分析填充放在 business:anchor 上方和业务对象下方；明确描边、标绘、编辑控制点的顺序，并验证刷新后层序。
3. 分析点击按所属图层识别，不复用标绘 group/objectId；协调已有点击监听，绘制中不抢占操作。
4. 通过既有定位意图处理分析结果定位，避免额外自动 fitBounds；纯影像首开可显示分析文字。
5. 底图加载、覆盖、原生细节提示与分析来源、完整性提示分别处理。

这些约定已写入设计第 9.3 节和实施步骤 4；本轮没有编写运行时或修改接口。

## 4. 底图数据与分析数据的边界

当前默认配置使用 Esri World Imagery 和 OpenFreeMap 的 OpenMapTiles 兼容矢量源。混合样式随缩放显示已有细路；配置中的路网原生最高 z14，继续放大不代表新增分析精度或完整业务对象。

这些瓦片目前只进入 MapLibre 的显示路径，不是 ContextService 的授权空间来源，也不具备本方案要求的业务对象引用、修订和候选完整性。第一阶段继续读取标绘与已接入业务数据，不以 queryRenderedFeatures 获得“全部道路”，也不因底图含矢量路网就引入路径规划。

切换影像、路网和混合视图不会主动更换计算输入。只有用户另行选择了业务来源、对象或版本，才形成不同的分析输入；相同输入快照及算法应保持相同结果。

## 5. 尚未同步的主线依赖

- **map-result-projection**：d79a561 已在 main，但不是当前 HEAD 的祖先。设计依赖的 `src/pi/annotation-results.ts`、content/details 分工和相关历史取证适配不能假定已经在本 worktree 中可用。正式空间分析实施前，应同步相关已提交主线改动并处理共享规范和测试冲突。
- **map-query-scope**：main@7c43e45 已将 query.scope 收窄为隔离候选实验，counts→changeCounts 暂缓。空间分析不等待候选字段，也不提前使用新名称。自身结果中所需的候选范围和计算完整性根据实际输入、分页、版本产生，并在接口冻结时核对已有契约。

这两项已经在方案中标明。底图整合本身没有阻止空间分析建设；未同步主线属于实施基线准备事项，不需要在本轮启动功能开发。

## 6. 本轮验证与证据限制

| 检查 | 本轮结果 |
| --- | --- |
| 合并冲突 | 无；merge 提交正常完成 |
| 产品差异 | 合并后 harness-lab 与底图源提交 a79f1ae 一致 |
| TypeScript | `tsc --noEmit` 通过 |
| 既有相关测试 | 四个文件共 48 项通过：map-basemaps、web/api、annotation-map-evidence、situation-map-ui |
| 产品实现 | 无新增空间分析代码，无依赖安装 |
| 浏览器/公开瓦片/真实模型 | 本轮未运行；不将源分支旧验收报告算作本轮结果 |

当前 worktree 没有 node_modules。验证从合并提交导出仅含已跟踪 harness-lab 文件的隔离快照到 `/private/tmp/spatial-merge-check-mjv_hflt`，复用底图 worktree 已安装的依赖；测试缓存保留在临时目录，没有修改其他会话的代码或依赖。TypeScript 与测试命令分别为：

```bash
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run tests/map-basemaps.test.ts tests/web/api.test.ts tests/annotation-map-evidence.test.ts tests/situation-map-ui.test.ts
```

底图源分支已有 [原始验收记录](../../10-15-map-basemaps/research/verification.md) 和 [细路修正验收记录](../../10-15-map-basemaps/research/hybrid-detail-verification.md)，可作为其已完成工作的背景。空间分析实现后仍需执行 [实施计划](../implement.md) 中三种底图、绘制中切换、失败重试、分析结果显示/保存及 Skill 效果评测。

当前只能确认架构兼容、基线类型检查和上述既有测试通过；计算精度、分析图层交互及 Skill 效果继续属于待实施、待验证内容。
