# 标绘交互验收记录

日期：2026-10-25；分支：codex/frontend-plotting；基线：698d9a5。

## 已完成的交互

- 全局、任务、会话入口显示当前上下文与编辑条件；导航复用已有任务/会话入口。
- 工具目录单击专业标号即进入单次落点；未完成绘制、未保存输入、保存中、待回执和隐藏图层都有守卫。属性里的换标号只修改当前对象。
- 属性优先显示名称、信息性质、当前标号、尺寸和方向；坐标、备注、业务属性和高级样式按需展开。坐标新增仍直接显示坐标字段。
- 表单独立滚动，保存/取消固定在底部；保存新建或既有对象不再触发地图定位。

## 自动化验证

- npm run typecheck、npm run lint、npm run build 通过。
- annotations.spec.ts：20 个既有和新增用例通过（首轮 18 个通过，另 2 个仅适配旧定位器后通过，未弱化业务断言）。
- situation-map.spec.ts、map-symbols.spec.ts：7 个用例通过。
- situation-map-ui、spatial-map-ui、map-symbol-contracts、map-symbol-assets：4 文件 / 13 测试通过。
- 新建、编辑保存均断言 center、zoom、bearing、pitch 不变；显式定位仍改变视角。
- 窄桌面 1000 × 900 验证末字段可完整滚入视口，同时保存按钮 100% 可见；宽桌面 1440 × 960 检查紧凑属性布局。
- 独立 trellis-check 全范围复核完成：新增只读入口在刷新失败后可能绕过未保存保护，先用回归复现，再复用现有确认修复。取消导航保留输入，确认导航才离开；未产生隐式标绘写入。
- 新增异常路径用例通过，累计 annotations 21 + situation/map-symbols 7 = 28 个唯一浏览器用例通过；修复后针对性 4/4 通过。
- 加强收起工具的断言，直接检查 .annotation-tools-dock 真实隐藏；全局 [hidden] !important 已保障布局，无需冗余 CSS。
- 独立复核后 lint、typecheck、build 和 git diff --check 再次通过，无未解决发现。

## 实际预览

- 复用原 4324 端口和独立试用数据；重启后 HTTP 200，既有任务/会话与草稿 r1 保留。
- 浏览器实际检查上下文提示、展开工具、坐标新增、精简属性和取消编辑；未保存或修改试用业务数据。
- 显式定位来源对象仍有效，工具面板按需展开。
- 自动化浏览器使用本地瓦片夹具；预览使用既有影像底图。测试来源数据不代表生产 GPS 接入。

## 截图

- tools-preview.png：4324 实际影像底图与工具目录。
- compact-properties-wide.png：宽桌面默认属性卡。
- compact-properties-narrow.png：窄桌面末字段与固定操作区。
