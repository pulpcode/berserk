# 地图底图验收记录

2026-10-15；独立 worktree `/Users/lau/.codex/worktrees/map-basemaps/berserk`，分支 `codex/map-basemaps`，基于 `main@efe2fb6`。主工作区的并行未提交改动未纳入本分支；boat 仅只读参考。实现已完成，按用户要求在独立分支提交，暂不合并主分支。

## 实现与状态约束

- 保留一个 MapLibre 与 TerraDraw 实例，底图只管理 `basemap:*`，业务图层使用 `business:*`，标绘不再依赖具体底图层。切换/重试不调用 setStyle，不改业务坐标、ID、版本与持久化。
- 影像、浅灰路网、影像加主要道路与地名的混合视图。业务点线面保留既有颜色并加入白色描边/文字光晕。实图发现实线 `[1,0]` dash 配置在切换后不绘制，已改为省略该属性并用真实像素回归验证。
- 覆盖范围、原生缩放、坐标约定与署名均来自配置。当前代来源错误、15秒超时、重试与快速切换隔离；慢源完成后清除超时，明确HTTP错误保留到重试。
- 用户点击选择才写现有 localStorage。稳定 userId 作用域跨重新登录保留，测试席位独立；原有草稿/缓存的 viewId 隔离不变。场景只通过初始 defaultView 影响默认选择。

## 检查结果

- `npm run typecheck`：通过。
- `npm run lint`：通过，含依赖边界检查。
- `npm run build`：通过；只有已有的大 chunk 提示。
- 相关单测：10个文件共79项通过（含底图27项、API偏好作用域5项）。
- 原有及新增地图/标绘浏览器回归：完整17项通过。收尾状态与偏好修正后，3项底图重点用例再次通过，新增重新登录/用户隔离1项通过，共18项不同用例通过。
- 自动回归验证：MapLibre canvas实例、中心/缩放/倾斜/方向、业务及标绘源数据、选择、图层可见性保持；已有持久版本保持；线/面跨切换和HTTP失败重试后可完成；首个点坐标保留；配置刷新不覆盖选择；区域覆盖外提示；5次视图切换后的实际红色像素仍存在；420px桌面地图面板控件无重叠。
- 回归夹具为本地栅格和合成MVT，正常自动回归不请求公开OSM栅格。真实底图验收使用独立临时账号/数据库、合成业务对象，模型调用0次。

运行命令（在 experiments/harness-lab）：

```sh
npm run test -- tests/map-basemaps.test.ts tests/situation-host.test.ts tests/annotations.test.ts tests/annotations-acceptance.test.ts tests/annotation-map-evidence.test.ts tests/context-http.test.ts tests/situation-map-ui.test.ts tests/situation-source.test.ts tests/situation-trial.test.ts tests/web/api.test.ts
AXON_E2E_PORT=5197 npx playwright test tests/e2e/annotations.spec.ts tests/e2e/situation-map.spec.ts --workers=2
AXON_E2E_PORT=5197 npx playwright test tests/e2e/annotations.spec.ts tests/e2e/situation-map.spec.ts tests/e2e/access.spec.ts --grep 'basemap|solid annotation' --workers=2
BASEMAP_EVIDENCE_DIR=.local/basemap-acceptance npx tsx scripts/probe-basemaps.ts
```

## 真实源与截图

默认 Esri World Imagery + OpenFreeMap 全球 OpenMapTiles 兼容矢量/字形。影像配置原生0–19级，路网原生0–14级；以上级别为放大显示。三种视图共18组实际加载成功，场景截图均无加载错误；实际检查城区道路、港口码头及近海显示。混合视图复用已加载来源，部分视图无需新增网络请求。合成业务对象仅用于可读性和状态测试，不声称其位置是真实救援任务或道路证据。

