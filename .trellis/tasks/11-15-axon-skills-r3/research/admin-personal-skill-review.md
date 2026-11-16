# 管理员个人技能使用：独立跨层审查

依据当前PRD与design末节的用户明确修正，覆盖原始v0.3/Q4的管理员仅内置技能口径；原始文档及既有真实探针不改写。审查了受影响后台/桌面包的完整授权链路，而非仅看新增条件。

## 发现及修改

未发现需要修复的产品或测试缺陷，未改动产品代码。没有未修复发现或需要额外产品决策的事项。

- `authorizeUse` 返回值只来自宿主当前 `accountIdentity`，管理员必须无业务席位，个人scope需精确匹配（账号目录不带workspace scope亦可），不由浏览器role/canCollaborate或seat字段授予权限。
- `SkillService.allowed` 只跳过业务席位none/all/seats判断；组织policy仍解析验证，包身份、完整性、普通状态、封禁和显式账号拒绝保留；异步加载后重查当前身份。默认无认证/不带受信回调的SkillService不会因canCollaborate=false而获管理员授权。
- 全局目录与详情通过当前账号投影；工作区资源先走既有workspace ownership。普通消息入口将当前userId与个人storage scope交给Pi，动态目录、实际读取和只读包挂载复用同一主体。父子请求继续继承原actor，不把个人scope转成业务席位。
- 个人Pi仍不建立业务ContextPrincipal，业务查询/交接/标绘等工具注册不变；业务Task/Workspace/Session/File路由继续独立拒绝，Skill发布声明不授予业务权限。
- 管理卡片复用已有SkillUsePanel与applyLibrarySkill，不创建对话或自动发送；草稿、停用项没有使用入口。管理员使用与业务开放范围的文案已同步，现有R2专家及R5后台边界未扩展。
- 新增真实认证/API/native Pi测试使用明确标记的模型和Docker替身，验证实际正文、资源工具结果、固定只读挂载及业务隔离；未当作新真实模型/真实Docker证据。旧的管理员拒绝断言与未来真实探针同步当前规则，旧证据保持原样。

## 验证

独立执行全局`npm run typecheck`退出0、全局`npm run lint`退出0，Pi/浏览器依赖边界通过。仅保留原InteractionCard的两项ref清理warning，无新lint错误。`git diff --check`通过。

复核实现者日志：新个人技能与范围/API/包守卫共四文件19项通过。复核父代理浏览器日志：skills四项、administrator/capabilities九项均通过，共13项；父代理另行执行互补25项及生产构建通过。没有重复运行已通过的同一集合，也未将定向结果冒称新增后的全量1818项结果。

当前审查源码摘要见admin-personal-skill-review-source.json；类型/lint原日志同目录保留。代码与测试冻结；本次修正未部署、未提交或推送。
