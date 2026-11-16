# 技术边界

实际缺口：服务存在完整Skill创建，但专家完整创建与修改幂等不足；原请求没有受控管理工具/意图，主按钮为手动表单。资产仍以原服务SQLite为准，聊天仍为Pi JSONL。

预计变更：contracts新增authoring.ts统一意图/候选/回执；管理/技能服务在自己锁及事务内补完整创建、修改幂等，不用跨连接外层事务冒充原子性。authoring宿主服务拥有验证、目标、候选与单次采纳；Pi请求注入专用管理方法与工具白名单，复用原interaction确认与严格历史解码。前端原工作台传入请求意图、普通工具详情显示真实候选/回执和主动管理定位，保留所有手动入口和脏输入保护。

初始共享意图 AuthoringIntent={kind:'expert'|'skill',targetId?:string}，仅每次消息显式传入，服务端复核管理员本人个人范围；不在会话永久授权。受控catalog/read/propose/save工具的最终名称和服务签名由backend与Pi实现者先协商统一并写research/interface.md。候选存服务端，以owner/session/request/kind/target/baseline绑定；确认工具只收proposalId，宿主取完整实际候选展示，批准后调用原服务。原服务动作回执与写入同事务，proposal稳定动作标识避免新动作重复创建。重启查询回执不重放。

不修改Pi依赖、不用extraTrialTools、不改业务权限/发布/使用范围、不执行WorkBuddy注册脚本、不添头像/团队/并行聊天存储。新增必要SQLite表采用显式迁移、副本dry-run/备份/重入及配对回退，旧数据与JSONL不重写。

## 实际最小持久化设计

已确认复用r2_actions/r3_skill_actions，无新表或schema迁移。候选仅当前请求内Map、原Pi工具/确认历史存证，结束release；重启不恢复待确认。原服务saveAuthoring将完整草稿、审计、回执一次事务提交，稳定proposalId作为动作ID，回执可后续只读核对。没有跨连接事务、第二资产/聊天库或待办中心。

无需schema迁移不代表旧程序可读新authoring历史：未来发布回退须保留R3A活动根并配对升级前完整停服备份，不用旧程序直接打开有新确认字段的活动历史。当前独立探针仅使用合成临时数据，未升级生产服务。
