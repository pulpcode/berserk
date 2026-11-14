# 管理员个人所有者访问层验证

新增账号私有scope：account-UUID保留命名空间，不建业务席位。AdministratorIdentity提供personalScopeId；workspaceIdentity是仅用于前台工作区的内部Identity适配，业务identity/identityForSeat/canCollaborate保持原义。canUseWorkspace/assertCanUseWorkspace核对当前启用账号及管理员角色；个人TaskSpace携带ownerUserId，只能private且不接入context/scenario/source。

list/get核对真实账号归属但不要求enabled/当前role，使已撤权/停用管理员的历史仍能被可信启动代码验证；HTTP认证和写入/模型准入仍按当前角色拒绝。历史账号必须仍存在且seat_id为空，范围碰撞或owner字段损坏失败关闭。业务席位开通禁止使用保留范围。

server/auth装饰workspaceIdentity并导出workspaceIdentityOf：业务请求优先沿用request.identity，仅独立账号使用私有投影。原identityOf仍拒绝管理员业务请求。允许个人空间/会话/文件/模型选择所需既有路径；业务source/workbench/information/modelsettings等仍拒绝。task-routes使用工作区适配。

验证：新admin-personal-access.test.ts 5/5通过（最终fresh运行11.20秒），涵盖创建/幂等/CAS/归档、跨账号私有和公共隔离、业务上下文与伪造权限拒绝、当前撤权和历史重开、保留namespace/损坏owner、HTTP current-owner和业务路由拒绝。补查旧situation-host.test.ts3/3通过；首次默认sandbox因本地listen EPERM未执行，授权回环重跑成功，原失败日志保留。定向ESLint通过。未运行全局typecheck/lint，交父代理协调统一检查。

产品修改：contracts/access.ts，access/personal-scope.ts（新增）、access/store.ts，server/auth.ts、task-routes.ts；新增tests/admin-personal-access.test.ts，并更新administrator-access.test.ts精确身份断言。无数据库schema/账号密码变更，无部署、提交。
