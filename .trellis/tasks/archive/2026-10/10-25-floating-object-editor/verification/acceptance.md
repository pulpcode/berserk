# 验收结论

## 结果
- 对象编辑时释放原固定右列和窄桌面底部行，地图全幅；既有节点成为右上自然高度卡片。
- 更多属性/图标目录展开到高度上限后仅内容区滚动，标题与保存/取消固定在卡片内。收起恢复紧凑高度。
- 保留原地图与表单实例、镜头、数据、预览、方向数字输入和鼠标旋转，卡片外可实际拖动与滚轮缩放。
- 实测 fieldset 匿名盒导致焦点滚动带走 footer，已通过普通 div 滚动容器、原 fieldset 语义及 form overflow:clip 修正。真实服务 wheel 与焦点验证见 manual.md。

## 自动检查
- typecheck、全量 lint、最终测试文件 ESLint、build、git diff --check 通过。
- 31 个唯一 E2E 均有通过记录：完整 annotations/situation-map/map-symbols 首轮30/31；最后一项是既有备注内容下 getByLabel 精确定位超时。改为真实 textbox role 后目标1/1通过，保留原focus/footer断言并补卡片外wheel断言。
- 新验收覆盖：完整地图尺寸、原实例、面板展开/收起高度、目录搜索不提交、字段wheel真实scrollTop变化、focus不挪动footer、隐藏属性保存无损、1280×720 / 1000×900 / 1000×620可达性。
- 构建仅有既有chunk体积提示，无新增构建错误。

## 交付
- 原4324服务已加载最终构建，账户、数据与原未保存页面保持。
- 新tab8留有未保存消防车45°演示，草稿仍r1；临时验证页7已关闭。
- 独立检查未发现剩余产品问题。宽/窄/矮截图已目视确认；实际服务截图 floating-editor-live.png、floating-editor-scroll-live.png。
