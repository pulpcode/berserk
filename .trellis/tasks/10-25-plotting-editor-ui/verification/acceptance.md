# 验收记录

- 范围：FeatureEditor、局部 CSS、受影响 E2E、map-symbols 规范。未改后端/数据模型/旋转运行时。
- 独立检查：无剩余问题。目录搜索 Enter 误保存和替换后失焦已修复并复测。
- typecheck / lint / build / git diff --check 均通过。build 仅有既有大 chunk 提示。
- E2E：annotations、situation-map、map-symbols 共 31 个唯一用例。首轮 29 通过；2 项窄面板的 scrollIntoViewIfNeeded 贴底出现 0.27px / 1.27px 舍入裁切，但仍有 50px 以上可滚空间。改用实际鼠标滚动后保留 100% 可见断言。最终相关 4/4 通过，覆盖这两项及搜索 Enter/焦点修复。
- 新回归验证隐藏样式、备注、业务属性按原值保存，仅修改名称不丢字段；目录展开/搜索/Enter 不写入；选择后焦点返回。
- 实际 IAB：最终 build 已在原 4324 服务加载，1280×720 当前消防车编辑，鼠标旋转90°→45°并同步数字框，地图位置不变。
- 原用户 tab4 保留；新试用 tab6 展示新版，示例只在本地未保存，服务草稿仍 r1。账户、数据和服务进程均沿用。

## 截图
- editor-live-preview.png：实际服务与影像地图上的简化常用区。
- editor-simplified-wide.png：1280×720 常用区与固定保存操作。
- editor-advanced-narrow.png：1000×900 窄桌面展开业务属性，字段与保存/取消完整可达。
