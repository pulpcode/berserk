# 管理员个人空间与测试密码（最新用户反馈）

用户要求：管理员也有新建对话、个人空间；修正侧栏能力中心靠顶间距；管理员密码与既有测试席位一致。管理员不绑定业务席位、不进入公共任务空间的约定继续有效。

已发现能力缺口：现有private TaskSpace、WorkspaceStore、FileService和Pi会话都按seatId字段分区；当前管理员无seatId且前端不挂载对话。直接把管理员加入业务席位会违反原需求。

## 最小实现与责任
- 复用既有个人空间/工作区/会话/文件/Pi循环；引入确定的账号私有所有者范围 `account-${userId}`，不插入seats、不出现在业务席位/接收/分派目录。这是既有存储seatId字段里的所有者分区键，并非业务席位。
- contracts/access：AdministratorIdentity新增personalScopeId；canCollaborate仍false（业务资格）。TaskSpace新增可选ownerUserId；账号私有空间visibility必须private、ownerUserId匹配账号、ownerSeatId为personalScopeId，不接受业务context/scenario/source归属。
- AccessStore新增workspaceIdentity(userId): Identity|undefined（仅工作区适配的privateOnly投影）、canUseWorkspace/assertCanUseWorkspace、账号scope解析与保留命名空间。原identity/identityForSeat/canCollaborate保持业务语义。所有account范围list/get/create/update/acquire只允许本人私有空间，旧业务权限不变；saveAccount禁止占用保留account-UUID范围。
- server/auth保留request.identity为业务、accountIdentity为账号，新增workspaceIdentityOf用于个人空间/会话/文件路由，identityOf仍拒绝管理员业务请求。放行个人对话必要路径并在服务层限制所有者，不开放公共任务/来源/工作分派/场景/共享模型管理。server/seat-scope使用workspaceIdentityOf；server/app的会话principal/用户ID用此适配。
- PiLab和WorkspaceStore的前台工作区准入改用assertCanUseWorkspace；业务协作依旧原guard。账号范围运行的工具不注册业务context/work/commands/annotation工具，真实模型、文件、确认、取消、子Agent继续原Pi机制。当前账号/角色每次准入和工具调用复查。
- 前端管理员复用完整Axon对话/空间流程：root把server personalScopeId映射成局部工作区视图给BusinessApp，保留原账号信息给设置和管理授权。增加personalOnly限制业务菜单/hooks/任务空间创建，个人空间和聊天启用；仍默认能力中心，能力中心管理员管理功能保持。统一导航顺序/spacing，与普通账号一致。
- 不增加数据库schema或第二套模型/历史，不改业务账号密码；部署前完整备份，回退配对旧程序与本次备份。管理员密码仅服务器内取现有测试席位共同密码，通过现有隐藏TTY维护命令设置，不进代码/日志。

## 验收
管理员新建个人空间与空对话、两轮消息/刷新历史/文件/确认；两管理员和业务用户之间私有隔离；管理员公共任务CRUD/来源/工作分派/其他个人空间403或404；范围不能由header/body/seatId伪造，账号停用/撤权中断后续调用；不产生业务席位。前端有新建对话/个人空间、无任务空间/工作入口，能力中心及管理仍有效，1060/1440侧栏节奏一致；旧业务登录/任务/会话和发布回归。单个协调者顺序执行重检查，避免上一轮并行tsc导致资源争用。
