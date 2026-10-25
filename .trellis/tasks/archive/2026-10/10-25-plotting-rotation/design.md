# 技术设计与边界

## 差距与所属模块
现有 FeatureEditor 用数值输入维护 style.heading，并通过预览传入 AnnotationWorkspace 和 annotation map runtime。MapLibre 已渲染专业符号朝向；缺少地图手柄到同一表单的方向更新入口。

## 最小改动
- FeatureEditor.tsx、AnnotationWorkspace.tsx：连接手柄与当前对象表单；保留既有 dirty、preview、save/cancel 和 captured edit identity，不新增持久状态或全局事件总线。
- annotations/map-runtime.ts 与一个必要时拆出的局部旋转交互模块：用现有地图公共 API 定位手柄、处理指针/清理和方向换算。旋转控件独立于会重建的业务图层，避免预览每次更新使拖动中断。不得用 TerraDraw 对点几何旋转来假装图标方向改变。
- annotations.css：小型高对比手柄、连接线和角度提示，沿用现有视觉风格；覆盖层不拦截其余地图。
- tests/e2e/annotations.spec.ts 与必要的数学单测：真实鼠标拖动、数值同步、图标像素/方向、camera 和 coords、取消/保存、折叠/隐藏与固定直立回归。
- .trellis/spec/frontend/map-symbols.md：记录可执行交互契约。

## 不变量
继续存储现有 style.heading，不新增 API/DTO 字段。数字输入和鼠标控制同一份表单状态。使用 captured object identity 防止旧手柄写到新对象。手柄仅对正在编辑且可见可写的方向型标号生效。关闭/禁用/销毁时释放 pointer capture、监听器和临时地图交互控制，并恢复先前状态而非无条件启用。

## 方向与渲染
使用真实项目 MapLibre 版本和公开 API，匹配现有 icon-rotation-alignment=map、icon-pitch-alignment=viewport；不能只用屏幕角度直接当真北方向。注意 intrinsicHeading 和空 heading 的原始朝向。具体换算在本地源码/文档验证后实现；不可为此改变所有已有图标渲染规则。旋转时不重新 fit 或重建地图。

## 兼容与回滚
仅前端交互增量，原数值输入保持可用。回退本次提交即可，无存量数据迁移。
