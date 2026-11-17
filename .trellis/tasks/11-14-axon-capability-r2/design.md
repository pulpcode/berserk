# R2 技术设计

> 最新补充：管理员恢复新建对话与个人空间、侧栏间距和测试密码统一；以 research/admin-personal-space.md 为最新实施契约。复用原Pi和私有空间机制，管理账号仍不绑定业务席位。

> 上一轮用户修正：统一下拉身份登录、Axon应用外观、能力中心参考WorkBuddy、管理员专家页创建入口。以 research/unified-capability-ui.md 为本轮实施与验收依据，替代下文先前独立登录表单和专用管理后台的表现设计；无席位账号和业务权限隔离继续有效。

## 基线与差异
实际检查HEAD为13b4e87（原稿引用eb87638）；新增侧栏精简仅CSS和测试/规范，既有专家输入框标识保留。R1记录仍待用户验收。当前工作树在本任务之前干净。已通过create_worktree从该HEAD建立独立 /Users/lau/.codex/worktrees/axon-r2/berserk，分支codex/axon-r2；原R1工作树未修改产品代码。

## 已核实落点
- capabilities/service.ts：不可变修订、SQLite、缓存、创建意图、状态和账号拒绝；直接registerExpert不是可暴露的网页发布门禁。
- pi/lab.ts：启动登记内置定义、createSession创建意图及专家绑定、前台/委派调用守卫；不能让新默认改变后台Profile身份。
- server/app.ts：专家目录和只读管理员摘要；身份来自登录会话。
- web/CapabilityCenter.tsx、Resources/设置及任务页面：承载管理和默认配置；不恢复常驻版本横条。

## 管理层
在现有capabilities库增加版本化R2管理schema：草稿及CAS、验证、隔离试用、发布/动作回执/审计、使用范围和三层默认。分别组织管理服务和路由，不将表单逻辑或全部管理实现堆入lab.ts。管理DTO由contracts定义，Pi类型/历史解释仍在pi内。

保留schemaVersion=1摘要算法和原修订字节，旧同releaseVersion不同内容合法。内置和组织定义服务端分源，启动不覆盖组织当前指针。内容文件先持久化校验，发布事务再提交指针/版本/审计/幂等回执。对比规范化可发布内容判断无变化，不能因releaseVersion变化制造空版本。

## 隔离试用
增加trial入口适配既有Pi执行循环，独立目录和索引；不生成普通发布修订、不出现在正式目录。试用仅用明确合成/脱敏样例，不加载正式业务秘密或目标；只读查询使用显式测试源，写动作禁止真实提交。按需使用Docker无网络边界。记录固定草稿/技能、工具、模型环境、异常和人工结论。停止、重启、撤权不重放。

## 默认与授权
服务端解析一次默认并写原创建意图；同键重试先查回执，保留原专家修订。所有用户发起新会话入口需清点；后台入口维持原规则。扩展主体为userId+seatId，业务资格、席位策略、账号拒绝和工具限制取交集；实时守卫及确认返回复核保留。任务默认复用现有任务管理授权，不能仅检查能力管理员。

## 2026-11-14 管理员身份边界修正（用户明确要求）

管理员是系统账号角色，统一称“管理员”，与总体席等业务席位分离。支持不绑定席位的管理员账号；不创建虚拟管理席位，不自动赋予总体席管理权限。现有业务 Identity 保留必需的 seatId，新 AccountIdentity 联合类型覆盖无席位管理员，认证区分登录账号与业务主体。管理入口使用账号授权，业务入口继续要求真实席位。账号角色使用系统级 account_roles，兼容迁移原 capability_account_roles 的显式授权，不推断新授权。

变更边界为 access 的账号/角色及离线开通、auth、管理授权和独立管理登录界面；保留现有席位账号、密码、历史关联及业务权限。本轮仅接入已实施的专家管理，不提前建设后续管理模块或通用 RBAC。账号 seat_id 允许空需要明确的离线迁移与备份，旧版本回退仍配对旧数据备份。验收需覆盖无席位管理员登录、管理、业务拒绝、撤权，以及既有业务席位回归。

## 兼容与运维
先对副本dry-run，统计内置来源、重复发布号、账号拒绝、未完成意图。停服完整备份后apply，迁移重入/故障恢复。回退必须匹配R1程序与升级前完整备份，保留R2新增数据。此任务尚未授权部署或生产迁移，不复用上一次4315部署授权。

## 待实施调研
开工前补齐每个用户创建入口、任务写权限函数、实际工具目录及trial宿主数据依赖的逐文件映射；不把上述候选结构当作已实现能力。


## 2026-11-14 用户开工确认

用户明确“R1剩余工作是调整ui，可以放在后续，开始执行实施”。按上述R2方案开始，R1保留待验收记录，UI后置；规划门槛已获准。实际开工基线13b4e87，独立工作树axon-r2，分支codex/axon-r2。R3A/R7只规划。

## 已落地文件映射

- contracts/capability-management.ts、capability-trials.ts 定义管理与试用DTO。
- capabilities/management.ts、management-migration.ts、catalog.ts 与既有service.ts协调草稿、发布事务、策略、默认、迁移与守卫。
- pi/capability-trials.ts、trial-tools.ts承载独立数据与合成只读适配；lab.ts新增内部requestGuard/trialmode，不提供HTTP任意工具注入。
- server/capability-management-routes.ts与capability-authorization.ts统一路由及作用域权限，app.ts接线。
- web/CapabilityManagement、ExpertTrial、ExpertDefaults、Settings及Tasks接入桌面管理和默认；main仅传递来源提示。

用户发起新建、专家协作、交接/工作接手最终共用/api/sessions及lab.createSession；现有后台service/continuous paths传入宿主预分配sessionId，保持R1默认。未新增第二套模型循环，未升级Pi依赖。
