# 地图底图切换

## Goal
提供面向中国及澳大利亚城区、港口、近海的影像、路网、混合视图，突出业务对象。

## Confirmed evidence
基于 main efe2fb6；主工作区并行改动不纳入隔离分支。MapCanvas 配置变化重建地图；标绘依赖 basemap 层；通用业务图层名存在碰撞风险；单一栅格配置与错误、署名需要扩展。boat 只读，其区域 tilemaker 瓦片不能代表全域数据。

## Requirements
- 三种视图真实加载，默认影像；部署/场景配置只决定首次默认，用户选择按现有身份存储作用域记忆。
- 切换和失败重试保留相机、选中对象、可见性、未完成线/面；不改业务坐标、ID、存储。
- WGS84 经纬度与 Web Mercator XYZ 瓦片约定明确；配置覆盖、原生缩放、署名；覆盖不足、加载失败有反馈。
- 浅灰低饱和路网，混合仅必要路网及地名；业务原色语义保留并加描边/光晕。
- 桌面全宽、三栏与窄面板可用；不建设瓦片生产线、3D、路由或 Agent 分析。

## Acceptance
自动回归覆盖快速切换、失败、相机与选中/业务数据不变、未完成线/面续画、存储、覆盖提示。浏览器真实验证青岛和悉尼城区、港口、近海三种视图并保存截图；说明网络/数据限制。相关类型、lint、构建和测试通过。

## Authorization
用户明确要求简短方案后直接实施，免去再次规划批准；工作限定独立 codex/map-basemaps worktree。

## Follow-up: progressive hybrid roads (2026-10-15)
User approved revealing minor roads at higher zoom, then service roads and tracks/paths with restrained strokes below business overlays. Keep the isolated codex/map-basemaps branch and update the existing local preview. Do not commit or merge this follow-up. No source/provider, business geometry, persistence or road-view redesign.
