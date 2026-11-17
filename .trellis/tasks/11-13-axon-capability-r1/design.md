# R1 技术设计

依据：research/ 下用户提供的 0B v0.3 与 R1 v0.2。用户已明确要求依照通过评审的方案开始实施，补齐文档后继续执行，不重新进行产品方向确认。

## 边界与实际基线

- 实施分支 codex/axon-r1-experts，起点 66d0cba3ad4420d74593f31ffd540b893ed41ae6，来自 feat/chat-rendering-c。远端没有同名基础分支。原工作目录的未提交改动不在本 worktree。
- 设计引用 6527702；与起点的 42 个文件差异主要为聊天渲染、流式输入和人工确认修复，以及相应规范与任务记录。保留这些行为，不静默切换 main。
- 当前缺口：会话没有固定主专家及声明技能，专业能力没有目录、不可变修订、实时状态与账号管理边界。行为归属 capabilities、现有 Pi 装配、认证和会话 API，以及工作台导航。

## 数据与执行流

受控定义及技能正文 → 内容规范化和 SHA-256 → capabilities SQLite / 只读内容文件 → 解析固定 ExpertRef → Pi expert-binding → 工作区关联 → 创建回执。

请求读取固定绑定 → 当前主体与空间鉴权 → 读取和校验不可变修订与依赖 → 合并本条技能（同 ID 不同内容冲突）→ 当前工作区资料 → 工具取交集 → execution-manifest → 原 Pi 请求循环。

- contracts/capabilities.ts 定义共享 DTO，不引入 Pi 类型；capabilities/ 负责注册、内容、状态、意图、缓存、调用守卫。
- src/pi 保留原生记录编解码和请求转换；会话级绑定不伪造 requestId。专家绑定缺失的新会话不可降级。旧会话清单在升级准备时明确登记，只在显式续聊时追加历史兼容绑定。
- 内置通用助手保留原工具权限；示范资料综合专家仅开放受控读取和单层只读委派，依赖 synthesis/review 快照；analyst/reviewer 保留原名和父请求固定加载语义。
- 内容共享缓存有界且按 revisionId+digest 寻址，工作区和授权不缓存；停用阻止新工作，封禁或撤权先关闭准入，再取消活动请求，工具执行和确认返回后再次检查。
- 创建意图以账号（测试模式用受控席位）+clientActionId 唯一，持久化原参数摘要、原修订和会话 ID。重试先查意图并重新鉴权；不重解析最新版本、不重放工作，无法证明的中间态保留并阻断。
- 认证角色独立于业务席位和模型配置权限，离线显式授予 administrator；只读管理 API 不授予业务权限。

## 文件范围及协作

1. contracts/capabilities.ts、capabilities/* 及对应单测：契约、内容和状态唯一归属。
2. access/*、server/capability-routes.ts、管理与迁移脚本：角色及只读接口和运维，不修改 Pi 原生数据。
3. pi/lab.ts、pi/capability-history.ts、pi/history-evidence.ts、server/app.ts、contracts/index.ts：原生会话、执行接入与全层集成。
4. web/*、专用 capabilities 样式和浏览器测试：桌面能力中心、空间选择、头部身份与不可用发送提示；保留子 Agent 含义。

不建设 R2—R6 产品功能，不升级 Pi，不清理无关代码，不复制聊天历史数据库。必要提取仅限固定专家装配及记录解码，以原测试和 provider payload 对照验证旧行为。

## 兼容与运维

不扩展严格旧 workspace-index 的技能字段。独立数据目录中记录 dry-run/apply、迁移 prepared/completed、旧会话清单、重入与故障恢复；启动发现未完成迁移时拒绝服务。回退用升级前程序及停服后的完整 LAB_DATA_DIR 备份，保留升级后数据。真实模型/Docker 缺环境时明确未验证，不以替身冒充实测。
