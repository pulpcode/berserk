# 技术边界

实际缺口：服务存在完整Skill创建，但专家完整创建与修改幂等不足；原请求没有受控管理工具/意图，主按钮为手动表单。资产仍以原服务SQLite为准，聊天仍为Pi JSONL。

预计变更：contracts新增authoring.ts统一意图/候选/回执；管理/技能服务在自己锁及事务内补完整创建、修改幂等，不用跨连接外层事务冒充原子性。authoring宿主服务拥有验证、目标、候选与单次采纳；Pi请求注入专用管理方法与工具白名单，复用原interaction确认与严格历史解码。前端原工作台传入请求意图、普通工具详情显示真实候选/回执和主动管理定位，保留所有手动入口和脏输入保护。

初始共享意图 AuthoringIntent={kind:'expert'|'skill',targetId?:string}，仅每次消息显式传入，服务端复核管理员本人个人范围；不在会话永久授权。受控catalog/read/propose/save工具的最终名称和服务签名由backend与Pi实现者先协商统一并写research/interface.md。候选存服务端，以owner/session/request/kind/target/baseline绑定；确认工具只收proposalId，宿主取完整实际候选展示，批准后调用原服务。原服务动作回执与写入同事务，proposal稳定动作标识避免新动作重复创建。重启查询回执不重放。

不修改Pi依赖、不用extraTrialTools、不改业务权限/发布/使用范围、不执行WorkBuddy注册脚本、不添头像/团队/并行聊天存储。新增必要SQLite表采用显式迁移、副本dry-run/备份/重入及配对回退，旧数据与JSONL不重写。

## 实际最小持久化设计

已确认复用r2_actions/r3_skill_actions，无新表或schema迁移。候选仅当前请求内Map、原Pi工具/确认历史存证，结束release；重启不恢复待确认。原服务saveAuthoring将完整草稿、审计、回执一次事务提交，稳定proposalId作为动作ID，回执可后续只读核对。没有跨连接事务、第二资产/聊天库或待办中心。

无需schema迁移不代表旧程序可读新authoring历史：未来发布回退须保留R3A活动根并配对升级前完整停服备份，不用旧程序直接打开有新确认字段的活动历史。当前独立探针仅使用合成临时数据，未升级生产服务。

## 本次最小变更边界

差距实际位于web/main新建会话导航、能力中心创建按钮与ComposerReferences选择，以及Pi管理方法/原composer历史映射。统一创建方式选择弹窗；原聊天新建草稿页拥有空间选择，显式选择/新建空间后复用原workspace创建和发送，不改已有session绑定，不加新聊天API。

管理方法改为服务端固定只读Skill注册，使用expert-manager/skill-creator真实方法内容及hash；统一原Skill picker/chip，明确注册身份与用户上传包分离。原管理工具白名单、候选/确认/原子回执不变。必要新原生输入版本保持旧v1—v7可读，不改旧历史。管理方法并非可授予业务权限的用户包，不要求管理员安装/发布。

预计文件：web/main/useChat/NewSession/ComposerReferences/useComposerSelections及能力中心/SkillLibrary的入口；backend部署方法注册、resource/请求选择映射与composer input/history；共享契约与定向测试；没有后端wizard状态、资产schema或新存储。实现者先协调method metadata/lookup与intent target/baseline的映射，避免双重状态。所有实际保存仍走已验证服务。

### 空间菜单与文案的最小调整

本次行为缺口在CreationMethodDialog文案、NewSession空间选择的外置新建按钮及main的普通目标提示。修改这三个原UI组件与对应CSS，复用choose/createPersonal/createTask回调和原TaskPanel；菜单只拥有显示/焦点的临时状态，不增加新的空间或会话存储。原输入保护、管理Skill、权限与首发幂等保持。按变更适配现有浏览器交互断言，检查键盘、点击外部/Escape、创建取消/零空间及桌面1060/1440。没有后端或历史格式变更，不重跑真实模型或整个后端测试集。


## 空间类型区分反馈

最小边界：NewSession和样式负责分组/图标/类型标签，main传递已有可信taskMeta.visibility；不从名称、ID或新建权限推断空间类型。没有任务元数据的旧非认证模式保留普通空间展示。复用选择、取消、准备期保护和原会话/草稿。仅适配受影响浏览器断言及真实分组权限/切换回归，无后端改动，不重跑真实模型。