| 地点 | 中心经纬度 / 缩放 | 视图 | 截图 |
| --- | --- | --- | --- |
| 青岛城区 | [120.382, 36.066] / 14 | 混合 | [查看](/Users/lau/.codex/worktrees/map-basemaps/berserk/experiments/harness-lab/.local/basemap-acceptance/qingdao-city-hybrid.png) |
| 青岛城区 | [120.382, 36.066] / 14 | 影像 | [查看](/Users/lau/.codex/worktrees/map-basemaps/berserk/experiments/harness-lab/.local/basemap-acceptance/qingdao-city-imagery.png) |
| 青岛城区 | [120.382, 36.066] / 14 | 路网 | [查看](/Users/lau/.codex/worktrees/map-basemaps/berserk/experiments/harness-lab/.local/basemap-acceptance/qingdao-city-road.png) |
| 青岛近海 | [120.405, 35.97] / 12 | 混合 | [查看](/Users/lau/.codex/worktrees/map-basemaps/berserk/experiments/harness-lab/.local/basemap-acceptance/qingdao-offshore-hybrid.png) |
| 青岛近海 | [120.405, 35.97] / 12 | 影像 | [查看](/Users/lau/.codex/worktrees/map-basemaps/berserk/experiments/harness-lab/.local/basemap-acceptance/qingdao-offshore-imagery.png) |
| 青岛近海 | [120.405, 35.97] / 12 | 路网 | [查看](/Users/lau/.codex/worktrees/map-basemaps/berserk/experiments/harness-lab/.local/basemap-acceptance/qingdao-offshore-road.png) |
| 青岛港口 | [120.202, 36.012] / 14 | 混合 | [查看](/Users/lau/.codex/worktrees/map-basemaps/berserk/experiments/harness-lab/.local/basemap-acceptance/qingdao-port-hybrid.png) |
| 青岛港口 | [120.202, 36.012] / 14 | 影像 | [查看](/Users/lau/.codex/worktrees/map-basemaps/berserk/experiments/harness-lab/.local/basemap-acceptance/qingdao-port-imagery.png) |
| 青岛港口 | [120.202, 36.012] / 14 | 路网 | [查看](/Users/lau/.codex/worktrees/map-basemaps/berserk/experiments/harness-lab/.local/basemap-acceptance/qingdao-port-road.png) |
| 悉尼城区 | [151.2093, -33.8688] / 14 | 混合 | [查看](/Users/lau/.codex/worktrees/map-basemaps/berserk/experiments/harness-lab/.local/basemap-acceptance/sydney-city-hybrid.png) |
| 悉尼城区 | [151.2093, -33.8688] / 14 | 影像 | [查看](/Users/lau/.codex/worktrees/map-basemaps/berserk/experiments/harness-lab/.local/basemap-acceptance/sydney-city-imagery.png) |
| 悉尼城区 | [151.2093, -33.8688] / 14 | 路网 | [查看](/Users/lau/.codex/worktrees/map-basemaps/berserk/experiments/harness-lab/.local/basemap-acceptance/sydney-city-road.png) |
| 悉尼近海 | [151.33, -33.89] / 12 | 混合 | [查看](/Users/lau/.codex/worktrees/map-basemaps/berserk/experiments/harness-lab/.local/basemap-acceptance/sydney-offshore-hybrid.png) |
| 悉尼近海 | [151.33, -33.89] / 12 | 影像 | [查看](/Users/lau/.codex/worktrees/map-basemaps/berserk/experiments/harness-lab/.local/basemap-acceptance/sydney-offshore-imagery.png) |
| 悉尼近海 | [151.33, -33.89] / 12 | 路网 | [查看](/Users/lau/.codex/worktrees/map-basemaps/berserk/experiments/harness-lab/.local/basemap-acceptance/sydney-offshore-road.png) |
| 悉尼 Botany 港 | [151.218, -33.975] / 14 | 混合 | [查看](/Users/lau/.codex/worktrees/map-basemaps/berserk/experiments/harness-lab/.local/basemap-acceptance/sydney-port-hybrid.png) |
| 悉尼 Botany 港 | [151.218, -33.975] / 14 | 影像 | [查看](/Users/lau/.codex/worktrees/map-basemaps/berserk/experiments/harness-lab/.local/basemap-acceptance/sydney-port-imagery.png) |
| 悉尼 Botany 港 | [151.218, -33.975] / 14 | 路网 | [查看](/Users/lau/.codex/worktrees/map-basemaps/berserk/experiments/harness-lab/.local/basemap-acceptance/sydney-port-road.png) |

