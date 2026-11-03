# 设计边界

问题位于 annotation-main 的固定列布局与对象编辑多层 flex:1 撑满高度。复用当前节点、状态、表单和地图 resize 路径，增加明确的对象编辑布局类或同等局部选择器。

对象编辑显示时释放网格列/窄屏底部行；将当前工具容器收敛成右上浮动卡片。内容自然高度、边界限制高度，表单内容 flex 可缩不可无谓撑大，footer 固定在卡片底部。高级内容收起时恢复自然高度。

预期修改 AnnotationWorkspace.tsx（如布局类需要）、annotations.css、已有 annotations E2E 与 map-symbols 规范。地图与表单不重新挂载，行为与数据逻辑不改。

## 实测后局部修正

原 .annotation-feature-fields 为 fieldset。受 flex 自然高度与最大高度约束后，Chrome 的匿名内部盒不能可靠承担滚动：311px视口/643px内容时 wheel 未移动自身，聚焦备注反而令隐藏溢出的父 form 滚动284.5px，footer移至中部。纳入 FeatureEditor.tsx 的最小容器调整：普通 div 承担滚动，内层 fieldset 保留 disabled 与表单语义。新增 wheel 真实改变滚动值以及聚焦字段后footer不漂移的验收。数据与提交逻辑保持不动。
