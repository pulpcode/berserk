# R3 技术设计与改动边界

## 实际缺口与归属
ResourceService仍固定四项技能，仅正文SkillFile；SkillRevision没有完整文件清单。管理服务的专家发布强制成功试用，不能直接复用成Skill发布条件。Docker当前只挂工作区与日志，需加入请求已激活包的只读挂载。

## 模块责任
- contracts/capabilities及新增技能契约：独立SkillAsset/Draft/PackageRevision、相对路径清单/内容hash/包digest、报告和可选试用；旧结构通过版本化联合保持解码，不放宽旧历史。
- capabilities技能服务：复用现有SQLite/不可变blob、CAS/Mutex、持久动作回执与授权模式；资产、修订、范围、普通启停、审计与发布由服务持有。独立Skill发布判断不要求trialId/scanId。提交前最后异步窗口复查当前管理员与草稿/基线。
- import适配：单文件/单技能ZIP、有界解压、规范路径、重复/链接拒绝，先预览再明确保存；不执行、不安装。复用现有包解析依赖前核查，不在HTTP层重建归档引擎。
- scanner适配：固定Semgrep CE与本地规则，无网络/遥测/生产凭证，固定快照；不加载包内配置，忽略覆盖可核对。按包digest+扫描器/规则版本去重，有限并发/超时/输出；失败、部分覆盖和不适用分开。扫描只报告，迟到结果不改写发布时点。
- resources/service动态提供器：旧四项兼容，目录摘要先行，请求固定候选修订，显式与专家锁定冲突报错；正文与资源按需读。新技能不写入严格旧workspace-index。
- Pi适配/composer/history：新包选择带revisionId/packageDigest，旧{id,hash}仅旧内置语义；实际读取证据记录固定内容与父子关系；工具权限仍宿主交集。
- execution/docker及文件工具：仅请求获准激活包物化到/skills/<skillId>/<revisionId>/，保留规范根名；包只读，输出/workspace。read/ls/find/grep支持虚拟根，write/edit不可改包，不泄漏宿主或挂全库。
- trial复用原Pi循环和独立数据根，提供附件/停止/真实失败，不增加环境探测器或生产写权限；普通个人空间与测试根分离。
- server与web能力中心/专家编辑/输入区：管理与普通DTO分离；管理员创建/导入/编辑/报告/试用/发布/范围，普通获准用户选择只影响本条、不自动发送。保留登录/导航/桌面布局。

## 迁移与回退
能力库、认证库分开显式迁移；先副本dry-run与完整备份，不改旧revisionId/digest或历史文件，不重跑任务。新程序的准备中标记失败关闭。回退使用R2程序配对迁移前完整备份，保留R3活动根。开发使用独立codex/axon-r3分支，复用当前合适工作树；在用户最终确认后建立分支并激活任务。

## 待R3-0冻结的技术项
规范快照/参考skills-ref版本、Semgrep CE固定版本与规则来源/许可/摘要、独立不可变镜像标签，以及ZIP/YAML依赖选择；均需实际官方资料和夹具对照，不能把本规划写成已实现或已验证。本机PATH未发现semgrep，发现docker命令不等于Docker运行已验证。

## 管理员个人技能使用修正

缺口：SkillService.allowed仅接受业务席位范围，导致管理账号无法在个人正式对话使用已发布技能；能力中心管理卡片没有普通使用入口。

边界：复用authorizeUse的服务器当前身份检查，让其返回可选的administrator-personal使用域；仅该受信任域绕过业务席位开放范围判断。保持包身份/状态/账号拒绝/损坏策略校验、异步后重新授权与业务Task/Workspace守卫。PiLab仅对当前无席位管理员且匹配其个人scope或目录无scope的主体授予该域。无请求role字段、额外席位、schema、迁移或第二授权存储。

预计文件：src/skills/service.ts与src/pi/lab.ts拥有授权；SkillLibrary.tsx复用SkillUsePanel增加已发布可用技能的使用入口及范围文案；skills-api及新管理员个人Pi/API用例、skills.spec.ts证明正向使用及负向隔离；probe-skills-r3更新已过时的管理员拒绝断言。任务/spec/README同步当前决策，原始v0.3和已执行证据保持原样。

