# 旋转交互现状

- FeatureEditor.tsx 当前拥有 heading string；合法预览把 style.heading 传给父组件。空输入保留素材原始朝向。
- map-runtime.ts 通过 resolveMapSymbol 将真北 heading 换成源素材旋转量。方向图标 rotation-alignment=map、pitch-alignment=viewport；固定直立图标 rotation-alignment=viewport。
- 当前业务图层会随完整 preview 内容变更重建，手柄若放入该 cleanupLayers 路径将中断拖动。必须保持交互控件生命周期稳定。
- TerraDraw select 只做点拖动和线面顶点；rotate:null，点几何旋转不是图标方向。
- 核验参考：[MapLibre 官方样式规范](https://maplibre.org/maplibre-style-spec/layers/#icon-rotation-alignment)。具体屏幕换算以本项目安装版本行为与浏览器测试为准。
- ui-ux-pro-max 的 dragging-alternative：保留数字输入作为非拖动与键盘替代；指针操作提供即时可见反馈。仅桌面浏览器范围。

## 安装版本源码核验

实际 shader 位于 node_modules/maplibre-gl/src/shaders/glsl/symbol_icon.vertex.glsl。第 87–99 行在 u_rotate_symbol 为真时，投影锚点和锚点东侧一个单位，以局部东向屏幕角计算 symbol_rotation，再应用 icon 本身的旋转。viewport pitch alignment 下它不是把任意地理航向投影成地面线；手柄换算应匹配这一局部东向基准。使用公开 map.project 做有限差分即可核对，不依赖 shader 私有字段。测试需要非零 bearing/pitch 与离中心锚点，避免把 screenAngle+bearing 当普适公式。
