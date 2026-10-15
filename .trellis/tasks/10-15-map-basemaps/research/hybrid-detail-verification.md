# 混合视图细路修复验收（2026-10-15）

本轮基于 05ea07d，在 codex/map-basemaps 独立 worktree 开展，按用户要求暂不提交、不合并。

- 原因：原混合样式仅筛选 motorway/trunk/primary/secondary/tertiary，放大也不显示 minor/service/track/path。
- 修复：minor 从 z13、service 从 z14、track/path 从 z15 显示；线宽在 z18 封顶为 1.8/1.4/1.0px，保持低透明度、细描边，路径为虚线；次要路名延后显示并避让。全部位于主路和业务层下方。
- 单测 34/34，类型检查、lint/依赖边界、生产构建、diff 检查通过；独立 reviewer 复核未发现问题。
- 浏览器回归 4/4 通过：切换/失败重试时视角、选择、图层可见性、未完成线面绘制保持；窄面板与实体标绘描边；新增真实 MVT 五级缩放及源 z14 overzoom；配置刷新、区域覆盖、偏好保持。
- 首轮并发浏览器运行中旧用例地图初始化 5 秒等待超时；新用例超限提示同时命中影像/路网两处文案，已改为精确定位。串行重跑四项全部通过（2.1 分钟）。
- CUA 实际检查生产预览：青岛港（窄桌面面板）和悉尼 Port Botany；细路实际可见，业务点线面保持在上层。悉尼同视角切换影像/混合确认线条来自叠加。
- 截图：experiments/harness-lab/.local/hybrid-road-detail/berserk-hybrid-qingdao-detail.png、berserk-hybrid-sydney-detail.png、berserk-imagery-sydney-detail.png。目录被 Git 忽略。
- 5198 原进程已停止；使用忽略的 .local/serve-basemap-preview.mts 恢复原有数据/账号/会话和模拟服务，构建更新后后台运行，未重建预览任务。
- 限制：数据源仍为 Esri World Imagery + OpenFreeMap/OpenMapTiles；放大只揭示源瓦片已有道路，不补齐源数据缺失，也不提升原生 z14 精度。本轮无新增配置要求。

后续授权：用户已要求提交本轮修复，采用中文 Git 提交信息，继续保留在独立分支，不合并主分支。