验证：none/指定范围下管理员个人目录和正文可读，显式选择实际进入原生Pi上下文；管理卡片可用于个人对话、保留草稿且不自动发送；无业务工具、公共/他人任务工作区历史/文件不可读；停用/封禁/账号拒绝/角色撤销及异步窗口仍拒绝，普通业务席位范围不变。此次不修改专家授权、后台R5或业务canCollaborate能力。

## 创建技能交互优化（2026-11-16）

实际缺口在SkillLibrary直接POST空create以及SkillEditor默认原始SKILL.md文本；用户被迫编辑frontmatter，创建/检查/范围/发布无明确反馈路径。

修改边界：SkillLibrary及其CSS和小型纯前端method helper承载新建表单与常规方法表单；复用已安装yaml的文档AST保留外来元数据，原始编辑仍可用，不为表单重建包格式。为避免创建后第二次save失败留下空草稿，现有create接口增加可选files，与sourceSkillId互斥，在原服务锁和事务中完成格式/完整性校验、资产/草稿/audit/动作回执一次创建；旧create/copy调用继续兼容，无schema迁移。CapabilityCenter移除重复副标题与冗余空状态说明。

预计文件：web/SkillLibrary.tsx、skill-management.css、新method helper，skills/service.ts、server/skill-routes.ts及对应测试；CapabilityCenter.tsx/capabilities.css由主代理清理文案；docs/spec/task记录同步。其余权限、包摘要规则、原生Pi、专家R2发布、后台R5保持原契约。

验收：新建/取消零写入、提交一次建完整草稿、双击/丢响应重试幂等、无效字段零资产且保留输入、方法表单和源文件同步、未知字段/多文件不丢失、导入不改包、CAS/后台扫描不重置dirty输入、必要发布前置有短操作提示、两个指定副标题不再出现、管理员/普通使用流程不回归、桌面截图人工查看。无需新模型/扫描器镜像或额外真实模型调用。沿用本轮4316测试环境反馈更新，4315保持原状。

## 顺序化创建与标题同行反馈

最小缺口在SkillLibrary/SkillEditor的独立tab顺序与成功回调，及CapabilityCenter标题在子组件动作条之外。仅改前端本地步骤/焦点/布局和对应浏览器测试，不新增后端wizard状态或发布门禁。标题交由SkillLibrary的header承载，CapabilityCenter skills分支不重复渲染标题。

新创建完成传入初始policy步骤及回执草稿摘要；首次管理详情若摘要不同，退回内容核对，不能因丢响应重试读取旧回执而跳过他人的更新。这个判断只用于首次本地步骤初始化，后续GET不导航。复制/导入仍从内容审阅开始，并提供无修改时继续操作。保存内容只在请求确实成功且没有更晚本地改动时推进；范围保存成功后推进检查/发布并复用当前草稿版本的普通格式校验，失败如实保留已完成动作并允许重试。请求中禁用重复动作/不被GET重置；CAS和原动作幂等保持。最后发布仍是显式动作。辅助tab不自动启动业务执行。

归档区域只按真实archived状态分组，不按new-skill名字或空正文粗略隐藏；支持已归档只读查看，正常草稿不受影响。线上占位核查与归档用现有服务、当前管理员、预期stateRevision和独立动作ID；在停服全备份后执行，条件不再匹配即跳过/停止，不做数据库批量删除或迁移。相应允许变更单列，其他账号/技能/历史保持。

预计产品文件：SkillLibrary.tsx、CapabilityCenter.tsx、skill-management.css及必要capabilities.css，tests/e2e/skills.spec.ts/capabilities.spec.ts。服务源码/权限/包内容/版本化历史不改，管理操作仅使用现有lifecycle。独立复核、相关API/单测/桌面截图、全局类型/lint/build后沿用本轮4316更新，4315不变。
