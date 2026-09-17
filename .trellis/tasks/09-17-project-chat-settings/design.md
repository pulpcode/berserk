# 实施设计

## 参考与边界

DeepSeek Harness 的 Web 指南使用 Settings → Models，并在下一请求使用保存的配置；API Key 只写、不回传。本项目采用设置窗口与模型表单的组织方式，不照搬完整配置系统。

参考：https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/index.md 与 providers.md。源码定位结果另记 research.md。

## 会话交互

全局“新建会话”打开原生 dialog，项目下拉默认当前项目，确认才 POST /api/sessions。项目标题加号直接执行同一 create(targetWorkspaceId)；创建期间选择变化时结果只更新原项目，禁止把后来的选择或输入绑定到异步闭包里的当前项目。沿用 workspace:ID 的草稿及最近会话选择。

项目仅为前端工作区名称的调整，底层 API/存储字段不改。状态渲染保留 busy/stopping/failure/recovery，闲置不渲染文字；unread successful request 用带 accessible label 的蓝点。未读语义沿用先前标签页记录。

## 模型配置契约

GET /api/settings/model → ModelSettings {provider,model,baseUrl,configured,version,source:'environment'|'local'}，不包含 apiKey。

PUT /api/settings/model 输入 ModelSettingsUpdate {provider,model,baseUrl,expectedVersion,apiKey?}；空／省略密钥仅在提供方与规范化端点不变时保留旧值。端点或提供方变化必须提供非空新密钥。服务端严格校验额外字段、长度、HTTPS、无凭证／query／fragment。version 是独立随机版本，不是密钥 hash。

保存至被 Git 忽略的 LAB_DATA_DIR/model-settings.json，受控普通文件、0600 权限、临时文件原子替换。没有该文件时沿用环境配置；文件存在则覆盖模型字段。存储失败不改内存配置。保存阶段阻止新 start，任一会话活动时返回 409 MODEL_SETTINGS_BUSY；过期版本返回 409 MODEL_SETTINGS_CONFLICT。本期不自动切换进行中的请求，保存后下一请求和重启均使用新设置。只注册现有兼容协议，不引入新依赖。

设置窗口基于当前模式的表单和原生 dialog：只显示“模型”分类，不铺空栏目。API Key password 输入始终为空；已配置用占位提示，保存成功清空输入，关闭窗口销毁未提交密钥。不使用 sessionStorage/localStorage 记忆密钥。冲突要求重新读取配置后人工调整；不自动重放 PUT。保存成功刷新 /api/info 更新页面模型名称。

## 文件职责

- src/contracts、server/config 与新增 model-settings、pi/lab、server/app/main、后端测试：持久配置与运行时更新。
- src/web/main、WorkspaceNavigation、useChat、Resources、styles 和新增 Settings/NewSession 窗口：入口、目标绑定、蓝点、表单与键盘适配。
- tests/e2e、probe-workspace、README、spec：更新选择器、回归新旧入口、设置持久/密钥边界与文档。

不改用户 .env.local 或现有工作区数据。所有提交主体语言中文。