[三栏布局](/Users/lau/.codex/worktrees/map-basemaps/berserk/experiments/harness-lab/.local/basemap-acceptance/desktop-three-pane.png) · [窄地图面板](/Users/lau/.codex/worktrees/map-basemaps/berserk/experiments/harness-lab/.local/basemap-acceptance/desktop-narrow-map.png) · [区域覆盖提示（本地夹具）](/Users/lau/.codex/worktrees/map-basemaps/berserk/experiments/harness-lab/.local/basemap-acceptance/regional-basemap-coverage.png) · [切换后标绘保留](/Users/lau/.codex/worktrees/map-basemaps/berserk/experiments/harness-lab/.local/basemap-acceptance/basemap-retained-annotations.png)

[综合机器记录](/Users/lau/.codex/worktrees/map-basemaps/berserk/experiments/harness-lab/.local/basemap-acceptance/results.json) 包含18组ready状态、渲染图层、请求URL/HTTP状态、场景中心/缩放、页面错误和模型调用次数。中国/澳大利亚/最终布局的原始JSON另存同目录。截图与原始记录保存在被Git忽略的 `.local`，没有提交大图或真实业务数据。

## 实图发现与修复

1. 青岛港混合视图暴露实线丢失：修正MapLibre实线配置；再次检查截图并加入像素断言。
2. 420px地图面板中绘制条与底图切换/署名可能重叠：按桌面容器宽度排列并加入矩形相交断言。
3. 慢请求超过15秒后即使完成仍残留超时：区分超时与明确错误，仅当前来源成功完成可清除超时。最终悉尼三栏及窄面板无错误提示，超过原生14级时保留正常细节上限说明。
4. 新校验过度拒绝署名URL的fragment：恢复新旧署名链接合法片段支持，瓦片/字形端点仍拒绝fragment。
5. 初版登录viewId会在重登后换key：仅视觉偏好使用稳定userId，实际登录两用户与返回原用户已通过。

测试过程的初次失败包括验收脚本等待TileJSON过早、HMR造成截图取景重置、测试页自动打开无WebGL侧栏与测试按钮竞争，以及账号回归缺少地图目录夹具；均修正测试同步/夹具后重跑通过。

## 仍需部署配置与实际限制

- 公共服务已在当前执行网络验证；没有从中国实际部署网络进行连通性验证，也没有验证中澳所有区域、所有缩放。部署时按本地网络复验，必要时替换区域服务。
- 区域源需填写准确URL、WGS84/Web Mercator XYZ、覆盖四至、原生缩放、署名与可跨域访问的字形/瓦片接口。GCJ-02、BD-09、TMS等不会自动纠偏。
- 首版每份配置一套影像+路网。中国/澳大利亚可分别配置区域服务或提供实际覆盖两地的联合服务；未建两国全量生产线，也未把boat有限区域包当全域。
- Esri海面分辨率、图像年代、拼接与颜色因位置不同；它不提供航海图/潮汐/实时海况。中国和澳大利亚的后续区域高精度影像需要自行配置。
- 旧单栅格配置仍可读；若原地址是OSM路网，旧栅格内容将原样进入影像槽位，建议部署迁移新map对象以匹配视图名称与准确覆盖。

配置入口、完整JSON和数据源说明见 [map-basemaps.md](/Users/lau/.codex/worktrees/map-basemaps/berserk/experiments/harness-lab/docs/map-basemaps.md)。
