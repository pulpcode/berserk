# 设计边界

最小差距：入口缺少上下文说明；工具目录仅改变符号选择；FeatureEditor 默认展开完整符号库并把名称和保存置底；AnnotationWorkspace.apply 成功时强制 setFit。

行为归属与预计文件：
- web/annotations/AnnotationWorkspace.tsx：入口状态、直接开始点标绘、无图层提示入口、保存去除强制 fit。
- web/annotations/FeatureEditor.tsx 与 annotations.css：简短主表单、折叠高级字段、可见操作区；验证与保存原样复用。
- web/main.tsx、situation/MapContext.tsx、TaskInformation.tsx，以及必要的 SituationView.tsx：传递任务名称与复用现有任务/会话导航，显示明确的只读提示。避免新建第二套导航或隐式数据写入。
- tests/e2e/annotations.spec.ts 及实际受影响的既有测试：用户行为回归与 camera 不变断言。
- spec/frontend/map-symbols.md：记录此次已验证交互约定。

不改 API、模型、权限和发布采用流程。保留已有状态机和对象字段；只在需要说明入口或确定坐标新增时补最小展示参数。不做重构。
