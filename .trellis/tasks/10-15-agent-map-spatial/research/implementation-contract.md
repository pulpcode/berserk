# 第一阶段实现冻结契约（2026-10-16）

基线 1b783a2。后端内部服务，Turf 7.2.0 按模块固定版本。无额外数据库、HTTP 或 Agent 循环。

- 空间输入：source 指定 systemId 与可选完整对象引用/areaIds、修订条件；annotation 指定固定 ref 与对象/图层；result 仅原生历史中可信 resultRef，可选择结果对象或生成 geometry。
- 完整查询上限 500 个去重对象、10,000 总顶点、单几何 2,000 顶点、结果 JSON 1 MiB。超限和缺失几何/参与字段明确失败；不返回部分排名或计数。
- WGS84 longitude/latitude。纬度绝对值小于 80°，单几何经纬跨度 <= 10°，不跨反经线；buffer 距离 <= 50 km，球面测量与区域平面拓扑明确区分。多面/孔保留，保存仅兼容简单单环。
- measure: point/point distance、point/line point_to_line、line length、polygon/multipolygon area。单位 m / m²。
- relate/filter: intersects/disjoint 点线面（含多面）；contains 的区域必须 polygon/multipolygon，候选点线面均按闭区域覆盖，包含边界。不会把相交解释为连通。
- nearest: target 为单点、input 为候选点；按精确球面距离、完整身份字典序稳定排序。过滤必须先执行；同距不扩增 N。
- filter: 属性等值/不等/数值比较（缺字段错误）；空间条件可指定闭区域关系或单点到点/线距离 <= distanceM，无隐式容差调整。
- summarize: 实际顶层属性字段，按完整身份去重；缺字段错误，null 单独分组。
- 纯几何验证和计算在单次 Node worker 中运行，最多同时 4 个、各 128 MiB old generation、3 秒包含启动的期限；取消/超时先等待 worker 终止，再返回失败。无持久队列。基准发现 2,000 顶点锯齿线直接 buffer 会持续阻塞并 OOM，因此不能仅依赖同步规模上限。独立 worker 用例验证主事件循环心跳、主动取消、期限和普通成功。
- results: details.spatialResult 保存全部固定数据；content 只去掉坐标。原生历史 resultRef 关联实际 request 和 toolCall，必须原始调用为 spatial_analyze、成功、投影一致。read 只重读固定结果，重检权限，不重查并替换历史。
- saving: annotation_from_analysis 读取原结果 geometry 或指定 itemId，已有草稿 CAS/幂等/事务/不确定结果保护。来源权限单调继承；不自动发布或采用。
- 前端使用 contracts/spatial.ts 的 SpatialResult 与 extractSpatialResult；PublicMessage/SSE spatialResult 可选，旧历史保持可读。回退版本必须保留新 Skill/结果读取。

实际结果附 parameters 原操作条件；跨请求 read 保留原始身份和快照，另加 delivery 当前 request/toolCall 绑定。历史展示重检结构化证据权限并隐藏不可读工具正文；旧助手文字保持历史。若原生历史中有来源权限已撤销的分析结果，拒绝新请求进入模型，避免从原生上下文重新提供受限事实。
