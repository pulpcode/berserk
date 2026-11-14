# 统一下拉登录实现验证

- `AuthSession.loginUsers` 仅包含独立启用管理员账号的 `{id,name}`，不向匿名页面公开登录名、角色列表、密码资料或业务账号显示名。
- AccessStore 增加 `loginUsers` 和 `identityForLoginUser`；后者拒绝业务账号、停用或撤权账号。
- `/api/auth/login` 沿用同一路由、密码核对、节流、CSRF、cookie/视图轮换，新增互斥 `accountId` 选择器，兼容既有 seatId/username。
- Seats 删除管理员按钮、用户名表单、专用组件分支。一个下拉与密码表单承载业务席位和管理员，管理员成功登录进入 `/capabilities`，始终经 children 进入 Axon 应用；实际无业务席位 ID。
- 只增加共享只读 `/api/capabilities/library` 的认证允许路径；业务 API 拒绝规则保留，无数据库或密码改动。

新增 `tests/unified-login.test.ts` 通过：公开选择项与隐私、排除停用/撤权与席位账号、混合选择器和浏览器角色注入拒绝、CSRF、密码、会话轮换/旧视图拒绝、管理员撤权401、普通席位登录和业务隔离、无模型调用或工作区创建。

执行：`npx vitest run --configLoader runner tests/unified-login.test.ts tests/access.test.ts`，2文件17项中新增1项通过，既有access6项在15000ms超时，其余10项通过；当时只读进程检查有3个并行tsc占用CPU，未出现业务断言失败。主代理独立执行的相关6文件48项（含既有access）已通过；不将本轮超时记录改写为通过。原始输出 `/private/tmp/axon-unified-login-tests.log`。

定向 ESLint 通过。初始全类型检查在并行 UI 中途仅报告 `CapabilityApplication` 所需 `administration` prop 尚未被能力页面声明；主代理后续类型检查已通过。未提交、未部署。
