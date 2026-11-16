# 空间类型分组实现

当前仅完成用户认可方案的代码与技术验证，阶段验收仍 pending；未提交、push或部署。

## 实际变更

- 沿用被中断实现已落盘的 NewSession/main/styles：main只把原授权taskMeta传给原组件；NewSession用visibility public/private分为任务/个人，使用BriefcaseBusiness/UserRound图标，触发器保留任务/个人badge和独立name；未知旧模式保持Folder普通空间组。空组隐藏，没有从名称、ID或创建权限推断类型。
- 原选择、创建回调、准备禁用、键盘/关闭、首发及草稿逻辑保持；footer顺序任务→个人与用户认可预览一致，root明确确认，未改变位置和权限。
- authoring既有选中名称断言改读独立name span，避免badge混入菜单项目名称。admin既有真实个人创建对话用例新增仅个人组/个人badge断言。
- access既有双席/归档恢复用例在原流程后验证实际mixed两组、任务→个人→任务标签和名称更新、原任务草稿保留；原流程与模型调用断言保留。

## 验证

- scoped ESLint exit0，git diff --check exit0。
- 单worker9/9一次通过，1.2m；AXON_E2E_PORT=5193，authoring actualAPI4310，其余沿用既有隔离fixture/provider。未运行真实模型、后台全套测试。
- 混合权限场景12.3s、admin13.4s、authoring3例、普通首发、新页/旧链接导航及上传取消均过。日志grouping-browser.log。
- 1060/1440混合菜单截图已逐张查看：任务/个人组、图标、选中勾选和触发器类型badge清晰，焦点可见，没有横向溢出。两张个人菜单截图亦留档。
- source hash清单grouping-source.json；root统一完成最终全局type/lint/build及独立review，不将技术通过等同用户阶段验收。

## 收尾

无计划中的产品或测试变更；源已冻结。最终静态门禁由root补记，本轮不自动上线。
