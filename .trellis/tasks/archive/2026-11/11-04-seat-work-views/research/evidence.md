# 现状依据与设计取舍

核对日期：2026-11-04。下列 src 路径相对 `experiments/harness-lab/`。

| 依据 | 位置 | 对方案的约束 |
|---|---|---|
| 已有摘要表格、四筛选、详情及 10 秒轮询 | src/web/WorkOverview.tsx | 保留现有业务规则；新增展示而非重写办理 |
| 摘要含席位 ID、任务、原状态、时间、participant | src/contracts/workbench.ts 的 WorkOverviewItem | 图无需新增业务字段；不能借图扩大正文／文件访问 |
| 过滤授权后排序，limit 1～200 | src/workbench/service.ts 的 paginate/overview | 图单次读取最多 200 项可复用 API；跨页没有快照一致性保障 |
| 正式只读摘要列表与详情路由 | src/server/workbench-routes.ts | 不新增 mutation、图服务或数据库表 |
| jobs 已有 view=board/list，其他 tab 同属 Location | src/web/InformationCenter.tsx | 席位工作使用独立 workView，保留旧参数含义 |
| 只在可见页读、旧请求忽略、撤权清数据 | src/web/information-ui.tsx 的 useInformationQuery | 图遵循相同身份／路由生命周期，不能双视图同时轮询 |
| 不允许自己给自己分派 | src/collaboration/service.ts 的 prepare | 不预建自环或通用流程编辑能力 |
| 总览涵盖多个能力栏目 | 父任务 design.md §2.3 与当前 InformationCenter.tsx | 视图切换不能取代栏目导航，也不扩展到信息流转等栏目 |

## 用户已确认与本版建议

确认：两种视图；图展示席位间分派；页面简洁统一；筛选左右同排；移除总览菜单与介绍；只做桌面浏览器；本轮先写方案。

建议：默认列表、仅本栏目显示标题行视图切换、同向联系聚合并可逐项展开、图 200 项边界、中性状态文字、原摘要详情复用。这些随本版方案审阅，不标为已获实施批准。

## 取舍

- 阶段进度条不表达多席位分派关系，未选用。
- 不按任务创建虚构的依赖边，也不把提交／退回表示为新的反向分派。
- 无界逐页扫描会受更新时间排序变化影响；当前 API 没有快照游标，因此推荐有界单次图。超限仍可使用完整分页列表。
- 静态确定性布局优先于物理力导向，避免轮询刷新造成节点跳动；现有 SVG/HTML 足以做只读关系图，不先引入图编辑器依赖。
- 调用本地 ui-ux-pro-max 的 `network graph node edge labels keyboard` 查询，采用可见标签、可访问名称、完整键盘路径的原则；不采用通用移动端建议或与本项目不符的组件库替换。

## 产物验证边界

文档与原型是设计交付。原型使用合成工作数据及本地展示交互，不能证明实际 API、撤权、轮询、分页或业务办理已实现；这些由 implement.md 的后续产品测试验证。
